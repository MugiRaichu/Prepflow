/**
 * 作った総量を「日ごとに違う組合せ」で配る。
 *
 * 均等に割ると5日とも同じ献立になって飽きる。買い物も調理も変えずに、
 * どの日に何を詰めるかだけを変えれば日替わりにできる。
 *
 * 方針: 各食で「残りが最も多い品」から取る。1品で埋まるならその日は1品になり、
 * 端数が出たときだけ2品が混ざる。
 *   例) 照り焼き4人前・そぼろ4人前を5食に配ると
 *       照り焼き / そぼろ / 照り焼き / そぼろ / 両方を半分ずつ
 */
import { RICE_MAX, RICE_STEP } from './solver';
import type { Macros, Recipe } from '@/db/schema';
import type { PlanItem } from './types';

export interface Portion {
  recipe: Recipe;
  /** その食に詰める人前 */
  servings: number;
}

const EPS = 1e-6;

export function distributeAcrossMeals(
  items: PlanItem[],
  meals: number,
  /** 1食に同じ品を詰められる上限（人前）。超えると食べきれない */
  maxPerDish: number,
  /** 同じ品を何食まで載せてよいか（飽きの許容範囲） */
  maxMealsPerDish = Infinity,
): Portion[][] {
  const empty = (): Portion[][] => Array.from({ length: Math.max(meals, 0) }, () => []);
  if (meals <= 0 || items.length === 0) return empty();

  const dishes = items
    .map((it) => ({ recipe: it.recipe, servings: it.totalServings }))
    .filter((d) => d.servings > EPS);
  if (dishes.length === 0) return empty();

  const total = dishes.reduce((n, d) => n + d.servings, 0);
  const capMeals = Math.min(maxMealsPerDish, meals);

  // --- 1. 各品を何食に載せるか決める ---------------------------------------
  // 「1食あたりの上限」で割ると、最低限必要な食数が出る。
  // そのうえで、量の多い品ほど多くの食に載るよう按分する
  const appear = dishes.map((d) => {
    const least = Math.ceil(d.servings / maxPerDish - EPS);
    const byShare = Math.round((meals * d.servings) / total);
    return Math.min(Math.max(least, byShare, 1), capMeals);
  });

  // どの食にも主菜が1品は載るように、足りなければ増やす。
  // 逆に多すぎると1食に何品も載って献立がぼやけるので、削る
  const sum = () => appear.reduce((n, a) => n + a, 0);
  for (let guard = 0; sum() < meals && guard < meals * 4; guard++) {
    // 1食あたりの量が最も多い品から増やす（増やしても薄くなりにくい）
    let best = -1;
    let bestRatio = 0;
    for (let i = 0; i < dishes.length; i++) {
      if (appear[i]! >= capMeals) continue;
      const ratio = dishes[i]!.servings / appear[i]!;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = i;
      }
    }
    if (best < 0) break;
    appear[best]! += 1;
  }
  for (let guard = 0; sum() > meals && guard < meals * 4; guard++) {
    let best = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < dishes.length; i++) {
      const least = Math.ceil(dishes[i]!.servings / maxPerDish - EPS);
      if (appear[i]! <= Math.max(least, 1)) continue;
      const ratio = dishes[i]!.servings / appear[i]!;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = i;
      }
    }
    if (best < 0) break;
    appear[best]! -= 1;
  }

  // --- 2. 食に割り当てる ----------------------------------------------------
  // 同じ品が続かないよう、各品の出番を等間隔に置いてから並べ替える。
  // 「3食に載せる品」なら 1/6, 3/6, 5/6 の位置に置く
  const slots: { dish: number; key: number }[] = [];
  for (let i = 0; i < dishes.length; i++) {
    for (let j = 0; j < appear[i]!; j++) {
      slots.push({ dish: i, key: (j + 0.5) / appear[i]! });
    }
  }
  slots.sort((a, b) => a.key - b.key || a.dish - b.dish);

  const perMeal: number[][] = Array.from({ length: meals }, () => []);

  /** 主食を兼ねる品（パスタ・麺・カレー・丼）。1食に2つ来ると成立しない */
  const isStaple = dishes.map((d) => d.recipe.tags.includes('主食込み'));
  /** その品の主材料。1食に同じ材料の品が2つ来るのを避けるのに使う */
  const leadIng = dishes.map((d) => leadIngredientOf(d.recipe));

  /*
   * その食にこの品を置いてよいか。
   *
   * 1. 同じ品を同じ食に2回入れない。入れると献立が
   *    「小松菜のおひたし + 小松菜のおひたし」と並ぶ（実際にそうなった）
   * 2. **主食を兼ねる品どうしを同じ食に入れない。**
   *    「パスタ + 焼きそば」「カレー + 丼」は誰も食べない。
   *    ごはんを付けない規則（buildDailyMenus）だけでは、主菜どうしの
   *    重なりは防げなかった
   * 3. **主材料が同じ品を同じ食に入れない。**
   *    実際に「にんじんのはちみつ煮 + にんじんのきんぴら」が同じ日に出た。
   *    別のレシピなので 1 は通り抜けるが、食べる側から見れば
   *    にんじんが2皿並んだだけ。品数は増えても献立にはなっていない。
   */
  const canPlace = (mealIdx: number, dish: number): boolean => {
    const cur = perMeal[mealIdx]!;
    if (cur.includes(dish)) return false;
    if (isStaple[dish] && cur.some((j) => isStaple[j])) return false;
    if (leadIng[dish] && cur.some((j) => leadIng[j] === leadIng[dish])) return false;
    return true;
  };

  // 先頭から1食に1品ずつ。余った出番は、位置に応じた食に2品目として足す。
  // 希望の位置が埋まっていたら、前後の近い食から空いているところを探す
  slots.forEach((s, k) => {
    const want = k < meals ? k : Math.min(meals - 1, Math.floor(s.key * meals));
    let meal = want;
    if (!canPlace(meal, s.dish)) {
      meal = -1;
      for (let d = 1; d < meals && meal < 0; d++) {
        for (const cand of [want - d, want + d]) {
          if (cand >= 0 && cand < meals && canPlace(cand, s.dish)) {
            meal = cand;
            break;
          }
        }
      }
      // どこにも置けないなら諦めて元の位置へ（量だけ増える）
      if (meal < 0) meal = want;
    }
    perMeal[meal]!.push(s.dish);
  });

  // --- 3. 人前を割る --------------------------------------------------------
  // 端数の丸めで総量がずれないよう、最後の出番で残り全部を引き取る
  const left = dishes.map((d) => d.servings);
  const remainingSlots = appear.slice();
  const out: Portion[][] = [];
  for (let m = 0; m < meals; m++) {
    const portions: Portion[] = [];
    for (const i of perMeal[m]!) {
      remainingSlots[i]! -= 1;
      const isLast = remainingSlots[i]! === 0;
      const raw = isLast ? left[i]! : Math.min(left[i]!, dishes[i]!.servings / appear[i]!);
      const servings = Math.round(raw * 10) / 10;
      if (servings > 0) {
        // 同じ品が同じ食に2回来たら、行を分けずに量を足す
        const same = portions.find((p) => p.recipe.id === dishes[i]!.recipe.id);
        if (same) same.servings = Math.round((same.servings + servings) * 10) / 10;
        else portions.push({ recipe: dishes[i]!.recipe, servings });
      }
      left[i]! = Math.max(0, left[i]! - servings);
    }
    out.push(portions);
  }
  return out;
}

