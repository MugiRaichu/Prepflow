/**
 * 自分で足すレシピと食材。
 *
 * 守ること: **栄養と原価を人に入力させない。**
 * 組み込みレシピと同じで、材料のグラム数から計算する（D-005）。
 * 貼り付けた文や画像に「350kcal」と書いてあっても採らない。分量が変われば
 * 合わなくなるし、1食あたりに割ったときの数字が食い違う。
 *
 * 食材マスタに無いもの（プロテインなど）は、**栄養成分表示を写して**
 * 食材として登録する。ここだけは人が数字を入れるが、入れるのは
 * 「100gあたりの成分」という、パッケージに必ず書いてある1種類だけ。
 */
import { db, newEntity, nowIso, touch } from '../db';
import { buildRecipe } from '../data/build';
import type { SeedIngredient } from '../data/ingredients';
import type { SeedRecipe, SeedStep } from '../data/recipes';
import type {
  AllergenTag,
  Ingredient,
  Macros,
  Recipe,
  RecipeRole,
  StoreSection,
  Unit,
  UUID,
} from '../schema';

// ---------------------------------------------------------------------------
// 食材の追加
// ---------------------------------------------------------------------------

export interface NewIngredientInput {
  name: string;
  section: StoreSection;
  /** 可食部100gあたり。パッケージの栄養成分表示から写す */
  per100g: Macros;
  /** 買う単位 */
  unit: Unit;
  gramsPerUnit: number;
  typicalPriceYen: number;
  allergens?: AllergenTag[];
  /** 調味料・プロテインなど、毎回は買わないもの */
  isStaple?: boolean;
}

/**
 * 照合に使う読みキーを作る。
 *
 * レシート読み取りと同じ正規化にそろえたいが、あちらは「ノイズを落とす」処理で
 * 入力が店の商品名。ここは利用者が入れた食材名なので、
 * カタカナと漢字をひらがな寄りにするだけにとどめる。
 */
function toNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　（）()・,、.。]/g, '')
    .toLowerCase();
}

export async function addIngredient(input: NewIngredientInput): Promise<Ingredient> {
  const seed: SeedIngredient = {
    name: input.name.trim(),
    nameKey: toNameKey(input.name),
    aliases: [],
    section: input.section,
    nutritionPer100g: input.per100g,
    purchase: {
      unit: input.unit,
      gramsPerUnit: input.gramsPerUnit,
      typicalPriceYen: input.typicalPriceYen,
      minUnits: 1,
      unitStep: 1,
    },
    yieldRatio: 1,
    shelfLife: {},
    allergens: input.allergens ?? [],
    isStaple: input.isStaple ? 1 : 0,
    freezeFriendly: false,
    source: 'user',
  };
  const row: Ingredient = { ...newEntity(), ...seed };
  await db.ingredients.add(row);
  return row;
}

// ---------------------------------------------------------------------------
// レシピの追加
// ---------------------------------------------------------------------------

export interface NewRecipeItem {
  ingredientId: UUID;
  grams: number;
  /** '大さじ2' などの元の表記。買い出しではなく手順の表示に使う */
  display?: string;
}

export interface NewRecipeInput {
  title: string;
  role: RecipeRole;
  summary?: string;
  servings: number;
  items: NewRecipeItem[];
  steps: SeedStep[];
  keepsDays: number;
  tags: string[];
}

/**
 * 加熱による重量変化。
 *
 * 組み込みレシピは1品ずつ実測に近い値を持たせているが、
 * 自分で足すレシピにそこまで求めるのは無理がある。手順から推定する。
 * ここを 1.0 のままにすると「1食あたりのグラム数」が実際より重く出て、
 * 詰める量の目安が狂う。
 */
function guessYieldFactor(steps: SeedStep[], items: NewRecipeItem[]): number {
  const text = steps.map((s) => s.text).join(' ');
  // 乾麺・乾物は水を吸って増える
  const dryish = items.length > 0 && /ゆで|茹で|もどす|戻す/.test(text);
  if (/煮込|煮る|炒め|焼く|蒸し|蒸す/.test(text)) return 0.85;
  if (dryish) return 1.2;
  if (/レンジ/.test(text)) return 0.9;
  return 1.0;
}

/**
 * レシピを保存する。栄養・原価・出来上がり重量は buildRecipe が材料から出す。
 * 材料が1つも解決できていない場合は保存しない（栄養がゼロのレシピができてしまう）。
 */
export async function addRecipe(input: NewRecipeInput): Promise<Recipe> {
  const ingredients = await db.ingredients.where('deleted').equals(0).toArray();
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const resolved = input.items.filter((it) => byId.has(it.ingredientId) && it.grams > 0);
  if (resolved.length === 0) throw new Error('材料が1つも決まっていません');

  // buildRecipe は nameKey で引くので、その形に合わせる
  const byKey = new Map(ingredients.map((i) => [i.nameKey, i]));
  const seed: SeedRecipe = {
    title: input.title.trim() || '名前のないレシピ',
    role: input.role,
    ...(input.summary ? { summary: input.summary } : {}),
    servings: Math.max(1, Math.round(input.servings)),
    yieldFactor: guessYieldFactor(input.steps, resolved),
    items: resolved.map((it) => {
      const ing = byId.get(it.ingredientId)!;
      return (it.display ? [ing.nameKey, it.grams, it.display] : [ing.nameKey, it.grams]) as
        | [string, number]
        | [string, number, string];
    }),
    steps: input.steps.length > 0 ? input.steps : [{ text: '作る', min: 10, hands: 10 }],
    storage: { location: 'fridge', keepsDays: input.keepsDays },
    tags: input.tags,
  };

  const { recipe, missing } = buildRecipe(seed, byKey);
  if (missing.length > 0) throw new Error('解決できない食材があります: ' + missing.join(', '));

  const row: Recipe = { ...recipe, ...newEntity(), source: 'user' };
  await db.recipes.add(row);
  return row;
}

/** 自分で足したレシピを消す。組み込みは消さない（補充で戻ってくるため） */
export async function removeUserRecipe(id: UUID): Promise<void> {
  const cur = await db.recipes.get(id);
  if (!cur || cur.source === 'builtin') return;
  await db.recipes.put(touch({ ...cur, deleted: 1 }));
}

/** 献立に出すかどうかだけ切り替える。消さずに休ませたいとき用 */
export async function setRecipeEnabled(id: UUID, enabled: boolean): Promise<void> {
  const cur = await db.recipes.get(id);
  if (!cur) return;
  await db.recipes.put({ ...cur, deleted: enabled ? 0 : 1, updatedAt: nowIso() });
}
