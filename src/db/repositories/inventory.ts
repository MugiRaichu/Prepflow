/**
 * 在庫の出し入れ。
 *
 * ユーザーに在庫を手入力させない（D-015）。買い出しと調理の結果から自動で動かす。
 *   買い物を終える → 買った量を足す
 *   調理を終える   → レシピで使った量を引く
 * 差分が「余り」として残り、次の週の買い出しリストから引かれる。
 */
import { db, newEntity, nowIso } from '@/db/db';
import { UNIT_LABEL } from '@/features/planner/logic/shoppingList';
import type { Ingredient, ShoppingListItem, WeekPlan } from '@/db/schema';

/** 買った量を在庫へ入れる。同じ食材が既にあれば足す */
export async function addPurchased(items: ShoppingListItem[]): Promise<number> {
  const ingredients = new Map<string, Ingredient>(
    (await db.ingredients.where('deleted').equals(0).toArray()).map((i) => [i.id, i]),
  );
  let added = 0;

  await db.transaction('rw', db.inventory, async () => {
    for (const item of items) {
      if (item.checked !== 1) continue;
      const ing = ingredients.get(item.ingredientId);
      if (!ing) continue;

      const grams = item.purchaseUnits * ing.purchase.gramsPerUnit;
      const location = ing.shelfLife.pantryDays ? 'pantry' : 'fridge';

      const existing = (
        await db.inventory.where('ingredientId').equals(item.ingredientId).toArray()
      ).find((x) => x.deleted === 0 && x.location === location);

      if (existing) {
        await db.inventory.put({
          ...existing,
          quantity: existing.quantity + grams,
          purchasedAt: nowIso().slice(0, 10),
          updatedAt: nowIso(),
        });
      } else {
        await db.inventory.add({
          ...newEntity(),
          ingredientId: item.ingredientId,
          ingredientName: item.name,
          quantity: grams,
          location,
          purchasedAt: nowIso().slice(0, 10),
          ...(item.actualPriceYen ? { paidPriceYen: item.actualPriceYen } : {}),
        });
      }
      added++;
    }
  });

  return added;
}

/** 作ったぶんを在庫から引く。残りが「余り」になる */
export async function consumeForPlan(plan: WeekPlan): Promise<void> {
  const recipes = await db.recipes.where('deleted').equals(0).toArray();
  const byId = new Map(recipes.map((r) => [r.id, r]));

  // 同じレシピが複数回入っていればバッチ数として数える
  const counts = new Map<string, number>();
  for (const id of plan.recipeIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const need = new Map<string, number>();
  for (const [id, batches] of counts) {
    const r = byId.get(id);
    if (!r) continue;
    for (const ri of r.ingredients) {
      need.set(ri.ingredientId, (need.get(ri.ingredientId) ?? 0) + ri.quantity * batches);
    }
  }

  await db.transaction('rw', db.inventory, async () => {
    for (const [ingredientId, grams] of need) {
      const rows = (await db.inventory.where('ingredientId').equals(ingredientId).toArray())
        .filter((x) => x.deleted === 0 && x.quantity > 0)
        // 古いものから使う
        .sort((a, b) => (a.purchasedAt ?? '').localeCompare(b.purchasedAt ?? ''));

      let left = grams;
      for (const row of rows) {
        if (left <= 0) break;
        const take = Math.min(row.quantity, left);
        left -= take;
        const rest = row.quantity - take;
        await db.inventory.put({
          ...row,
          quantity: rest,
          // 使い切ったものは残さない
          deleted: rest <= 0.5 ? 1 : 0,
          updatedAt: nowIso(),
        });
      }
    }
  });
}

/**
 * 買った個数を、リストに出した数から変える。
 *
 * 野菜はちょうどの個数で売っていない。にんじん1本が要るのに3本入りしか
 * 置いていない、まとめ買いのほうが安い、という状況のほうが普通で、
 * 「リストどおり買った」ことにすると在庫が実際と合わなくなる。
 *
 * 直すのは個数だけ。表示と見込み額はそこから引き直す。
 * 余分は買い物を終えた時点で在庫に入り、`effectiveCosts` が
 * 在庫ぶんを原価から引くので、**次の献立でそれを使う案が自然に勝つ**。
 */
export async function setPurchaseUnits(
  item: ShoppingListItem,
  units: number,
): Promise<void> {
  const next = Math.max(1, Math.round(units));
  if (next === item.purchaseUnits) return;

  const ing = await db.ingredients.get(item.ingredientId);
  const gramsPerUnit = ing?.purchase.gramsPerUnit ?? 0;
  const perUnitYen = item.estimatedPriceYen / Math.max(item.purchaseUnits, 1);
  const grams = next * gramsPerUnit;
  const label = UNIT_LABEL[item.unit];

  await db.shoppingListItems.put({
    ...item,
    purchaseUnits: next,
    displayQuantity:
      item.unit === 'g' || item.unit === 'ml'
        ? Math.round(grams) + label
        : next + label + '（約' + Math.round(grams) + 'g）',
    estimatedPriceYen: Math.round(perUnitYen * next),
    // 切り上げで余る量。作り置きのあと在庫に戻る
    expectedLeftover: Math.round(Math.max(grams - item.requiredQuantity, 0)),
    updatedAt: nowIso(),
  });
}