/** 人前ぶんに伸ばした栄養。1品だけを詰める容器で使う */
export function macrosOf(per: Macros, servings: number): Macros {
  return {
    kcal: per.kcal * servings,
    proteinG: per.proteinG * servings,
    fatG: per.fatG * servings,
    carbG: per.carbG * servings,
  };
}

/** その食の栄養を、実際に詰める人前から計算する */
export function portionMacros(portions: Portion[]): Macros {
  return portions.reduce<Macros>(
    (acc, p) => ({
      kcal: acc.kcal + p.recipe.nutritionPerServing.kcal * p.servings,
      proteinG: acc.proteinG + p.recipe.nutritionPerServing.proteinG * p.servings,
      fatG: acc.fatG + p.recipe.nutritionPerServing.fatG * p.servings,
      carbG: acc.carbG + p.recipe.nutritionPerServing.carbG * p.servings,
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
  );
}

/** 日別メニューから1食あたりの平均を出す。画面に出す数字はこちらを正とする */
export function averageMacros(menus: Portion[][]): Macros {
  if (menus.length === 0) return { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 };
  const total = menus.reduce<Macros>(
    (acc, day) => {
      const m = portionMacros(day);
      return {
        kcal: acc.kcal + m.kcal,
        proteinG: acc.proteinG + m.proteinG,
        fatG: acc.fatG + m.fatG,
        carbG: acc.carbG + m.carbG,
      };
    },
    { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
  );
  const n = menus.length;
  return {
    kcal: total.kcal / n,
    proteinG: total.proteinG / n,
    fatG: total.fatG / n,
    carbG: total.carbG / n,
  };
}

/**
 * その料理の主材料。**最も重い材料を1つ選ぶ。**
 *
 * タグや名前からは判定できない（「にんじんのきんぴら」と
 * 「にんじんのはちみつ煮」を名前で結ぶ規則は書けない）。
 * 調味料は数gから数十gなので、重さで選べば自然に外れる。
 *
 * 完全ではない——同じ肉を使う2品も弾くことになるが、
 * 主菜と副菜は別々に配っているので、実害が出るのは
 * 「鶏の副菜が2皿」のような場合だけで、それも避けたい並びではある。
 */
export function leadIngredientOf(r: Recipe): string | undefined {
  let best: string | undefined;
  let bestGrams = 0;
  for (const i of r.ingredients) {
    if (i.quantity > bestGrams) {
      bestGrams = i.quantity;
      best = i.ingredientId;
    }
  }
  return best;
}

/** 1人前あたりのグラム数 */
export function gramsPerServing(r: Recipe): number {
  return r.servings > 0 ? r.yieldGrams / r.servings : 0;
}

/**
 * 週ぶんの日別メニューを組む。主菜は日替わり、副菜は2品程度。
 *
 * ごはんは毎食同量にしない。日替わりにすると主菜のカロリーが日ごとに変わるので、
 * ごはんの量で埋め合わせて1日あたりを揃える。
 * （たんぱく質の日ごとの差は残る。主菜の性質そのものなので、
 *   それを消そうとすると結局「毎日同じ」に戻ってしまう）
 */
export function buildDailyMenus(
  mains: PlanItem[],
  sides: PlanItem[],
  rice: PlanItem | undefined,
  riceServingsPerMeal: number,
  meals: number,
  /** 1食あたりの目標。渡すとごはんの量で日ごとのカロリーを揃える */
  targetKcal?: number,
  /** 同じ主菜を何食まで載せてよいか。飽きの許容範囲 */
  maxMealsPerDish?: number,
): Portion[][] {
  // 詰め方は選ばせない。作る手間は同じで、日替わりのほうが詰める作業は少ない
  const mainAlloc = distributeAcrossMeals(mains, meals, 2.0, maxMealsPerDish);
  const sideAlloc = distributeAcrossMeals(sides, meals, 1.3, maxMealsPerDish);

  const menus: Portion[][] = [];
  for (let m = 0; m < meals; m++) {
    menus.push([...(mainAlloc[m] ?? []), ...(sideAlloc[m] ?? [])]);
  }

  // 主菜と副菜を別々に配っているので、両方の端数が同じ日に落ちることがある。
  // ごはんを足す前に、おかずの側で日ごとの差を詰めておく
  levelKcal(menus);

  for (const day of menus) {
    // パスタなど主食を兼ねる主菜が入った日は、ごはんを付けない。
    // 数字の上では収まっても「パスタ＋ごはん」は誰も食べない
    const hasStapleDish = day.some((p) => p.recipe.tags.includes('主食込み'));
    if (!rice || riceServingsPerMeal <= 0 || hasStapleDish) continue;

    let servings = riceServingsPerMeal;
    const perServingKcal = rice.recipe.nutritionPerServing.kcal;
    if (targetKcal && perServingKcal > 0) {
      const without = portionMacros(day).kcal;
      const wanted = (targetKcal - without) / perServingKcal;
      // パスタなど主食を兼ねる主菜の日は、ごはんを 0 まで落とせるようにする。
      // 下限を持たせると「パスタ + ごはん」という食べない組合せが出る
      // 盛れる単位（0.5人前＝茶碗に軽く1杯）に丸める。solver.ts と同じ刻み。
      // 上限も先に丸めておく。あとから丸めると、上限を超えたところに着地する
      const hi = Math.floor(Math.min(riceServingsPerMeal * 1.8, RICE_MAX) / RICE_STEP) * RICE_STEP;
      const capped = Math.min(Math.max(wanted, 0), hi);
      servings = Math.round(capped / RICE_STEP) * RICE_STEP;
    }
    if (servings > 0) day.push({ recipe: rice.recipe, servings });
  }
  return menus;
}

/**
 * 日ごとのカロリーを均す。
 *
 * 主菜と副菜を別々に配っているので、どちらの端数も同じ日に落ちることがある。
 * 実際、5日のうち1日が 1374 kcal、別の2日が 399 kcal になっていた（本人指摘）。
 * **1食あたりの平均は目標と 0% 差でも、どの日も目標から外れていた。**
 * 平均だけを見ていたので、画面の数字は正しいのに献立は成立していなかった。
 *
 * 配り直しはしない。**多い日から少ない日へ、1品ずつ移すだけ。**
 * 総量は動かないので、買い物も調理も容器の数も変わらない。
 *
 * ごはんを足す前に呼ぶ。ごはんはこのあと日ごとに量を変えて微調整するので、
 * 先におかずの側の大きな段差を消しておくほうが、ごはんの振れ幅が小さくなる。
 */
function levelKcal(menus: Portion[][], maxMoves = 16): void {
  const kcalOf = (p: Portion) => p.recipe.nutritionPerServing.kcal * p.servings;
  const isStaple = (p: Portion) => p.recipe.tags.includes('主食込み');

  for (let move = 0; move < maxMoves; move++) {
    const kcal = menus.map((m) => portionMacros(m).kcal);
    let hi = 0;
    let lo = 0;
    for (let i = 1; i < menus.length; i++) {
      if (kcal[i]! > kcal[hi]!) hi = i;
      if (kcal[i]! < kcal[lo]!) lo = i;
    }
    const gap = kcal[hi]! - kcal[lo]!;
    if (hi === lo || gap < 1) return;

    // 空の日を作らない。1品しかない日から抜くと、その日が消える
    if (menus[hi]!.length <= 1) return;

    let best = -1;
    let bestGap = gap;
    for (let k = 0; k < menus[hi]!.length; k++) {
      const p = menus[hi]![k]!;
      // 同じ料理が1食に2回並ぶのを避ける（distributeAcrossMeals と同じ規則）
      if (menus[lo]!.some((q) => q.recipe.id === p.recipe.id)) continue;
      // 主食を兼ねる品どうしを同じ食に入れない
      if (isStaple(p) && menus[lo]!.some(isStaple)) continue;
      // 主材料が同じ品を同じ食に入れない（にんじん2皿にしない）
      const lead = leadIngredientOf(p.recipe);
      if (lead && menus[lo]!.some((q) => leadIngredientOf(q.recipe) === lead)) continue;
      const c = kcalOf(p);
      const after = Math.abs(kcal[hi]! - c - (kcal[lo]! + c));
      // 移して差が広がるなら移さない
      if (after < bestGap) {
        bestGap = after;
        best = k;
      }
    }
    // これ以上どこを動かしても縮まらない
    if (best < 0) return;
    menus[lo]!.push(menus[hi]!.splice(best, 1)[0]!);
  }
}
