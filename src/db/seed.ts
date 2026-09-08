/**
 * 初回起動時の投入データ。
 *
 * ここに入れてよいのは「ユーザー固有でない参照データ」だけ。
 * - 既定の AppSettings（すべて設定画面から変更できる初期値）
 * - 食材マスタの最小セット（source: 'builtin'）
 * プロファイル・器具・容器などユーザー固有のものは絶対に入れない。
 *
 * 栄養値は日本食品標準成分表（八訂）の概数。厳密値が必要なら設定画面で上書きする前提。
 */
import { db, newEntity, nowIso, SCHEMA_VERSION } from './db';
import type { InventoryItem } from './schema';
import { DEFAULT_SECTION_ORDER, type AppSettings, type Ingredient } from './schema';
import { BUILTIN_INGREDIENTS } from './data/ingredients';
import { BUILTIN_RECIPES } from './data/recipes';
import { buildRecipe, HIGH_PROTEIN_G, HIGH_PROTEIN_TAG } from './data/build';
import { recalcProfileTargets } from '@/lib/nutrition';

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'singleton',
  updatedAt: nowIso(),
  schemaVersion: SCHEMA_VERSION,
  locale: 'ja-JP',
  theme: 'dark',
  weekStartsOn: 1,
  shopping: {
    shoppingDay: 6,
    weeklyBudgetYen: 5000,
    sectionOrder: DEFAULT_SECTION_ORDER,
    roundUpToPurchaseUnit: true,
    outsideUseRatio: 0.3,
  },
  cooking: {
    prepDay: 0,
    prepDays: [0],
    maxPrepMinutes: 120,
    allowFreezing: true,
    // 主菜1品が週3食まで。5食なら2品、14食なら5品が要る計算になる
    // 3 だと5食が主菜2品の交互で埋まり、初回から単調になっていた（本人指摘）。
    // 2 にすると1週間で主菜3品ほどになる。品数と買い物は少し増える
    maxSameDishMeals: 2,
    // 週1回＝作り置き。設定で変えれば毎日作る形にもなる
    cookSessionsPerWeek: 1,
    maxFridgeDays: 3,
    coverSlots: ['dinner'],
    coverDays: 5,
  },
  ai: {
    cloudProvider: 'none',
    cloudModel: '',
    localModel: '',
    localEnabled: false,
    localModelCached: false,
    routeMode: 'local_first',
    maxCloudCallsPerWeek: 10,
    keepRawResponses: false,
  },
  notify: {
    lineEnabled: false,
    dailyPushTime: '17:30',
    suggestionEnabled: false,
  },
  rhythm: {
    wakeTime: '07:00',
    sleepTime: '23:30',
    caffeine: true,
    preSleepProtein: false,
  },
  calendar: {
    enabled: false,
    provider: 'none',
    calendarIds: [],
    homeKeywords: ['退勤', '帰宅'],
    defaultCookMinutes: 30,
    lookaheadDays: 7,
  },
};

/**
 * あとから足した組み込み食材を、既存の利用者にも届ける。
 *
 * レシピと同じ問題（D-062）が食材にもある。むしろこちらのほうが影響が大きい。
 * 食材が無いと、レシピの取り込みで材料を照合できず、
 * さらに悪いことに**似た別の食材に当たってしまう**（「牛乳」が「牛こま切れ肉」に）。
 *
 * 既存の組み込み食材は、栄養・アレルゲン・1個あたりの重さだけ最新に合わせる。
 * 値段には触れない。利用者の実績から学習した値が入っているため。
 */
async function topUpBuiltinIngredients(): Promise<void> {
  const existing = await db.ingredients.toArray();
  const byKey = new Map(existing.map((i) => [i.nameKey, i]));

  const add: Ingredient[] = [];
  for (const seed of BUILTIN_INGREDIENTS) {
    const cur = byKey.get(seed.nameKey);
    if (!cur) {
      add.push({ ...newEntity(), ...seed });
      continue;
    }
    if (cur.source !== 'builtin') continue;

    const next = {
      ...cur,
      nutritionPer100g: seed.nutritionPer100g,
      allergens: seed.allergens,
      aliases: seed.aliases,
      purchase: { ...cur.purchase, gramsPerPiece: seed.purchase.gramsPerPiece },
    };
    if (JSON.stringify(next) !== JSON.stringify(cur)) {
      await db.ingredients.put({ ...next, updatedAt: nowIso() });
    }
  }
  if (add.length > 0) await db.ingredients.bulkAdd(add);
}

