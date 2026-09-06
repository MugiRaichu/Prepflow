/**
 * 週プランの生成と保存。
 *
 * 目標の考え方: 1日の目標を食事枠で按分し、カバーする枠の分だけを対象にする。
 * 夕食だけ作り置きするなら、1日の40%を狙う（朝25% / 昼35% / 夕40% / 間食10%）。
 *
 * 複数人のときは各自の1食あたり目標を合計する。作る総量はそれで合うが、
 * 1人ずつの詰め分けは容器の割当（ContainerAssignment）で行う。
 * 目標が大きく違う人が同居する場合の最適化は v0.5。
 */
import { db, newEntity, nowIso } from '@/db/db';
import { addDaysIso, sortSlots, todayIso } from '@/lib/labels';
import { sumMacros } from '@/lib/nutrition';
import { applyRequest, solveWithRequest, EMPTY_REQUEST } from './request';
import { modeFor, requiredKeepDays } from './cadence';
import type { WeekRequest } from './request';
import { buildShoppingList, listTotal } from './shoppingList';
import { dueSoon, predictStaples } from '@/db/repositories/staples';
import { getDefaultStore } from '@/db/repositories/stores';
import { buildDailyMenus, gramsPerServing, portionMacros } from './distribute';
import type { WeekPlanCandidate } from './types';
import type {
  AllergenTag,
  CookingMode,
  Ingredient,
  InventoryItem,
  Recipe,
  Macros,
  MealSlot,
  Profile,
  ShoppingList,
  Weekday,
  WeekPlan,
} from '@/db/schema';

/**
 * 何品まで作るか。ユーザーは「今週は何品」で考えないので設定させず、
 * 使える調理時間から導く。30分でだいたい1品が目安。
 *
 * ただし飽きの許容範囲のほうが優先。14食を「同じ主菜は3食まで」で埋めるには
 * 主菜だけで5品要る。時間から出した上限がそれを下回ると、
 * 品数が理由で解が消える（利用者からは「なぜか組めない」としか見えない）。
 */
export function recipeCountFor(
  maxPrepMinutes: number,
  meals = 0,
  maxSameDishMeals = 3,
): number {
  const byTime = Math.min(Math.max(Math.round(maxPrepMinutes / 30), 2), 6);
  // 主菜と副菜の両方に飽きの上限がかかるので、必要な品数はおよそ2倍になる
  const byVariety = Math.ceil(meals / Math.max(maxSameDishMeals, 1)) * 2;
  return Math.max(byTime, Math.min(byVariety, 12));
}

/** 1日の目標を食事枠に按分する比率 */
const SLOT_SHARE: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.4,
  snack: 0.1,
};

/** その人の、カバー対象1枠あたりの目標 */
export function perSlotTarget(p: Profile, slots: MealSlot[]): Macros {
  const active = p.activeSlots.length ? p.activeSlots : (['breakfast', 'lunch', 'dinner'] as MealSlot[]);
  const denom = active.reduce((n, s) => n + SLOT_SHARE[s], 0) || 1;
  const covered = slots.filter((s) => active.includes(s));
  const share = covered.reduce((n, s) => n + SLOT_SHARE[s], 0) / denom;
  const perSlot = covered.length > 0 ? share / covered.length : 0;
  const t = p.baseTargets;
  return {
    kcal: t.kcal * perSlot,
    proteinG: t.proteinG * perSlot,
    fatG: t.fatG * perSlot,
    carbG: t.carbG * perSlot,
  };
}

export interface GenerateContext {
  profiles: Profile[];
  meals: number;
  /** カバーする食事枠。日ごとの表示で日付と枠を出し分けるのに使う */
  slots: MealSlot[];
  /** この日（0始まり）以降は冷蔵では持たないので冷凍に回す。不要なら null */
  freezeFromDay: number | null;
  /** 作り方。画面の表記を変えるのに使う */
  mode: CookingMode;
  /** daily のとき、1日あたりの調理時間の目安（分） */
  cookDays: number;
  /** 同じ主菜を何食まで載せてよいか。日別の割り振りで守る */
  maxSameDishMeals: number;
  target: Macros;
  weekStart: string;
  /** 週の途中で作り直すときの情報。通常の週プランでは undefined */
  replan?: ReplanInfo;
  /** 家にある食材の見込み価値（円）。0 なら在庫なし */
  inventoryCoveredYen: number;
  /** この回だけ外した食材の名前。何を避けて組んだのかを画面で言うために持つ */
  excludedNames: string[];
  /** 買い出しに行かない前提で組んだか。画面の言い方が変わる */
  stockOnly: boolean;
  /** そのとき候補にできた料理の数。少なすぎるなら諦めてもらうしかない */
  stockPoolSize: number;
}

