/**
 * 献立ソルバーの検証。
 *
 * 見るのは3つ。
 *   1. シードの妥当性（1食あたりのグラム数が現実的か）
 *   2. 時短の希望が**実際に叶うか**。上限を短くしたときに解が出るか、
 *      出た献立の手を動かす時間が本当にその中に収まっているか
 *   3. 探索が現実的な時間で終わるか（レシピを増やすと組合せが爆発する）
 *
 * 「時短」を選択肢に出すだけなら簡単だが、選んだ結果が45分では意味がない。
 * ここで数字を見るのはそのため。
 *
 * 実行: node scripts/verify-plan.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('.tmp', { recursive: true });
const bundle = (src, out) =>
  execSync(
    `npx esbuild ${src} --bundle --format=esm --platform=node --outfile=.tmp/${out} --alias:@=./src --log-level=error`,
    { stdio: 'inherit' },
  );

bundle('scripts/_plan-entry.ts', 'plan.mjs');
const { BUILTIN_INGREDIENTS, BUILTIN_RECIPES, buildRecipe, solveWithRequest, applyRequest, timeMetric, buildDailyMenus } =
  await import('../.tmp/plan.mjs');

// --- シードを組み立てる（seed.ts と同じ手順を、DB を使わずに再現） ---------
let uid = 0;
const now = new Date().toISOString();
const ingredients = BUILTIN_INGREDIENTS.map((i) => ({
  ...i,
  id: 'ing-' + ++uid,
  createdAt: now,
  updatedAt: now,
  deleted: 0,
  rev: 1,
}));
const byKey = new Map(ingredients.map((i) => [i.nameKey, i]));

const recipes = [];
const problems = [];
for (const seed of BUILTIN_RECIPES) {
  const { recipe, missing, warnings } = buildRecipe(seed, byKey);
  if (missing.length) problems.push(`${seed.title}: 食材が見つからない ${missing.join(',')}`);
  for (const w of warnings) problems.push(`${seed.title}: ${w}`);
  recipes.push({ ...recipe, id: 'rcp-' + ++uid, createdAt: now, updatedAt: now, deleted: 0, rev: 1 });
}

console.log('レシピ ' + recipes.length + ' 品 / 食材 ' + ingredients.length + ' 品');
console.log(
  '  主菜 ' + recipes.filter((r) => r.role === 'main').length +
  ' / 副菜 ' + recipes.filter((r) => r.role === 'side').length +
  ' / 主食 ' + recipes.filter((r) => r.role === 'staple').length,
);
if (problems.length) {
  console.log('\n[シードの警告]');
  for (const p of problems) console.log('  ! ' + p);
} else {
  console.log('  シードの警告なし');
}

// --- ソルバーを回す ---------------------------------------------------------
/** 30歳男性・維持・夕食5日ぶんを1人で、という標準的な条件 */
const base = (mode) => ({
  recipes,
  meals: 5,
  target: { kcal: 800, proteinG: 45, fatG: 22, carbG: 95 },
  budgetYen: 4000,
  maxPrepMinutes: 90,
  maxRecipesPerWeek: 4,
  maxFridgeDays: 3,
  allowFreezing: true,
  bannedIngredientIds: new Set(),
  bannedAllergens: new Set(),
  dislikedIngredientIds: new Map(),
  recentRecipeIds: new Set(),
  requiredTagMeals: [],
  avoidTags: [],
  maxKcalDeviation: 0.25,
  mode,
  maxDailyCookMinutes: 60,
  cookDays: 5,
  maxProteinDeviation: 0.2,
  minFatRatio: 0.6,
  maxSameDishMeals: 3,
  timeCapIsExplicit: false,
});