/**
 * あとから足した組み込みレシピを、既存の利用者にも届ける。
 *
 * ensureSeeded は初回しか走らないので、これが無いとレシピを追加しても
 * 追加後にインストールした人にしか届かない。ソルバーの解の質はレシピの数で
 * 決まるので、既存の利用者ほど古いプールのまま取り残されることになる。
 *
 * 突き合わせは title。組み込みレシピの title は識別子として扱い、
 * 内容を変えるときも title は変えない（変えると重複して入る）。
 * 利用者が自分で作ったレシピ（source が builtin 以外）には触れない。
 */
async function topUpBuiltinRecipes(): Promise<void> {
  const known = new Set((await db.recipes.toArray()).map((r) => r.title));
  const pending = BUILTIN_RECIPES.filter((s) => !known.has(s.title));
  if (pending.length === 0) return;

  const ingredients = await db.ingredients.where('deleted').equals(0).toArray();
  const byKey = new Map(ingredients.map((i) => [i.nameKey, i]));

  const added = [];
  const missingAll: string[] = [];
  for (const seed of pending) {
    const { recipe, missing } = buildRecipe(seed, byKey);
    // 食材が足りないレシピを入れると栄養も原価も嘘になる。入れない
    if (missing.length > 0) {
      missingAll.push(seed.title + ': ' + missing.join(','));
      continue;
    }
    added.push(recipe);
  }
  if (added.length > 0) await db.recipes.bulkAdd(added);
  if (missingAll.length > 0) console.warn('[seed] 追加できなかったレシピ', missingAll);
}

/**
 * 「高たんぱく」の印を、保存してある栄養値から付け直す。
 *
 * このタグは手書きだった。主菜111品のうち28品が、印が付いているのに
 * 1人前 25g を下回っていた（最も低いもので 10g）。逆に印の無い品が
 * 25g を超えている例もあった。**「高たんぱくで」と指定した人に、
 * たんぱく質の少ない献立を出していた。**
 *
 * 付け方は build.ts で直したが、既に入っているレシピには届かない
 * （レシピの追加は title の突き合わせで、内容までは見ていない）。
 * 起動時に印だけを付け直す。栄養値そのものには触らない。
 *
 * 利用者が自分で作ったレシピには触れない。自分で付けた印を消さない。
 */
async function refreshProteinTag(): Promise<void> {
  const rows = await db.recipes.where('deleted').equals(0).toArray();
  for (const r of rows) {
    if (r.source !== 'builtin') continue;
    const should = r.role !== 'side' && r.nutritionPerServing.proteinG >= HIGH_PROTEIN_G;
    const has = r.tags.includes(HIGH_PROTEIN_TAG);
    if (should === has) continue;
    const tags = should
      ? [...r.tags, HIGH_PROTEIN_TAG]
      : r.tags.filter((t) => t !== HIGH_PROTEIN_TAG);
    await db.recipes.put({ ...r, tags, updatedAt: nowIso() });
  }
}

/**
 * 目標PFCを今の式で計算し直す。
 *
 * baseTargets はプロフィールを作った時点の値で固定されている。
 * 計算式を直しても、すでに使っている人には届かない
 * （実際、増量の係数を直したあとも古い目標のままだった）。
 * 起動時に計算し直し、変わったものだけ書き戻す。
 *
 * 自分で目標を書き換えた人（manualTargets）には触れない。
 */
async function refreshTargets(): Promise<void> {
  const profiles = await db.profiles.where('deleted').equals(0).toArray();
  for (const p of profiles) {
    if (p.manualTargets) continue;
    const next = recalcProfileTargets(p);
    const cur = p.baseTargets;
    const same =
      cur.kcal === next.kcal &&
      cur.proteinG === next.proteinG &&
      cur.fatG === next.fatG &&
      cur.carbG === next.carbG;
    if (same) continue;
    await db.profiles.put({ ...p, baseTargets: next, updatedAt: nowIso() });
  }
}