/**
 * 週の途中の作り直し。
 *
 * 対象は「今日以降で、まだ作っていない日」だけ。
 * すでに作って詰めた日（容器が packed）は食べるものが冷蔵庫にあるので触らない。
 * 買い終えた買い出しリストは支出の記録として残し、まだのものだけ差し替える。
 */
export interface ReplanInfo {
  planId: string;
  /** 作り直す日 */
  dates: string[];
  /** 作ったぶんがあるので残す日 */
  lockedDates: string[];
}

/**
 * 家にある食材を引いた、レシピごとの「買わなければならない分」の原価。
 *
 * 在庫は複数のレシピで取り合うが、ここでは各レシピが単独で在庫を使えるものとして
 * 計算する（厳密に配ると探索の中で在庫を追う必要があり、重い）。
 * 目的は順位づけであって精算ではないので、この近似で足りる。
 */
function effectiveCosts(
  recipes: Recipe[],
  ingredients: Map<string, Ingredient>,
  inventory: InventoryItem[],
): { costOf: Map<string, number>; coveredYen: number } {
  const stock = new Map<string, number>();
  for (const inv of inventory) {
    if (inv.deleted === 1) continue;
    stock.set(inv.ingredientId, (stock.get(inv.ingredientId) ?? 0) + inv.quantity);
  }

  const yenFor = (ing: Ingredient, grams: number) =>
    (grams / Math.max(ing.purchase.gramsPerUnit, 1)) * ing.purchase.typicalPriceYen;

  const costOf = new Map<string, number>();
  for (const r of recipes) {
    let yen = 0;
    for (const ri of r.ingredients) {
      const ing = ingredients.get(ri.ingredientId);
      if (!ing) continue;
      const missing = Math.max(0, ri.quantity - (stock.get(ri.ingredientId) ?? 0));
      yen += yenFor(ing, missing);
    }
    costOf.set(r.id, Math.round(yen));
  }

  // 家にある食材の価値。調味料は常にあるものなので数えない
  let coveredYen = 0;
  for (const [id, grams] of stock) {
    const ing = ingredients.get(id);
    if (!ing || ing.isStaple === 1) continue;
    coveredYen += yenFor(ing, grams);
  }
  return { costOf, coveredYen: Math.round(coveredYen) };
}

/** 週の起点日（設定の weekStartsOn に合わせて、今日以降で最も近い日） */
export function nextWeekStart(weekStartsOn: Weekday): string {
  const today = todayIso();
  const dow = new Date(today + 'T00:00:00').getDay();
  const delta = (weekStartsOn - dow + 7) % 7;
  return addDaysIso(today, delta);
}

export interface ProposeOptions {
  /**
   * 買い出しに行かない。**家にあるものだけで組む。**
   *
   * 作り直しは、たいてい買い出しのあとに起きる。もう一度店に行けるとは限らない。
   * 行けないなら、いま家にあるもので作れるものだけを候補にする。
   */
  stockOnly?: boolean;
  /**
   * この回だけ使わない食材。
   *
   * 買ったにんじんが傷んでいた、店に無かった、という当日の事故に使う。
   * 設定の「除外」と違って残さない。理由が消えれば次の週には戻ってくる。
   */
  withoutIngredientIds?: string[];
  /**
   * この日から作り直す（週の途中の変更）。
   * 指定すると、いまの週プランの残りの日だけを対象にし、
   * 家にある食材を優先し、使った予算を差し引く。
   */
  fromDate?: string;
}