const run = (mode, req, label, expectNone = false) => {
  const t0 = Date.now();
  const r = solveWithRequest(applyRequest(base(mode), req));
  const ms = Date.now() - t0;
  const c = r.candidates[0];
  if (!c) {
    const feasible = r.minFeasibleMinutes != null ? Math.ceil(r.minFeasibleMinutes) + '分なら可' : '不明';
    console.log(`  ${label.padEnd(18)} ${expectNone ? 'OK ' : 'NG '}解なし（${feasible}） ${ms}ms`);
    // 届かない上限では解が出ないのが正しい。出すべきは「何分なら組めるか」
    return { ok: expectNone && r.minFeasibleMinutes != null, ms };
  }
  const hands = timeMetric(mode, c.handsOnMinutes, 5);
  const cap = req.timeCapMinutes;
  const within = cap == null || hands <= cap + 1e-6;
  const kcalOff = Math.round((c.perMeal.kcal / 800 - 1) * 100);
  const pOff = Math.round((c.perMeal.proteinG / 45 - 1) * 100);
  const fOff = Math.round((c.perMeal.fatG / 22 - 1) * 100);
  console.log(
    `  ${label.padEnd(18)} ${within ? 'OK ' : 'NG '}` +
      `${Math.round(hands)}分 / 上限${cap ?? '-'}  ` +
      `${c.estimatedCostYen}円  kcal${kcalOff >= 0 ? '+' : ''}${kcalOff}% P${pOff >= 0 ? '+' : ''}${pOff}% F${fOff >= 0 ? '+' : ''}${fOff}%  ` +
      `${c.mains.map((i) => i.recipe.title).join('+')} / ${c.sides.map((i) => i.recipe.title).join('+')}` +
      `  ${ms}ms` +
      (r.relaxations.length ? '  [緩和: ' + r.relaxations.join(', ') + ']' : ''),
  );
  return { ok: within, ms };
};

let ng = 0;
let slowest = 0;
const check = (res) => {
  if (!res.ok) ng++;
  slowest = Math.max(slowest, res.ms);
};

console.log('\n[まとめて作る] 上限はまとめて1回ぶん');
for (const m of [null, 90, 60, 45, 30, 20]) {
  check(run('batch', m == null ? { wants: [], avoidTags: [] } : { wants: [], avoidTags: [], timeCapMinutes: m }, m == null ? '指定なし' : m + '分まで'));
}

console.log('\n[毎日作る] 上限は1日あたり');
for (const m of [null, 45, 30, 20, 15, 10]) {
  check(run('daily', m == null ? { wants: [], avoidTags: [] } : { wants: [], avoidTags: [], timeCapMinutes: m }, m == null ? '指定なし' : m + '分まで'));
}

console.log('\n[食材の希望] 食べたい/避けたいが両方向で効くか');
for (const tag of ['鶏肉', '豚肉', '魚', 'パスタ']) {
  check(run('batch', { wants: [{ tag, meals: 2 }], avoidTags: [] }, tag + ' 2日'));
}
for (const tag of ['鶏肉', '豚肉', '魚', 'パスタ']) {
  check(run('batch', { wants: [], avoidTags: [tag] }, tag + 'なし'));
}

console.log('\n[併用] 時短と食材の希望を同時に');
check(run('batch', { wants: [{ tag: '魚', meals: 2 }], avoidTags: [], timeCapMinutes: 30 }, '魚2日+30分'));
check(run('daily', { wants: [{ tag: '鶏肉', meals: 2 }], avoidTags: [], timeCapMinutes: 10 }, '鶏2日+1日10分'));
check(run('daily', { wants: [], avoidTags: [], timeCapMinutes: 6 }, '1日6分（届かない）', true));

// --- 飽きの許容範囲 --------------------------------------------------------
// 14食（朝昼晩の作り置き）で、同じ主菜が何食に載るか。
// 「朝昼晩まったく同じ」になっていないことを数字で確かめる
console.log('');
console.log('[飽きの許容範囲] 14食を配ったとき、同じ主菜が載る最大食数');
for (const limit of [7, 5, 3, 2]) {
  const inp = { ...base('batch'), meals: 14, budgetYen: 12000, maxSameDishMeals: limit,
    maxRecipesPerWeek: Math.max(4, Math.ceil(14 / limit) * 2) };
  const t0 = Date.now();
  const r = solveWithRequest(inp);
  const ms = Date.now() - t0;
  const c = r.candidates[0];
  if (!c) { console.log(`  上限${limit}食: 解なし ${ms}ms`); ng++; continue; }
  const menus = buildDailyMenus(c.mains, c.sides, c.ricePlan, c.riceServings, 14, inp.target.kcal, limit);
  const count = new Map();
  const mainIds = new Set(c.mains.map((i) => i.recipe.id));
  for (const day of menus)
    for (const p of day)
      if (mainIds.has(p.recipe.id)) count.set(p.recipe.title, (count.get(p.recipe.title) ?? 0) + 1);
  const worst = Math.max(...count.values());
  const ok = worst <= limit;
  if (!ok) ng++;
  slowest = Math.max(slowest, ms);
  console.log(
    `  上限${limit}食: ${ok ? 'OK ' : 'NG '}実測${worst}食 / 主菜${c.mains.length}品 ` +
    `${c.estimatedCostYen}円 ${c.handsOnMinutes}分  ` +
    [...count.entries()].map(([t, n]) => `${t}x${n}`).join(' ') + `  ${ms}ms`,
  );
}

