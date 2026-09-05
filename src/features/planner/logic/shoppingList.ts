/**
 * 買い出しリストの組み立て。
 *
 * 必要量 → 実際に買う量への変換がこのファイルの本体で、2段階ある。
 *   1. 歩留まりで割り戻す: ブロッコリー可食部260gが要るなら 260 / 0.65 = 400g 買う
 *   2. 購入単位に切り上げる: 1個250gなら 2個
 * この2つを飛ばすと「書いてある通り買ったのに足りない」が起きる。
 *
 * 切り上げで余る分は expectedLeftover に入れ、作り置き後に在庫へ戻す。
 *
 * 調味料も同じ扱いにする。「常備品だから載せない」という区別を持つと、
 * 本当に切れたときに気づけない。在庫が足りない週だけ自動で出す。
 */
import type {
  Ingredient,
  InventoryItem,
  ShoppingListItem,
  StoreSection,
  Unit,
} from '@/db/schema';
import { newEntity } from '@/db/db';
import type { WeekPlanCandidate } from './types';

export interface BuildListInput {
  plan: WeekPlanCandidate;
  ingredients: Map<string, Ingredient>;
  inventory: InventoryItem[];
  sectionOrder: StoreSection[];
  shoppingListId: string;
  /**
   * よく行く店の価格係数。1.0 がマスタの想定どおり。
   * 店ごとの実売価格は取得できないので、水準だけを係数1つで補正する。
   */
  priceFactor: number;
}

const UNIT_LABEL: Record<Unit, string> = {
  g: 'g',
  ml: 'ml',
  piece: '個',
  pack: 'パック',
  bunch: '束',
  can: '缶',
  tbsp: '大さじ',
  tsp: '小さじ',
  clove: '片',
  sheet: '枚',
};

/** レシピ全体で必要な食材量（可食部ベース）を集計する */
export function aggregateNeeds(plan: WeekPlanCandidate): Map<string, number> {
  const needs = new Map<string, number>();
  const items = [...plan.mains, ...plan.sides, ...(plan.ricePlan ? [plan.ricePlan] : [])];

  for (const item of items) {
    for (const ri of item.recipe.ingredients) {
      // レシピの分量は1バッチぶん。バッチ数を掛ける
      const g = ri.quantity * item.batches;
      needs.set(ri.ingredientId, (needs.get(ri.ingredientId) ?? 0) + g);
    }
  }
  return needs;
}

export function buildShoppingList(input: BuildListInput): ShoppingListItem[] {
  const needs = aggregateNeeds(input.plan);

  // 在庫を食材IDごとに合計
  const stock = new Map<string, number>();
  for (const inv of input.inventory) {
    if (inv.deleted === 1) continue;
    stock.set(inv.ingredientId, (stock.get(inv.ingredientId) ?? 0) + inv.quantity);
  }

  const rows: ShoppingListItem[] = [];

  for (const [ingredientId, neededEdible] of needs) {
    const ing = input.ingredients.get(ingredientId);
    if (!ing) continue;

    // 調味料も在庫として扱う。醤油1本は数ヶ月もつので、
    // 毎週載せるとノイズになる。足りない週だけ出す
    const have = stock.get(ingredientId) ?? 0;
    const shortEdible = Math.max(neededEdible - have, 0);
    if (shortEdible <= 0) continue;

    // 1. 歩留まりで割り戻す
    const requiredQuantity = shortEdible / (ing.yieldRatio || 1);

    // 2. 購入単位へ切り上げる
    const { gramsPerUnit, minUnits, unitStep, typicalPriceYen, unit } = ing.purchase;
    const rawUnits = requiredQuantity / gramsPerUnit;
    let units = Math.max(Math.ceil(rawUnits), minUnits);
    if (unitStep > 1) units = Math.ceil(units / unitStep) * unitStep;

    const boughtGrams = units * gramsPerUnit;
    const leftover = Math.max(boughtGrams - requiredQuantity, 0);

    const unitLabel = UNIT_LABEL[unit];
    const displayQuantity =
      unit === 'g' || unit === 'ml'
        ? Math.round(boughtGrams) + unitLabel
        : units + unitLabel + '（約' + Math.round(boughtGrams) + 'g）';

    rows.push({
      ...newEntity(),
      shoppingListId: input.shoppingListId,
      ingredientId,
      name: ing.name,
      section: ing.section,
      sortIndex: 0,
      requiredQuantity: Math.round(requiredQuantity),
      purchaseUnits: units,
      unit,
      displayQuantity,
      estimatedPriceYen: Math.round(units * typicalPriceYen * input.priceFactor),
      checked: 0,
      usedByRecipeIds: recipesUsing(input.plan, ingredientId),
      expectedLeftover: Math.round(leftover),
    });
  }

  // 店内の動線順に並べる。同じ売り場の中は名前順で安定させる
  const order = new Map(input.sectionOrder.map((s, i) => [s, i]));
  rows.sort((a, b) => {
    const d = (order.get(a.section) ?? 99) - (order.get(b.section) ?? 99);
    return d !== 0 ? d : a.name.localeCompare(b.name, 'ja');
  });
  rows.forEach((r, i) => {
    r.sortIndex = i;
  });

  return rows;
}

/** 「何のために買うのか」。店頭で代替を考えるときの文脈になる */
function recipesUsing(plan: WeekPlanCandidate, ingredientId: string): string[] {
  const items = [...plan.mains, ...plan.sides, ...(plan.ricePlan ? [plan.ricePlan] : [])];
  return items
    .filter((it) => it.recipe.ingredients.some((ri) => ri.ingredientId === ingredientId))
    .map((it) => it.recipe.id);
}

/** 合計金額 */
export function listTotal(rows: ShoppingListItem[]): number {
  return rows.reduce((n, r) => n + r.estimatedPriceYen, 0);
}
