/**
 * レシート読み取りの検証。
 *
 * 日本のレシートに共通規格は無い。法令（適格簡易請求書）が定めるのは
 * 「発行者名＋登録番号 / 取引年月日 / 取引内容 / 税率ごとの合計額 / 消費税額」
 * という**内容**だけで、書き方・並び・品名の略し方は各社の自由。
 *
 * したがって「規格に合わせる」ことはできない。実際に出回っている書き方を
 * 集めて当てにいくしかないので、ここに実物を模した検体を並べて測る。
 *
 * 実行: node scripts/verify-receipt.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('.tmp', { recursive: true });
execSync(
  'npx esbuild src/features/shopping/logic/receipt.ts --format=esm --outfile=.tmp/receipt.mjs --log-level=error',
  { stdio: 'inherit' },
);
const R = await import('../.tmp/receipt.mjs');

/** 今週の買い出しリストに載っている品（照合の候補はこれだけ） */
const CANDIDATES = [
  { ingredientId: 'chicken', nameKey: 'とりむねにく', name: '鶏むね肉（皮なし）' },
  { ingredientId: 'pork', nameKey: 'ぶたひきにく', name: '豚ひき肉' },
  { ingredientId: 'carrot', nameKey: 'にんじん', name: 'にんじん' },
  { ingredientId: 'onion', nameKey: 'たまねぎ', name: '玉ねぎ' },
  { ingredientId: 'tomato', nameKey: 'かっととまとかん', name: 'カットトマト缶' },
  { ingredientId: 'daikon', nameKey: 'きりぼしだいこん', name: '切り干し大根' },
  { ingredientId: 'egg', nameKey: 'たまご', name: '卵' },
  { ingredientId: 'tofu', nameKey: 'もめんどうふ', name: '木綿豆腐' },
];

/**
 * 検体。expect は「その行がどの食材に割り当たるべきか」。
 * null は「割り当ててはいけない行」（合計・値引き・対象外商品など）。
 */
const CASES = [
  {
    name: '① 標準的なスーパー（インボイス対応・軽減税率※）',
    total: 1876,
    text: `スーパーマルエツ △△店
登録番号 T1234567890123
2026年9月5日(土) 18:42

ﾄﾘﾑﾈﾆｸ            ※  298
ﾌﾞﾀﾋｷﾆｸ           ※  380
ﾆﾝｼﾞﾝ             ※  128
ﾀﾏﾈｷﾞ             ※   98
ｶｯﾄﾄﾏﾄｶﾝ          ※  138
ｷﾘﾎﾞｼﾀﾞｲｺﾝ        ※  158
ﾀﾏｺﾞ 10ｺ          ※  278
ﾓﾒﾝﾄｳﾌ            ※   68
ｷｯﾁﾝﾍﾟｰﾊﾟｰ           330

小計              1,876
（内消費税等         138）
合計              1,876
お預り            2,000
お釣り              124
※印は軽減税率対象商品`,
    expect: {
      'ﾄﾘﾑﾈﾆｸ': 'chicken',
      'ﾌﾞﾀﾋｷﾆｸ': 'pork',
      'ﾆﾝｼﾞﾝ': 'carrot',
      'ﾀﾏﾈｷﾞ': 'onion',
      'ｶｯﾄﾄﾏﾄｶﾝ': 'tomato',
      'ｷﾘﾎﾞｼﾀﾞｲｺﾝ': 'daikon',
      'ﾀﾏｺﾞ': 'egg',
      'ﾓﾒﾝﾄｳﾌ': 'tofu',
      'ｷｯﾁﾝﾍﾟｰﾊﾟｰ': null,
    },
  },
  {
    name: '② 58mm幅（品名が短く切られる・漢字混じり）',
    total: 1024,
    text: `ライフ ○○店
2026-09-05

若鶏ムネ肉      298
豚挽肉          380
人参 3本        128
玉葱ネット       98
木綿豆腐         68
レジ袋           5
小計          1,024
合計          1,024`,
    expect: {
      '若鶏ムネ肉': 'chicken',
      '豚挽肉': 'pork',
      '人参': 'carrot',
      '玉葱ネット': 'onion',
      '木綿豆腐': 'tofu',
      'レジ袋': null,
    },
  },
  {
    name: '③ 単価×数量が別行になる形式＋値引き行',
    total: 892,
    text: `ｵｰｹｰ ××店
2026/09/05 19:03

ｺｸｻﾝﾄﾘﾑﾈﾆｸ
  128円 x 2                256
ﾆﾝｼﾞﾝ(ﾊﾞﾗ)
   48円 x 3                144
ﾀﾏﾈｷﾞ                      98
  値引                    -20
ｶｯﾄﾄﾏﾄ缶 400g             138
ﾎﾟｲﾝﾄ利用                 -50
合計                      892
現金                    1,000
釣銭                      108`,
    expect: {
      'ｺｸｻﾝﾄﾘﾑﾈﾆｸ': 'chicken',
      'ﾆﾝｼﾞﾝ(ﾊﾞﾗ)': 'carrot',
      'ﾀﾏﾈｷﾞ': 'onion',
      'ｶｯﾄﾄﾏﾄ缶': 'tomato',
      '値引': null,
      'ﾎﾟｲﾝﾄ利用': null,
    },
  },
  {
    name: '④ 全角カナ・税抜表示・「お買上計」表記',
    total: 1298,
    text: `業務スーパー ◇◇店
２０２６年９月５日

トリムネニク２ｋｇ        798
ブタヒキニク           380
キリボシダイコン        158
消費税等              104
お買上計             1,298
クレジット           1,298`,
    expect: {
      'トリムネニク２ｋｇ': 'chicken',
      'ブタヒキニク': 'pork',
      'キリボシダイコン': 'daikon',
      '消費税等': null,
    },
  },
  {
    name: '⑤ OCRが崩れた場合（カナの誤認・記号混入）',
    total: 704,
    text: `2026年9月5日
ﾄﾘﾑﾈ二ｸ           298
ﾆﾝ ｼﾞﾝ            128
夕マネギ            98
モメン豆腐           68
ｶｯﾄﾄﾏ卜缶          138
合 計             704`,
    expect: {
      'ﾄﾘﾑﾈ二ｸ': 'chicken',
      'ﾆﾝ ｼﾞﾝ': 'carrot',
      'モメン豆腐': 'tofu',
    },
    // 「夕マネギ」（夕=ゆう）「ｶｯﾄﾄﾏ卜缶」（卜=ぼく）は OCR がよく間違える字。
    // 当たれば上出来、外しても保留になればよい（誤割り当てだけが害）
    tolerant: ['夕マネギ', 'ｶｯﾄﾄﾏ卜缶'],
  },
];

