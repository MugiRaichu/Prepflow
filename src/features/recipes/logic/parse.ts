/**
 * レシピの取り込み。
 *
 * **外部サイトから自動で集めることはしない。**
 * 主要レシピサイトは規約で自動取得を禁じており、手順文と写真は著作物にあたる。
 * ここが受け取るのは、利用者が自分で撮った画像と貼り付けた文だけ。
 * 端末内で解析し、端末内に保存する。外に出さないし、再配布もしない。
 *
 * 解析の役目は「全部を当てる」ことではなく「打ち込む手間を減らす」こと。
 * 外したところは画面でタップして直せるようにし、
 * 栄養と原価は**必ず食材マスタから計算する**（読み取った数値は信用しない）。
 */
import { normalizeReceiptText, similarity } from '@/features/shopping/logic/receipt';
import type { EquipmentKind, Ingredient } from '@/db/schema';

// ---------------------------------------------------------------------------
// 分量の解析
// ---------------------------------------------------------------------------

/** 全角数字と分数記号を素の数字に寄せる */
function normalizeNumbers(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/½/g, '1/2')
    .replace(/⅓/g, '1/3')
    .replace(/¼/g, '1/4')
    .replace(/⅔/g, '2/3')
    .replace(/¾/g, '3/4');
}

/** '1' / '1.5' / '1/2' / '1と1/2' を数値にする */
function parseAmount(s: string): number | null {
  const t = normalizeNumbers(s).replace(/\s/g, '');
  const mixed = t.match(/^(\d+)と(\d+)\/(\d+)/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const dec = t.match(/^(\d+(?:\.\d+)?)/);
  return dec ? Number(dec[1]) : null;
}

/**
 * さじ1杯のグラム数。**食材ごとに違う**ので、密度の近いものでまとめる。
 *
 * 大さじ1は容積15mlだが、重さは砂糖9g・しょうゆ18g・油12gとばらつく。
 * 15gで一律に換算すると砂糖は7割増しになり、栄養計算が狂う。
 * ここに無いものは水と同じ15gとして扱い、画面でグラム数を直せるようにする。
 */
const TBSP_GRAMS: [RegExp, number][] = [
  [/しょうゆ|みそ|みりん|ぽんず|そーす|けちゃっぷ|しお/, 18],
  [/さとう|かたくりこ|こむぎこ|ぱんこ|ぷろていん|ここあ/, 9],
  [/あぶら|おいる|ばたー|まよねーず/, 12],
];

const gramsPerTbsp = (nameKey: string): number => {
  for (const [re, g] of TBSP_GRAMS) if (re.test(nameKey)) return g;
  return 15;
};

/** 小さじは大さじの1/3 */
const gramsPerTsp = (nameKey: string): number => gramsPerTbsp(nameKey) / 3;

/**
 * 「1個」「1本」が何gか。
 *
 * 買う単位（gramsPerUnit）を流用してはいけない。卵は1パック600gなので、
 * 「卵2個」が1200gになる。数えられる食材だけが gramsPerPiece を持つ。
 */
function piecePerGrams(ing?: Ingredient): number | null {
  if (!ing) return null;
  if (ing.purchase.gramsPerPiece) return ing.purchase.gramsPerPiece;
  if (ing.purchase.unit === 'piece') return ing.purchase.gramsPerUnit;
  return null;
}

export interface ParsedAmount {
  /** g に換算した量。換算できなければ null */
  grams: number | null;
  /** 画面に出す元の表記 */
  display: string;
  /** 「適量」「少々」など、量が決まっていない */
  vague: boolean;
}

/**
 * 「大さじ2」「300g」「1/2個」を g に直す。
 * 個・本・枚は食材ごとの重さが要るので、購入単位の情報を使う。
 */
export function parseAmountText(text: string, ing?: Ingredient): ParsedAmount {
  const raw = text.trim();
  const t = normalizeNumbers(raw);
  const key = ing?.nameKey ?? '';

  if (/適量|少々|ひとつまみ|お好み/.test(t)) {
    return { grams: null, display: raw, vague: true };
  }

  const g = t.match(/(\d+(?:\.\d+)?)\s*(?:g|ｇ|グラム)/i);
  if (g) return { grams: Number(g[1]), display: raw, vague: false };

  const ml = t.match(/(\d+(?:\.\d+)?)\s*(?:ml|ｍｌ|cc|ミリ)/i);
  if (ml) return { grams: Number(ml[1]), display: raw, vague: false };

  const tbsp = t.match(/大さじ\s*([\d./と]+)/);
  if (tbsp) {
    const n = parseAmount(tbsp[1] ?? '');
    if (n != null) return { grams: n * gramsPerTbsp(key), display: raw, vague: false };
  }

  const tsp = t.match(/小さじ\s*([\d./と]+)/);
  if (tsp) {
    const n = parseAmount(tsp[1] ?? '');
    if (n != null) return { grams: n * gramsPerTsp(key), display: raw, vague: false };
  }

  const cup = t.match(/([\d./と]*)\s*カップ/);
  if (cup) {
    const n = parseAmount(cup[1] ?? '') ?? 1;
    return { grams: n * 200, display: raw, vague: false };
  }

  // 個・本・枚・片・パック・缶。1つあたりの重さは食材マスタから取る
  const piece = t.match(/([\d./と]+)\s*(個|本|枚|片|パック|缶|玉|尾|切れ|袋|丁)/);
  if (piece) {
    const n = parseAmount(piece[1] ?? '');
    const per = piecePerGrams(ing);
    if (n != null && per) return { grams: n * per, display: raw, vague: false };
    if (n != null) return { grams: null, display: raw, vague: false };
  }

  // 単位のない裸の数字は個数とみなす
  const bare = parseAmount(t);
  const per = piecePerGrams(ing);
  if (bare != null && per) return { grams: bare * per, display: raw, vague: false };
  return { grams: null, display: raw, vague: false };
}

// ---------------------------------------------------------------------------
// 材料行の切り出し
// ---------------------------------------------------------------------------

const HEAD_ITEMS = /^(材料|ざいりょう|【材料】|■材料)/;
const HEAD_STEPS = /^(作り方|つくり方|手順|作りかた|【作り方】|■作り方)/;

/** 材料名から落とす飾り */
const ITEM_NOISE = /^[・･\-–—◯○●☆★*\s]+|[:：]\s*$/g;

/**
 * 手順に出る動作。材料行にはまず出てこない。
 * 「焼きのり」のような食材名との衝突は、分量つきの短い行を先に材料と判定して避ける。
 */
const COOK_VERB =
  /(切る|刻む|混ぜ|和え|あえ|炒め|焼く|煮る|煮込|ゆで|茹で|蒸す|蒸し|揚げ|加え|入れ|かけ|盛|詰め|まぶ|もみ|レンジ|加熱|冷ま|絞|溶か|ほぐ|ひい|調え|ととの|仕上げ|器に|添え|振っ|のせ)/;

/** 分量の書き出しに現れるもの */
const AMOUNT_HEAD = '[\\d０-９½⅓¼⅔¾]|大さじ|小さじ|カップ|適量|少々';

export interface ParsedItem {
  /** 読み取った原文 */
  raw: string;
  /** 食材名の部分 */
  name: string;
  /** 分量の部分 */
  amountText: string;
}

/**
 * 材料行を「名前」と「分量」に割る。
 *
 * 日本語のレシピは「鶏むね肉　300g」のように空白で割れることが多いが、
 * 「鶏むね肉300g」と続けて書く形もある。数字の直前で切るのを併用する。
 */
export function splitItemLine(line: string): ParsedItem | null {
  const raw = line.trim();
  if (!raw || raw.length > 60) return null;

  // 空白・全角空白で割れるならそこで割る
  const bySpace = raw.match(new RegExp('^(.+?)[\\s　]+(?:' + AMOUNT_HEAD + ')'));
  if (bySpace) {
    const name = bySpace[1]!.replace(ITEM_NOISE, '').trim();
    const amountText = raw.slice(bySpace[1]!.length).trim();
    if (name) return { raw, name, amountText };
  }

  // 数字・「大さじ」等の直前で割る
  const byNum = raw.match(new RegExp('^(.+?)((?:' + AMOUNT_HEAD + ').*)$'));
  if (byNum) {
    const name = byNum[1]!.replace(ITEM_NOISE, '').trim();
    if (name) return { raw, name, amountText: byNum[2]!.trim() };
  }

  const name = raw.replace(ITEM_NOISE, '').trim();
  return name ? { raw, name, amountText: '' } : null;
}

export interface SplitResult {
  items: ParsedItem[];
  steps: string[];
  /** 「（2人分）」から拾った出来上がり人数 */
  servings?: number;
}

/**
 * 読み取った文全体を、材料と手順に割る。
 *
 * 見出しがあればそれに従う。無ければ「分量らしきものを含む短い行」を材料、
 * 「番号つき、または長い行」を手順として振り分ける。
 * 画像から読むと見出しが崩れることがあるので、両方の判定が要る。
 */
export function splitRecipeText(text: string): SplitResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const servingsHit = text.match(/([\d０-９]+)\s*人(?:分|前)/);
  const servings = servingsHit ? (parseAmount(servingsHit[1]!) ?? undefined) : undefined;

  let section: 'unknown' | 'items' | 'steps' = 'unknown';
  const items: ParsedItem[] = [];
  const steps: string[] = [];

  for (const line of lines) {
    if (HEAD_STEPS.test(line)) {
      section = 'steps';
      continue;
    }
    if (HEAD_ITEMS.test(line)) {
      section = 'items';
      continue;
    }

    const numbered = /^([0-9０-９]{1,2}[.．、)）]|[①-⑳])/.test(line);
    const hasAmount = /[\d０-９½⅓¼⅔¾]|大さじ|小さじ|適量|少々|カップ/.test(line);

    // 見出しが無いレシピでは、動詞で見分けるしかない。
    // 「フライパンに油をひいて豚肉を炒める」は短いが手順で、
    // 「ごま油 小さじ2」は動詞が無く材料。長さだけでは分けられなかった
    const target =
      section === 'items'
        ? 'items'
        : section === 'steps'
          ? 'steps'
          : numbered
            ? 'steps'
            : hasAmount && line.length <= 20
              ? 'items'
              : COOK_VERB.test(line) || line.length > 20
                ? 'steps'
                : hasAmount
                  ? 'items'
                  : 'skip';

    if (target === 'items') {
      const it = splitItemLine(line);
      if (it) items.push(it);
    } else if (target === 'steps') {
      const t = line.replace(/^([0-9０-９]{1,2}[.．、)）]|[①-⑳])\s*/, '').trim();
      if (t) steps.push(t);
    }
  }

  return { items, steps, ...(servings ? { servings } : {}) };
}