/**
 * 「週に何回作るか」を、これまでの設定から引き継ぐ。
 *
 * 作り方は暮らしのプリセット（`Household.cooking.mode`）に付いていた。
 * その置き場所を設定に移したので、移す前から使っている人は
 * 何もしないと既定の「週1回」に戻ってしまう。毎日作る設定にしていた人が
 * 黙って作り置きに変わるのは事故なので、今の世帯から読み替える。
 */
async function migrateCookCadence(): Promise<void> {
  const s = await db.settings.get('singleton');
  if (!s || s.cooking.cookSessionsPerWeek != null) return;

  const current = (await db.households.where('isCurrent').equals(1).toArray())[0];
  const mode = current?.cooking.mode ?? 'batch';
  const sessions = mode === 'daily' ? 7 : mode === 'hybrid' ? 3 : 1;
  await db.settings.put({
    ...s,
    cooking: { ...s.cooking, cookSessionsPerWeek: sessions },
    updatedAt: nowIso(),
  });
}

/** 冪等。設定が既にあれば設定は触らず、足りない組み込みレシピだけ補う */
export async function ensureSeeded(): Promise<void> {
  await db.transaction(
    'rw',
    // refreshTargets が profiles を読み書きするので、スコープに入れておく。
    // 宣言していないストアにトランザクションの中から触ると Dexie が落ちる
    [db.settings, db.ingredients, db.recipes, db.inventory, db.meta, db.profiles, db.households],
    async () => {
    const existing = await db.settings.get('singleton');
    if (existing) {
      // 食材を先に。レシピの原価と栄養は食材から計算するため
      await topUpBuiltinIngredients();
      await topUpBuiltinRecipes();
      await refreshProteinTag();
      await refreshTargets();
      await migrateCookCadence();
      return;
    }

    await db.settings.put(DEFAULT_SETTINGS);

    // 食材を先に入れて id を確定させる。レシピはそれを参照して栄養と原価を計算する
    const ingredients: Ingredient[] = BUILTIN_INGREDIENTS.map((i) => ({ ...newEntity(), ...i }));
    await db.ingredients.bulkAdd(ingredients);

    const byKey = new Map(ingredients.map((i) => [i.nameKey, i]));
    const missingAll: string[] = [];
    const warnAll: string[] = [];
    const recipes = BUILTIN_RECIPES.map((seed) => {
      const { recipe, missing, warnings } = buildRecipe(seed, byKey);
      if (missing.length) missingAll.push(seed.title + ': ' + missing.join(','));
      warnAll.push(...warnings);
      return recipe;
    });
    await db.recipes.bulkAdd(recipes);

    // 調味料は在庫として扱うので、初回は「ひと通り家にある」前提で入れておく。
    // これが無いと1週目の買い出しに醤油・砂糖・油が全部並んでしまう。
    // 実際に無ければ買い出し画面で外せばよい
    const staples: InventoryItem[] = ingredients
      .filter((i) => i.isStaple === 1)
      .map((i) => ({
        ...newEntity(),
        ingredientId: i.id,
        ingredientName: i.name,
        quantity: i.purchase.gramsPerUnit,
        location: i.shelfLife.pantryDays ? ('pantry' as const) : ('fridge' as const),
      }));
    await db.inventory.bulkAdd(staples);

    await db.meta.put({ key: 'seededAt', value: nowIso(), updatedAt: nowIso() });
    if (warnAll.length) {
      await db.meta.put({ key: 'seedWarnings', value: warnAll, updatedAt: nowIso() });
      console.warn('[seed] 分量がおかしいレシピ', warnAll);
    }
    if (missingAll.length) {
      // シードのバグ。握りつぶさず残す
      await db.meta.put({ key: 'seedMissing', value: missingAll, updatedAt: nowIso() });
      console.warn('[seed] 未解決の食材キー', missingAll);
      }
    },
  );
}
