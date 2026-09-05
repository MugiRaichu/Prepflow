import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, X } from 'lucide-react';
import { db, newEntity, nowIso } from '@/db/db';
import { markDepleted, markStillHave, needsCheck, predictStaples } from '@/db/repositories/staples';
import type { StaplePrediction } from '@/db/repositories/staples';
import { STORE_SECTION_LABELS } from '@/lib/labels';
import type { Ingredient, ShoppingList } from '@/db/schema';

/**
 * 調味料の残量確認。
 *
 * 「切らしたものを選んでください」と一覧を出すのは、台所を思い出す作業を
 * 押しつけることになる（D-015 に反する）。予測を持っているのはアプリなので、
 * **アプリから名指しで聞く**。
 *
 *   × 15種類のチップから探させる
 *   ○「しょうゆ の残りを見てください → まだある / 切れそう」
 *
 * 「まだある」も情報として使う。予測より長くもっていることが分かるので、
 * 次に聞くタイミングを後ろへずらせる。
 */
export function StapleCheck({ list }: { list: ShoppingList }) {
  const [asks, setAsks] = useState<StaplePrediction[] | null>(null);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const rows = useLiveQuery(
    () => db.shoppingListItems.where('shoppingListId').equals(list.id).toArray(),
    [list.id],
  );
  const staples = useLiveQuery(
    async () =>
      (await db.ingredients.where('deleted').equals(0).toArray())
        .filter((i) => i.isStaple === 1)
        .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    [],
  );

  // 今週の献立で使う量を出し、それを元に「聞くべきもの」を決める
  useEffect(() => {
    void (async () => {
      const plan = await db.weekPlans.get(list.weekPlanId);
      if (!plan) return;
      const recipes = await db.recipes.where('deleted').equals(0).toArray();
      const byId = new Map(recipes.map((r) => [r.id, r]));

      const usage = new Map<string, number>();
      for (const id of plan.recipeIds) {
        const r = byId.get(id);
        if (!r) continue;
        for (const ri of r.ingredients) {
          usage.set(ri.ingredientId, (usage.get(ri.ingredientId) ?? 0) + ri.quantity);
        }
      }

      const settings = await db.settings.get('singleton');
      const preds = await predictStaples(usage, settings?.shopping.outsideUseRatio ?? 0.3);
      setAsks(needsCheck(preds, usage));
    })();
  }, [list.weekPlanId]);

  const addToList = async (ing: Ingredient) => {
    const maxIndex = Math.max(0, ...(rows ?? []).map((r) => r.sortIndex));
    await db.shoppingListItems.add({
      ...newEntity(),
      shoppingListId: list.id,
      ingredientId: ing.id,
      name: ing.name,
      section: ing.section,
      sortIndex: maxIndex + 1,
      requiredQuantity: ing.purchase.gramsPerUnit,
      purchaseUnits: 1,
      unit: ing.purchase.unit,
      displayQuantity: '1' + (ing.purchase.unit === 'pack' ? 'パック' : '個'),
      estimatedPriceYen: ing.purchase.typicalPriceYen,
      checked: 0,
      usedByRecipeIds: [],
    });
    await db.shoppingLists.put({
      ...list,
      estimatedTotalYen: list.estimatedTotalYen + ing.purchase.typicalPriceYen,
      updatedAt: nowIso(),
    });
  };

  const answer = async (p: StaplePrediction, running: boolean) => {
    setAnswered(new Set([...answered, p.ingredient.id]));
    if (running) {
      await markDepleted(p.ingredient.id);
      await addToList(p.ingredient);
    } else {
      await markStillHave(p.ingredient.id);
    }
  };

  const pending = (asks ?? []).filter((p) => !answered.has(p.ingredient.id));
  const listed = new Set((rows ?? []).map((r) => r.ingredientId));
  const others = (staples ?? []).filter(
    (i) => !listed.has(i.id) && !(asks ?? []).some((p) => p.ingredient.id === i.id),
  );

  return (
    <div className="border-t">
      {pending.length > 0 && (
        <div className="space-y-3 p-4">
          <div className="text-sm font-medium">残りを見てください</div>

          {pending.map((p) => (
            <div key={p.ingredient.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-base font-medium">{p.ingredient.name}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {p.daysLeft != null
                    ? p.daysLeft <= 14
                      ? 'あと' + p.daysLeft + '日ぶんの見込み'
                      : ''
                    : 'まだ実績がありません'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => answer(p, false)}
                  className="min-h-11 rounded-md border text-sm active:bg-accent"
                >
                  まだある
                </button>
                <button
                  onClick={() => answer(p, true)}
                  className="min-h-11 rounded-md bg-foreground text-sm font-medium text-background"
                >
                  切れそう
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 予測から漏れたものを足す逃げ道。既定では畳んでおく */}
      {!showAll ? (
        <button
          onClick={() => setShowAll(true)}
          className="pf-press flex min-h-12 w-full items-center justify-center gap-1.5 text-xs text-muted-foreground"
        >
          <Plus className="size-3.5" />
          ほかに切らしたものを足す
        </button>
      ) : (
        <div className="p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-medium">切らしたものを選んでください</span>
            <button
              onClick={() => setShowAll(false)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
            >
              <X className="size-3" />
              閉じる
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {others.map((i) => (
              <button
                key={i.id}
                onClick={async () => {
                  await markDepleted(i.id);
                  await addToList(i);
                }}
                className="min-h-10 rounded-md border px-3 text-xs active:scale-[0.98]"
              >
                {i.name}
                <span className="ml-1 text-[9px] text-muted-foreground">
                  {STORE_SECTION_LABELS[i.section]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