// ---------------------------------------------------------------------------
// 食材の照合
// ---------------------------------------------------------------------------

/**
 * 迷ったら「分からない」を返す。誤った食材で栄養を計算するほうが害が大きい。
 *
 * レシートより高くしてある。レシートは店の略称（「若鶏ムネ」）が相手なので
 * 低めに取らざるを得ないが、レシピの材料名はきれいに書かれているので、
 * 低い一致は「マスタに無い」とみなしてよい。
 *
 * 実際、0.34 では「牛乳」が「牛こま切れ肉」に当たった（読みの先頭2文字が同じ）。
 * 長さが大きく違うものも弾く。短い語が長い語の一部に偶然含まれるのを防ぐ。
 */
const MIN_SCORE = 0.45;
const MIN_GAP = 0.1;
/** 短いほうが長いほうの何割以上の長さであること */
const MIN_LENGTH_RATIO = 0.5;

export interface ItemMatch {
  ingredient: Ingredient | null;
  score: number;
  /** 候補が僅差だったなど、確認したほうがよい */
  uncertain: boolean;
}

/**
 * 材料名を食材マスタに当てる。
 * レシート読み取りと同じ正規化・同じ二文字組の類似度を使う（D-047 で検証済み）。
 */
export function matchIngredient(name: string, pool: Ingredient[]): ItemMatch {
  const q = normalizeReceiptText(name);
  if (q.length < 2) return { ingredient: null, score: 0, uncertain: true };

  const scored = pool
    .map((ing) => {
      const keys = [ing.nameKey, ...ing.aliases, ing.name].map(normalizeReceiptText);
      const score = Math.max(
        ...keys.map((k) => {
          const ratio = Math.min(q.length, k.length) / Math.max(q.length, k.length, 1);
          // 長さが違いすぎるものは、そもそも別物とみなす
          return ratio < MIN_LENGTH_RATIO ? 0 : similarity(q, k);
        }),
      );
      return { ing, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < MIN_SCORE) {
    return { ingredient: null, score: best?.score ?? 0, uncertain: true };
  }

  const gap = best.score - (second?.score ?? 0);
  return { ingredient: best.ing, score: best.score, uncertain: gap < MIN_GAP };
}

// ---------------------------------------------------------------------------
// 手順の所要時間と器具
// ---------------------------------------------------------------------------

/**
 * 手順文から所要分・拘束分・器具を見積もる。
 *
 * 並行調理の段取りは「人が張り付く時間（hands）」と「機器が埋まる時間（min）」を
 * 分けて持てないと組めない。手順文にその区別は書いていないので、
 * 動詞から推定する。**煮る・焼くは待ち時間があり、切る・混ぜるは無い。**
 *
 * 文中に「5分」と書いてあればそれを優先する。
 */
const STEP_RULES: { re: RegExp; min: number; handsRatio: number; kind?: EquipmentKind }[] = [
  { re: /レンジ|電子レンジ|チン/, min: 5, handsRatio: 0, kind: 'microwave' },
  { re: /炊く|炊飯/, min: 50, handsRatio: 0.05, kind: 'rice_cooker' },
  { re: /オーブン|天板|焼き上げ/, min: 20, handsRatio: 0.15, kind: 'oven' },
  { re: /トースター/, min: 8, handsRatio: 0.1, kind: 'oven_toaster' },
  { re: /ミキサー|攪拌|かくはん|ブレンダー/, min: 2, handsRatio: 0.8, kind: 'blender' },
  { re: /シェイカー|振って|シェイク|溶かす/, min: 1, handsRatio: 1, kind: 'shaker' },
  { re: /煮込|煮る|煮立|コトコト|とろ火/, min: 15, handsRatio: 0.2, kind: 'stovetop_burner' },
  { re: /ゆで|茹で|湯がく/, min: 10, handsRatio: 0.25, kind: 'stovetop_burner' },
  { re: /揚げ/, min: 10, handsRatio: 0.7, kind: 'stovetop_burner' },
  { re: /焼く|焼き|炒め|ソテー/, min: 8, handsRatio: 0.6, kind: 'stovetop_burner' },
  { re: /蒸す|蒸し/, min: 10, handsRatio: 0.2, kind: 'stovetop_burner' },
  { re: /冷ま|粗熱|寝かせ|漬け|なじま/, min: 15, handsRatio: 0.05 },
  { re: /切る|刻む|きざ|みじん|そぎ切り|乱切り|千切り|ほぐ/, min: 6, handsRatio: 1 },
  { re: /混ぜ|和え|あえ|もみ込|まぶ|つぶ/, min: 4, handsRatio: 1 },
  { re: /盛|詰め|かける|のせ/, min: 2, handsRatio: 1 },
];

export interface StepGuess {
  text: string;
  min: number;
  hands: number;
  kind?: EquipmentKind;
}

export function guessStep(text: string): StepGuess {
  const rule = STEP_RULES.find((r) => r.re.test(text));
  // 文中に分数が書いてあればそちらを信じる
  const stated = text.match(/([\d０-９]+)\s*分/);
  const statedMin = stated ? parseAmount(stated[1]!) : null;

  const min = Math.max(1, Math.round(statedMin ?? rule?.min ?? 5));
  const hands = Math.max(0, Math.round(min * (rule?.handsRatio ?? 1)));
  return { text, min, hands, ...(rule?.kind ? { kind: rule.kind } : {}) };
}