// --- 主食の重なり ----------------------------------------------------------
// 「パスタ + ごはん」「焼きそば + 丼」のような、誰も食べない組合せが
// 1食の中に出ていないか。主食を兼ねる品は1食に1つまで、ごはんは付けない
console.log('');
console.log('[主食の重なり] 1食に主食が2つ入っていないか');
for (const tag of ['麺', 'パスタ', 'カレー']) {
  const inp = {
    ...base('batch'),
    meals: 14,
    budgetYen: 12000,
    requiredTagMeals: [{ tag, meals: 4 }],
  };
  const t0 = Date.now();
  const r = solveWithRequest(inp);
  const ms = Date.now() - t0;
  const c = r.candidates[0];
  if (!c) { console.log(`  ${tag.padEnd(5)} 解なし（この条件では組めない） ${ms}ms`); continue; }
  const menus = buildDailyMenus(
    c.mains, c.sides, c.ricePlan, c.riceServings, 14, inp.target.kcal, inp.maxSameDishMeals,
  );
  let worst = null;
  for (const day of menus) {
    const staples = day.filter((p) => p.recipe.tags.includes('主食込み'));
    const rice = day.filter((p) => p.recipe.role === 'staple');
    if (staples.length > 1 || (staples.length > 0 && rice.length > 0)) {
      worst = [...staples, ...rice].map((p) => p.recipe.title).join(' + ');
      break;
    }
  }
  slowest = Math.max(slowest, ms);
  if (worst) { ng++; console.log(`  ${tag.padEnd(5)} NG ${worst}  ${ms}ms`); }
  else {
    const sample = menus.find((d) => d.some((p) => p.recipe.tags.includes('主食込み')));
    console.log(
      `  ${tag.padEnd(5)} OK ${(sample ?? menus[0]).map((p) => p.recipe.title).join(' / ')}  ${ms}ms`,
    );
  }
}

// --- アレルゲン ------------------------------------------------------------
// 指定したアレルゲンが献立から本当に消えるか。ここは緩和されてはいけない
console.log('');
console.log('[アレルゲン] 指定したものが献立に残っていないか');
for (const tag of ['egg', 'wheat', 'soy', 'chicken', 'mackerel']) {
  const inp = { ...base('batch'), bannedAllergens: new Set([tag]) };
  const t0 = Date.now();
  const r = solveWithRequest(inp);
  const ms = Date.now() - t0;
  const c = r.candidates[0];
  if (!c) { console.log(`  ${tag.padEnd(9)} 解なし（この条件では組めない） ${ms}ms`); continue; }
  const all = [...c.mains, ...c.sides, ...(c.ricePlan ? [c.ricePlan] : [])];
  const leaked = all.filter((i) => i.recipe.allergens.includes(tag)).map((i) => i.recipe.title);
  if (leaked.length > 0) ng++;
  slowest = Math.max(slowest, ms);
  console.log(
    `  ${tag.padEnd(9)} ${leaked.length === 0 ? 'OK ' : 'NG '}` +
    `${all.map((i) => i.recipe.title).join(' / ')}` +
    (leaked.length ? '  <- 混入: ' + leaked.join(',') : '') + `  ${ms}ms`,
  );
}

console.log(`\n結果: NG ${ng} 件 / 最も遅い解 ${slowest}ms`);
process.exit(ng > 0 || problems.length > 0 ? 1 : 0);