/** 候補を出す。保存はしない（画面で選ばせてから保存する） */
export async function proposeWeek(
  request: WeekRequest = EMPTY_REQUEST,
  opts: ProposeOptions = {},
): Promise<{
  candidates: WeekPlanCandidate[];
  rejections: Record<string, number>;
  relaxations: string[];
  budgetUsedYen: number;
  /** 時間以外を満たせる最短の調理時間（分）。時短の希望に数字で答えるために返す */
  minFeasibleMinutes: number | null;
  ctx: GenerateContext;
}> {
  const settings = await db.settings.get('singleton');
  if (!settings) throw new Error('settings not initialized');

  const profiles = (await db.profiles.where('deleted').equals(0).toArray()).filter(
    (p) => p.isActive === 1,
  );
  const recipes = await db.recipes.where('deleted').equals(0).toArray();
  // 現在のライフステージ。無ければ「まとめて作る」の既定で動く
  const household = (await db.households.where('isCurrent').equals(1).toArray())[0];

  // 作り方は暮らしのプリセットではなく、実際の調理回数から決める
  const sessions = Math.max(1, settings.cooking.cookSessionsPerWeek ?? 1);
  const mode = modeFor(sessions);

  const slots = sortSlots(settings.cooking.coverSlots);

  // 週の途中で作り直す場合: いまの週プランの残りの日だけを対象にする。
  // すでに作って詰めた日は食べるものが冷蔵庫にあるので残し、それ以外の今日以降を組み直す
  let replan: ReplanInfo | undefined;
  let weekStart = nextWeekStart(settings.weekStartsOn);
  let dayCount = settings.cooking.coverDays;
  let budgetYen = settings.shopping.weeklyBudgetYen;
  const previousRecipeIds = new Set<string>();

  if (opts.fromDate) {
    const from = opts.fromDate;
    const cur = (await db.weekPlans.where('deleted').equals(0).reverse().sortBy('weekStart'))[0];
    if (!cur) throw new Error('作り直す献立がありません');

    const weekDates = Array.from({ length: settings.cooking.coverDays }, (_, i) =>
      addDaysIso(cur.weekStart, i),
    );
    const packed = (await db.containerAssignments.where('weekPlanId').equals(cur.id).toArray()).filter(
      (a) => a.packed === 1 && a.deleted === 0,
    );
    const locked = new Set(packed.map((a) => a.intendedDate));
    const dates = weekDates.filter((d) => d >= from && !locked.has(d));
    if (dates.length === 0) {
      throw new Error('作り直せる日がありません。作ったぶんを食べ終えてから作り直してください');
    }

    replan = {
      planId: cur.id,
      dates,
      lockedDates: weekDates.filter((d) => d >= from && locked.has(d)),
    };
    weekStart = dates[0]!;
    dayCount = dates.length;
    // 変えたいと言っているので、いまの献立の料理は避ける（禁止ではなく減点）
    for (const id of cur.recipeIds) previousRecipeIds.add(id);

    // 使った予算を引く。ただし3割は残す（ゼロにすると何も組めない）
    const lists = await db.shoppingLists.where('weekPlanId').equals(cur.id).toArray();
    const spent = lists
      .filter((l) => l.status === 'done')
      .reduce((n, l) => n + (l.actualTotalYen ?? l.estimatedTotalYen), 0);
    budgetYen = Math.max(Math.round(budgetYen * 0.3), budgetYen - spent);
  }

  const meals = dayCount * slots.length;
  const target = sumMacros(profiles.map((p) => perSlotTarget(p, slots)));

  // 家にある食材はただ同然として扱う。今週の余りを使う案が自然に勝ち、
  // 次の週も同じ計算なので、余った食材は何もしなくても来週へ回る
  const inventory = await db.inventory.where('deleted').equals(0).toArray();
  const stock = new Map<string, number>();
  for (const inv of inventory) {
    if (inv.deleted === 1) continue;
    stock.set(inv.ingredientId, (stock.get(inv.ingredientId) ?? 0) + inv.quantity);
  }
  const ingredientMap = new Map<string, Ingredient>(
    (await db.ingredients.where('deleted').equals(0).toArray()).map((i) => [i.id, i]),
  );
  const { costOf, coveredYen } = effectiveCosts(recipes, ingredientMap, inventory);

  // ハード制約（アレルゲン・除外）とソフト制約（苦手）を食材IDに解決する
  const banned = new Set<string>();
  const disliked = new Map<string, number>();
  // アレルゲンは食材IDではなくタグで持つ。同居人がいれば全員分の和집合になる
  const bannedAllergens = new Set<AllergenTag>();
  for (const p of profiles) {
    for (const a of p.allergens ?? []) bannedAllergens.add(a);
    for (const tag of p.preferences) {
      const ids = tag.ingredientIds ?? [];
      if (tag.kind === 'allergen' || tag.kind === 'exclude') {
        for (const id of ids) banned.add(id);
      } else if (tag.kind === 'dislike') {
        for (const id of ids) disliked.set(id, Math.max(disliked.get(id) ?? 0, tag.weight ?? 0.5));
      }
    }
  }

  // その場で使えなくなった食材（傷んでいた・売り切れ）。
  // この回かぎりの除外で、設定には残さない。次の週にはまた候補に戻る
  for (const id of opts.withoutIngredientIds ?? []) banned.add(id);

  const recent = new Set(
    recipes.filter((r) => r.lastCookedAt && r.lastCookedAt > addDaysIso(todayIso(), -10)).map((r) => r.id),
  );
  for (const id of previousRecipeIds) recent.add(id);

  /*
   * 買い出しに行かないときの候補。
   *
   * 家にある量で足りる料理だけを残す。常備品（調味料）は在庫として数えない
   * ——しょうゆが切れていることは滅多になく、切れていたら献立以前の問題。
   *
   * 8割で足りるとみなすのは、棚卸しの見込みがそこまで正確ではないため。
   * ちょうどで切ると、実際には作れるものまで落ちる。
   */
  const STOCK_TOLERANCE = 0.8;
  const cookableFromStock = (r: Recipe): boolean =>
    r.ingredients.every((it) => {
      const ing = ingredientMap.get(it.ingredientId);
      if (!ing || ing.isStaple === 1) return true;
      return (stock.get(it.ingredientId) ?? 0) >= it.quantity * STOCK_TOLERANCE;
    });

  const pool = opts.stockOnly ? recipes.filter(cookableFromStock) : recipes;

  const result = solveWithRequest(
    applyRequest(
      {
        recipes: pool,
        meals,
        target,
        budgetYen,
        maxPrepMinutes: settings.cooking.maxPrepMinutes,
        // 品数はユーザーに決めさせない。使える調理時間から導く
        maxRecipesPerWeek: recipeCountFor(
          settings.cooking.maxPrepMinutes,
          meals,
          settings.cooking.maxSameDishMeals ?? 3,
        ),
        // 次に作るまで持てばよい。週3回作るなら2〜3日で足りる。作り直しは1回で残りぶん
        maxFridgeDays: Math.min(
          settings.cooking.maxFridgeDays,
          requiredKeepDays(dayCount, replan ? 1 : sessions),
        ),
        costOverride: costOf,
        allowFreezing: settings.cooking.allowFreezing,
        bannedIngredientIds: banned,
        bannedAllergens: bannedAllergens,
        dislikedIngredientIds: disliked,
        recentRecipeIds: recent,
        requiredTagMeals: [],
        avoidTags: [],
        maxKcalDeviation: 0.25,
        mode,
        maxDailyCookMinutes: household?.cooking.maxDailyCookMinutes ?? 30,
        // 「何日ぶんをカバーするか」ではなく「週に何回作るか」で割る。
        // 週2回しか作らない人の調理時間を7で割ってはいけない
        cookDays: sessions,
        maxProteinDeviation: 0.2,
        minFatRatio: 0.6,
        maxSameDishMeals: settings.cooking.maxSameDishMeals ?? 3,
        // 既定値は設定画面の値。今週の希望で上書きされたときだけ true になる
        timeCapIsExplicit: false,
      },
      request,
    ),
  );

  return {
    candidates: result.candidates,
    rejections: result.rejections,
    relaxations: result.relaxations,
    budgetUsedYen: result.budgetUsedYen,
    minFeasibleMinutes: result.minFeasibleMinutes,
    ctx: {
      profiles,
      meals,
      slots,
      mode,
      cookDays: sessions,
      // 緩和後の値を使う。設定値のまま配ると、ソルバーが4食ぶんとして組んだ案を
      // 3食にしか配れず、最後の食が空になる
      maxSameDishMeals: result.maxSameDishMeals,
      // 毎日その日に作るなら保存しないので、冷凍の案内は出さない。
      // 週に何回か作る場合も、次に作るまでが maxFridgeDays 以内なら要らない
      freezeFromDay:
        mode !== 'daily' &&
        requiredKeepDays(dayCount, replan ? 1 : sessions) > settings.cooking.maxFridgeDays
          ? settings.cooking.maxFridgeDays
          : null,
      target,
      weekStart,
      ...(replan ? { replan } : {}),
      excludedNames: (opts.withoutIngredientIds ?? [])
        .map((id) => ingredientMap.get(id)?.name)
        .filter((n): n is string => Boolean(n)),
      stockOnly: Boolean(opts.stockOnly),
      stockPoolSize: pool.length,
      inventoryCoveredYen: coveredYen,
    },
  };
}

