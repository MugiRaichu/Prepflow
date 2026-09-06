/**
 * レシートの読み取り。
 *
 * D-041 で「レシートの品名は略されていて食材マスタと突き合わせられない」として
 * 却下したが、これは**500品のマスタ全体と照合する前提**での判断だった。
 * 実際の候補は「今週の買い出しリストに載っている6〜8品」だけなので、
 * 閉じた小さい集合への割り当て問題になり、素朴な照合でも十分に当たる。
 *
 * 事前検証（手打ちのレシート表記10件）: 9件正解 / 1件は短すぎて保留。
 *
 * 残る不確かさは OCR そのものの精度（感熱紙の日本語）で、これは実物でしか測れない。
 * したがって読み取り結果は**必ず画面に出して確認させる**。黙って採用しない。
 */

const HALF = '｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const FULL = '。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';

/**
 * 食材によく出る漢字の読み。
 * レシートは「豚挽肉」「人参」「玉葱」のように漢字で出ることも多く、
 * ひらがなのキーと直接は照合できない。読みに開いてから比べる。
 * 網羅は狙わない。買い出しに出る食材の範囲で足りる。
 */
const KANJI_READING: [RegExp, string][] = [
  [/鶏|若鶏|とり肉/g, 'とり'],
  [/豚/g, 'ぶた'],
  [/牛/g, 'ぎゅう'],
  [/挽肉|ひき肉|挽き肉/g, 'ひきにく'],
  [/胸肉|むね肉|ムネ肉/g, 'むねにく'],
  [/腿肉|もも肉|モモ肉/g, 'ももにく'],
  [/人参/g, 'にんじん'],
  [/玉葱|玉ねぎ/g, 'たまねぎ'],
  [/長葱|葱/g, 'ねぎ'],
  [/大根/g, 'だいこん'],
  [/白菜/g, 'はくさい'],
  [/胡瓜/g, 'きゅうり'],
  [/茄子/g, 'なす'],
  [/馬鈴薯|じゃが芋/g, 'じゃがいも'],
  [/卵|玉子/g, 'たまご'],
  [/木綿豆腐/g, 'もめんどうふ'],
  [/絹豆腐|絹ごし豆腐/g, 'きぬどうふ'],
  [/豆腐/g, 'どうふ'],
  [/納豆/g, 'なっとう'],
  [/牛乳/g, 'ぎゅうにゅう'],
  [/鮭|銀鮭/g, 'さけ'],
  [/鯖/g, 'さば'],
  [/鰤/g, 'ぶり'],
  [/切干|切り干し/g, 'きりぼし'],
  [/胡麻/g, 'ごま'],
  [/醤油/g, 'しょうゆ'],
  [/味噌/g, 'みそ'],
  [/砂糖/g, 'さとう'],
  [/塩/g, 'しお'],
  [/油/g, 'あぶら'],
  [/米/g, 'こめ'],
  [/肉/g, 'にく'],
  [/缶/g, 'かん'],
];

/** 食材の識別に関係のない語。レシートには必ず混ざる */
const NOISE =
  /(国産|若鶏|カット|パック|バラ|冷凍|生鮮|特売|徳用|訳あり|[0-9０-９]+|[a-zA-Zａ-ｚＡ-Ｚ]+|ｇ|kg|ml|円|税込|税抜|本|束|個|枚|尾|入|％|%)/g;

/**
 * レシートの表記を、照合できる形に正規化する。
 * 半角カナ→全角→濁点の合成→カタカナ→ひらがな、の順。
 * 濁点は U+3099（合成用）でないと結合しない。U+309B（゛）では結合せず「ふ゛た」になる。
 */
export function normalizeReceiptText(s: string): string {
  let t = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const idx = HALF.indexOf(c);
    let ch = idx < 0 ? c : FULL[idx]!;
    const next = s[i + 1];
    if (next === 'ﾞ' || next === 'ﾟ') {
      ch = (ch + (next === 'ﾞ' ? '゙' : '゚')).normalize('NFC');
      i++;
    }
    t += ch;
  }
  t = t.normalize('NFKC').replace(NOISE, '');
  // カタカナをひらがなに畳んでから、漢字を読みに開く
  t = t.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  for (const [re, yomi] of KANJI_READING) t = t.replace(re, yomi);
  return t.replace(/[\s　・,，.．\-−ー（）()]/g, '');
}

const bigrams = (s: string): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};

/** 2文字組みの一致率（Dice係数）。片方だけ長い誤マッチを弾ける */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
};

export interface MatchCandidate {
  ingredientId: string;
  /** ひらがなに畳んだキー */
  nameKey: string;
  /** 表示名（漢字を含む）。こちらとも照合して高いほうを採る */
  name: string;
}

