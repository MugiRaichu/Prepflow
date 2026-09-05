/**
 * レシピ取り込みの検証。
 *
 * 見るのは3つ。
 *   1. 材料と手順を正しく割れるか（見出しがある場合／無い場合）
 *   2. 分量を g に直せるか。大さじ・小さじ・個数は食材ごとに重さが違う
 *   3. 食材マスタに当てられるか。**当てられないより、誤って当てるほうが害が大きい**
 *
 * 検体は、日本のレシピでよくある書き方を模したもの。
 * 画像から読むと見出しが崩れたり、空白が全角になったりするので、その形も混ぜる。
 *
 * 実行: node scripts/verify-recipe.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('.tmp', { recursive: true });
execSync(
  'npx esbuild scripts/_recipe-entry.ts --bundle --format=esm --platform=node --outfile=.tmp/recipe.mjs --alias:@=./src --log-level=error',
  { stdio: 'inherit' },
);
const R = await import('../.tmp/recipe.mjs');

let uid = 0;
const now = new Date().toISOString();
const POOL = R.BUILTIN_INGREDIENTS.map((i) => ({
  ...i,
  id: 'i' + ++uid,
  createdAt: now,
  updatedAt: now,
  deleted: 0,
  rev: 1,
}));

/** 検体。expect は「この材料名 → この食材キー」と「この分量 → 何g」 */
const CASES = [
  {
    name: '見出しあり・全角空白',
    text: `鶏むね肉の照り焼き
材料（4人分）
鶏むね肉　600g
片栗粉　大さじ1
しょうゆ　大さじ2
みりん　大さじ2
砂糖　大さじ1
サラダ油　小さじ2

作り方
1. 鶏むね肉を一口大のそぎ切りにする
2. 片栗粉をまぶす
3. フライパンで両面を8分焼く
4. 調味料を加えて煮からめる`,
    expectItems: 6,
    expectSteps: 4,
    expectGrams: { とりむねにく: 600, かたくりこ: 9, しょうゆ: 36, さとう: 9, さらだあぶら: 8 },
  },
  {
    name: '見出しなし・半角空白',
    text: `豚こま 300g
玉ねぎ 1個
しょうゆ 大さじ1.5
ごま油 小さじ2
フライパンに油をひいて豚肉を炒める
玉ねぎを加えてしんなりするまで炒める
しょうゆで味を調える`,
    expectItems: 4,
    expectSteps: 3,
    expectGrams: { ぶたこまぎれにく: 300, たまねぎ: 200, しょうゆ: 27, ごまあぶら: 8 },
  },
  {
    name: '空白なし・分数',
    text: `材料
にんじん1/2本
卵2個
砂糖小さじ1
塩少々
作り方
①にんじんを千切りにする
②卵を溶いて混ぜる
③レンジで3分加熱する`,
    expectItems: 4,
    expectSteps: 3,
    expectGrams: { さとう: 3, たまご: 120, にんじん: 75 },
  },
  {
    name: 'プロテイン入り（食材マスタに無いものを含む）',
    text: `材料（1人分）
プロテインパウダー 30g
牛乳 200ml
バナナ 1本
氷 少々
作り方
1. ミキサーに全部入れる
2. 30秒攪拌する`,
    expectItems: 4,
    expectSteps: 2,
  },
];

let ng = 0;

for (const c of CASES) {
  const r = R.splitRecipeText(c.text);
  const okItems = r.items.length === c.expectItems;
  const okSteps = r.steps.length === c.expectSteps;
  if (!okItems || !okSteps) ng++;
  console.log(
    `\n[${c.name}] 材料 ${r.items.length}/${c.expectItems} ${okItems ? 'OK' : 'NG'}` +
      ` / 手順 ${r.steps.length}/${c.expectSteps} ${okSteps ? 'OK' : 'NG'}` +
      (r.servings ? ` / ${r.servings}人分` : ''),
  );

  for (const it of r.items) {
    const m = R.matchIngredient(it.name, POOL);
    const amt = R.parseAmountText(it.amountText, m.ingredient ?? undefined);
    const key = m.ingredient?.nameKey ?? '—';
    const want = c.expectGrams?.[key];
    let mark = ' ';
    if (want != null) {
      const hit = amt.grams != null && Math.abs(amt.grams - want) < 0.6;
      if (!hit) {
        ng++;
        mark = '!';
      }
    }
    console.log(
      `  ${mark} ${it.name.padEnd(12)} | ${it.amountText.padEnd(8)} → ` +
        `${key.padEnd(14)} ${amt.grams == null ? (amt.vague ? '(適量)' : '(不明)') : Math.round(amt.grams * 10) / 10 + 'g'}` +
        `${m.uncertain ? '  ← 要確認' : ''}` +
        (want != null ? `  期待 ${want}g` : ''),
    );
  }

  for (const s of r.steps) {
    const g = R.guessStep(s);
    console.log(
      `    手順 ${g.min}分（手 ${g.hands}分）${g.kind ? ' ' + g.kind : ''}  ${s.slice(0, 30)}`,
    );
  }
}

// --- 誤爆の確認 -------------------------------------------------------------
// 食材マスタに無いものを、似た名前に当ててしまわないか。
// 「プロテイン」を「ぷりん」等に当てると、栄養が丸ごと嘘になる
console.log('\n[誤爆] マスタに無い食材を当ててしまわないか');
for (const name of ['BCAA', 'オイコス', 'カニカマ', 'クレアチン', 'ベーキングパウダー', '粉ゼラチン']) {
  const m = R.matchIngredient(name, POOL);
  const hit = m.ingredient ? m.ingredient.name : '—';
  const safe = m.ingredient == null || m.uncertain;
  if (!safe) ng++;
  console.log(`  ${safe ? 'OK ' : 'NG '}${name.padEnd(16)} → ${hit}（${m.score.toFixed(2)}）`);
}

console.log(`\n結果: NG ${ng} 件`);
process.exit(ng > 0 ? 1 : 0);