/** 選んだ候補を保存する。既存の同じ週のプランは置き換える */
export async function commitWeek(
  plan: WeekPlanCandidate,
  ctx: GenerateContext,
): Promise<WeekPlan> {
  const settings = await db.settings.get('singleton');
  if (!settings) throw new Error('settings not initialized');

  const ingredients = new Map<string, Ingredient>(
    (await db.ingredients.where('deleted').equals(0).toArray()).map((i) => [i.id, i]),
  );
  // 家にあるものは買わない
  const inventory = await db.inventory.where('deleted').equals(0).toArray();

  // 在庫が足りる常備品でも、切れる見込みが近いものは載せる。
  // 残量の積算は当てにならないので、買った日からの間隔で判断する。
  // トランザクションの中からは別ストアを読めないので、ここで先に済ませる
  const usage = new Map<string, number>();
  for (const it of [...plan.mains, ...plan.sides, ...(plan.ricePlan ? [plan.ricePlan] : [])]) {
    for (const ri of it.recipe.ingredients) {
      usage.set(ri.ingredientId, (usage.get(ri.ingredientId) ?? 0) + ri.quantity * it.batches);
    }
  }
  const due = dueSoon(await predictStaples(usage, settings.shopping.outsideUseRatio));

  // 見込み金額は、よく行く店の価格水準で補正する
  const store = await getDefaultStore();

  const slots = sortSlots(settings.cooking.coverSlots);
  const replan = ctx.replan;
  const days = replan ? replan.dates.length : settings.cooking.coverDays;
  const recipeIds = [
    ...plan.mains.map((i) => i.recipe.id),
    ...plan.sides.map((i) => i.recipe.id),
    ...(plan.ricePlan ? [plan.ricePlan.recipe.id] : []),
  ];

  return db.transaction(
    'rw',
    [db.weekPlans, db.plannedMeals, db.containerAssignments, db.shoppingLists, db.shoppingListItems, db.meta],
    async () => {
      let weekPlan: WeekPlan;
      // 容器のラベル通し番号。作り直しでは残した容器の続きから振る
      let labelSeq = 0;

      if (replan) {
        // 週の途中の作り直し。プランは同じものを更新する（週に1つ、という前提を崩さない）。
        // 消すのは作り直す日のぶんだけ。作って詰めた容器と、買い終えたリストは残す
        const cur = await db.weekPlans.get(replan.planId);
        if (!cur) throw new Error('作り直す献立が見つかりません');
        const dates = new Set(replan.dates);

        const oldMeals = await db.plannedMeals.where('weekPlanId').equals(cur.id).toArray();
        for (const m of oldMeals) if (dates.has(m.date)) await db.plannedMeals.delete(m.id);
        const oldConts = await db.containerAssignments.where('weekPlanId').equals(cur.id).toArray();
        for (const c of oldConts) {
          if (dates.has(c.intendedDate) && c.packed === 0) await db.containerAssignments.delete(c.id);
        }
        const oldLists = await db.shoppingLists.where('weekPlanId').equals(cur.id).toArray();
        for (const l of oldLists) {
          if (l.status === 'done') continue;
          await db.shoppingListItems.where('shoppingListId').equals(l.id).delete();
          await db.shoppingLists.delete(l.id);
        }
        // 作り置きの進みは、新しい段取りで最初から
        await db.meta.delete('cookDone:' + cur.id);
        await db.meta.delete('cookConsumed:' + cur.id);

        // 容器のラベルは、残した容器の続きから振る。
        // 毎回1から振ると、2回目の作り直しで前のラベルと同じ番号が出て、
        // 冷蔵庫の中で見分けがつかなくなる（実際に B1 が2つできた）
        const kept = await db.containerAssignments.where('weekPlanId').equals(cur.id).toArray();
        labelSeq = kept.reduce((max, c) => {
          const n = Number(c.containerLabel.replace(/^\D+/, ''));
          return Number.isFinite(n) ? Math.max(max, n) : max;
        }, 0);

        weekPlan = {
          ...cur,
          recipeIds,
          estimatedCostYen: plan.estimatedCostYen,
          notes: plan.notes.join(' / '),
          updatedAt: nowIso(),
        };
        await db.weekPlans.put(weekPlan);
      } else {
        // 同じ週の古いプランを消す（作り直しのたびに増えないように）
        const old = await db.weekPlans.where('weekStart').equals(ctx.weekStart).first();
        if (old) {
          await db.plannedMeals.where('weekPlanId').equals(old.id).delete();
          await db.containerAssignments.where('weekPlanId').equals(old.id).delete();
          const oldLists = await db.shoppingLists.where('weekPlanId').equals(old.id).toArray();
          for (const l of oldLists) await db.shoppingListItems.where('shoppingListId').equals(l.id).delete();
          await db.shoppingLists.where('weekPlanId').equals(old.id).delete();
          await db.weekPlans.delete(old.id);
          // 進み具合の記録も一緒に消す。残すと読まれないゴミが溜まり続ける
          await db.meta.delete('cookDone:' + old.id);
          await db.meta.delete('cookConsumed:' + old.id);
        }

        weekPlan = {
          ...newEntity(),
          weekStart: ctx.weekStart,
          status: 'draft',
          profileIds: ctx.profiles.map((p) => p.id),
          recipeIds,
          budgetYen: settings.shopping.weeklyBudgetYen,
          estimatedCostYen: plan.estimatedCostYen,
          calorieAdjustFactor: 1,
          notes: plan.notes.join(' / '),
        };
        await db.weekPlans.add(weekPlan);
      }

      // 日ごとに違う組合せを作る。買い物も調理も変えず、詰める中身だけを日替わりにする
      const menus = buildDailyMenus(
        plan.mains,
        plan.sides,
        plan.ricePlan,
        plan.riceServings,
        ctx.meals,
        ctx.target.kcal,
        ctx.maxSameDishMeals,
      );

      // 日ごとにごはんの量を変えた結果、必要な合計が変わる。
      // 買い出しリストを作る前にバッチ数を実測値へ合わせる
      if (plan.ricePlan) {
        const riceId = plan.ricePlan.recipe.id;
        const actual = menus
          .flat()
          .filter((p) => p.recipe.id === riceId)
          .reduce((n2, p) => n2 + p.servings, 0);
        plan.ricePlan = actual > 0
          ? {
              ...plan.ricePlan,
              totalServings: actual,
              batches: Math.max(1, Math.ceil(actual / plan.ricePlan.recipe.servings)),
            }
          : undefined;
      }

      // 人数で割った1人あたりの取り分
      const n = Math.max(ctx.profiles.length, 1);
      let mealIndex = 0;

      for (let d = 0; d < days; d++) {
        const date = replan ? replan.dates[d]! : addDaysIso(ctx.weekStart, d);
        for (const slot of slots) {
          const portions = menus[mealIndex++] ?? [];
          const nutrition = portionMacros(portions);
          const items = portions.map((p) => ({
            recipeId: p.recipe.id,
            recipeTitle: p.recipe.title,
            grams: Math.round((p.servings * gramsPerServing(p.recipe)) / n),
          }));

          // その日の主菜（人前が最も多い品）を代表として扱う
          const lead = [...portions].sort((a, b) => b.servings - a.servings)[0];
          // 賞味期限は、その日に使う品の中で最も短い保存日数に合わせる
          const keeps = portions.length
            ? Math.min(...portions.map((p) => p.recipe.storage.keepsDays))
            : settings.cooking.maxFridgeDays;

          // 冷蔵で持つ日数を超える日ぶんは冷凍に回す。
          // これを冷蔵のままにすると、5日目に傷んだものを食べることになる。
          //
          // 上限は自己ルール（maxFridgeDays）だけでは足りない。品によっては
          // それより先に傷む（ゆで野菜は2日）ので、短いほうに合わせる。
          // ここを自己ルールだけで見ていたとき、保存2日の副菜が4日目まで
          // 冷蔵に置かれ、賞味期限が食べる日より前になっていた
          const limitDays = Math.min(settings.cooking.maxFridgeDays, keeps);
          const freeze = d >= limitDays && settings.cooking.allowFreezing;

          for (const profile of ctx.profiles) {
            const label = 'A' + (++labelSeq);

            await db.containerAssignments.add({
              ...newEntity(),
              weekPlanId: weekPlan.id,
              containerLabel: label,
              recipeId: lead?.recipe.id ?? '',
              recipeTitle: items.map((i) => i.recipeTitle).join(' + '),
              profileId: profile.id,
              profileName: profile.name,
              grams: items.reduce((g, i) => g + i.grams, 0),
              nutrition: { ...nutrition },
              intendedDate: date,
              intendedSlot: slot,
              storage: freeze ? 'freezer' : 'fridge',
              keepsDays: freeze ? 30 : Math.min(keeps, settings.cooking.maxFridgeDays),
              // 実際に作る日は詰めるときに確定する。ここは仮置き（PackStep で引き直す）
              useByDate: addDaysIso(ctx.weekStart, freeze ? 30 : keeps),
              packed: 0,
            });

            await db.plannedMeals.add({
              ...newEntity(),
              weekPlanId: weekPlan.id,
              profileId: profile.id,
              date,
              slot,
              items,
              nutrition: { ...nutrition },
              status: 'planned',
            });
          }
        }
      }

      const shoppingList: ShoppingList = {
        ...newEntity(),
        weekPlanId: weekPlan.id,
        shoppingDate: ctx.weekStart,
        storeId: store.id,
        budgetYen: settings.shopping.weeklyBudgetYen,
        estimatedTotalYen: 0,
        status: 'ready',
      };
      const rows = buildShoppingList({
        plan,
        ingredients,
        inventory,
        sectionOrder: settings.shopping.sectionOrder,
        shoppingListId: shoppingList.id,
        priceFactor: store.priceFactor,
      });
      const listed = new Set(rows.map((r) => r.ingredientId));
      for (const d of due) {
        if (listed.has(d.ingredient.id)) continue;
        rows.push({
          ...newEntity(),
          shoppingListId: shoppingList.id,
          ingredientId: d.ingredient.id,
          name: d.ingredient.name,
          section: d.ingredient.section,
          sortIndex: rows.length,
          requiredQuantity: d.ingredient.purchase.gramsPerUnit,
          purchaseUnits: 1,
          unit: d.ingredient.purchase.unit,
          displayQuantity: 'そろそろ切れます',
          estimatedPriceYen: Math.round(
            d.ingredient.purchase.typicalPriceYen * store.priceFactor,
          ),
          checked: 0,
          usedByRecipeIds: [],
        });
      }

      shoppingList.estimatedTotalYen = listTotal(rows);
      await db.shoppingLists.add(shoppingList);
      await db.shoppingListItems.bulkAdd(rows);

      await db.weekPlans.update(weekPlan.id, {
        estimatedCostYen: shoppingList.estimatedTotalYen,
        updatedAt: nowIso(),
      });

      return weekPlan;
    },
  );
}