let totalOk = 0;
let itemOk = 0;
let itemHold = 0;
let itemWrong = 0;
let tolerantMiss = 0;

for (const c of CASES) {
  const lines = R.toLines(c.text);
  const gotTotal = R.extractTotal(lines);
  const tOk = gotTotal === c.total;
  if (tOk) totalOk++;

  console.log(`\n${c.name}`);
  console.log(
    `  合計: ${gotTotal ?? '読めず'} / 正解 ${c.total}  ${tOk ? 'OK' : '← 外した'}`,
  );

  for (const [needle, want] of Object.entries(c.expect)) {
    const line = lines.find((l) => l.replace(/\s/g, '').includes(needle.replace(/\s/g, '')));
    if (!line) {
      console.log(`  ${needle.padEnd(18)} 行が見つからない`);
      continue;
    }
    const m = R.matchLine(line, CANDIDATES);
    const got = m.ingredientId;
    const tolerant = (c.tolerant ?? []).includes(needle);

    let mark;
    if (got === want) {
      mark = '正';
      itemOk++;
    } else if (got === null) {
      mark = tolerant ? '保留(許容)' : '保留';
      if (tolerant) tolerantMiss++;
      else itemHold++;
    } else {
      mark = '誤';
      itemWrong++;
    }
    console.log(
      `  ${mark.padEnd(10)} ${needle.padEnd(18)} → ${String(got ?? '—').padEnd(9)} ` +
        `(正解 ${String(want ?? '割当なし')}) 一致 ${m.score.toFixed(2)} 金額 ${m.priceYen ?? '—'}`,
    );
  }
}

console.log('\n' + '='.repeat(60));
console.log(`合計の読み取り: ${totalOk} / ${CASES.length} 件`);
console.log(
  `品目の割り当て: 正 ${itemOk} / 保留 ${itemHold} / 保留(許容) ${tolerantMiss} / 誤 ${itemWrong}`,
);
console.log('\n誤割り当てが0でなければ使えません（間違いに気づけないため）。');