export interface ReceiptLine {
  /** 読み取れた行のテキスト */
  raw: string;
  /** 行の末尾で見つかった金額 */
  priceYen: number | null;
  /** 割り当てた食材。確信が持てなければ null */
  ingredientId: string | null;
  /** 一致の強さ（0〜1）。UIで「確からしさ」を出すのに使う */
  score: number;
}

const MIN_SCORE = 0.34;
/** 1位と2位の差。近い候補が2つあるときは決めない */
const MIN_GAP = 0.12;
/** 短すぎる語は決め手にならない。「ねぎ」は玉ねぎとも長ねぎとも取れる */
const MIN_CHARS = 3;

/** 行末の金額を拾う。「¥298」「298円」「298」いずれも */
export function extractPrice(line: string): number | null {
  const m = line
    .normalize('NFKC')
    .replace(/[,，\s]/g, '')
    .match(/(?:¥|\\)?(\d{2,6})\s*円?\s*(?:[*※内外]\s*)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 10 && n <= 100000 ? n : null;
}

/** 1行を候補に割り当てる。決められないときは null を返して人に聞く */
export function matchLine(raw: string, candidates: MatchCandidate[]): ReceiptLine {
  const priceYen = extractPrice(raw);
  const text = normalizeReceiptText(raw.replace(/(?:¥|\\)?\d[\d,，]*\s*円?\s*[*※内外]?\s*$/, ''));

  if (text.length < MIN_CHARS || candidates.length === 0) {
    return { raw, priceYen, ingredientId: null, score: 0 };
  }

  const ranked = candidates
    .map((c) => ({
      c,
      s: Math.max(similarity(text, c.nameKey), similarity(text, normalizeReceiptText(c.name))),
    }))
    .sort((a, b) => b.s - a.s);

  const top = ranked[0]!;
  const second = ranked[1]?.s ?? 0;
  const decided = top.s >= MIN_SCORE && top.s - second >= MIN_GAP;

  return {
    raw,
    priceYen,
    ingredientId: decided ? top.c.ingredientId : null,
    score: top.s,
  };
}

/** 合計らしき行を探す。「お預り」を拾わないよう、ラベルで判定する */
export function extractTotal(lines: string[]): number | null {
  for (const line of lines) {
    const t = line.normalize('NFKC').replace(/[\s　]/g, '');
    // 「お預り」「お釣り」「小計」は除く。「合計」「計」「お買上」だけを見る
    if (/(預|釣|つり|小計|点数)/.test(t)) continue;
    if (!/(合計|合冒|お買上|お買い上げ|計)/.test(t)) continue;
    const p = extractPrice(t);
    if (p != null) return p;
  }
  return null;
}

/**
 * OCR の生テキストを行に割る。
 *
 * 半角カナ（ｦ-ﾟ）を判定に含めないと、「ｺｸｻﾝﾄﾘﾑﾈﾆｸ」のように
 * 半角カナだけで数字を含まない行が丸ごと消える。レシートでは普通の書き方なので致命的。
 *
 * また「品名だけの行」と「単価×数量と金額の行」に分かれる形式があるので、
 * 金額の無い品名行と、直後の品名の無い金額行を繋ぐ。
 */
export function toLines(text: string): string[] {
  const raw = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && /[぀-ヿ一-龯ｦ-ﾟ0-9０-９]/.test(l));

  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i]!;
    const next = raw[i + 1];
    const hasName = normalizeReceiptText(line).length >= MIN_CHARS;
    if (hasName && extractPrice(line) == null && next) {
      // 次の行が「128円 x 2   256」のように金額だけなら、同じ商品の続きとみなす
      const nextIsPriceOnly =
        extractPrice(next) != null && normalizeReceiptText(next).length < MIN_CHARS;
      if (nextIsPriceOnly) {
        out.push(line + ' ' + next);
        i++;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * 読み取った行のうち、**今回の買い出しに載っている食材だけ**の合計。
 *
 * レシートの「合計」をそのまま使うと、同じ会計で洗剤やティッシュを買った
 * 瞬間に食費が跳ね上がり、次の週の見込みが狂う。
 * スーパーで日用品を買えない、という制約はアプリ側の都合でしかない。
 *
 * 割り当てられた行の金額だけを足せば、日用品が混ざっていても食材だけの額が出る。
 * 割り当てられなかった行は数えない（食材かどうか分からないものを足さない）。
 */
export function sumMatchedYen(lines: ReceiptLine[]): number {
  return lines.reduce((n, l) => (l.ingredientId && l.priceYen != null ? n + l.priceYen : n), 0);
}

/** 割り当てられなかったのに金額がある行の合計。「食材以外」の目安として出す */
export function sumUnmatchedYen(lines: ReceiptLine[]): number {
  return lines.reduce((n, l) => (!l.ingredientId && l.priceYen != null ? n + l.priceYen : n), 0);
}
