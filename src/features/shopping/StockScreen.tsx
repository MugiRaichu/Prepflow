import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { useUndoBar } from '@/components/shared/UndoBar';
import { markStockChecked, restoreStock, setStockLevel } from '@/db/repositories/inventory';
import type { StockLevel } from '@/db/repositories/inventory';
import { STORE_SECTION_LABELS } from '@/lib/labels';
import type { Ingredient, InventoryItem, StoreSection } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * 棚卸し。
 *
 * 家にある量とアプリの見込みは必ずズレる。半分捨てた、来客で使った、
 * 別のものを作った——どれもアプリからは見えない。
 *
 * **グラム数は聞かない。**「にんじん あと2本くらい」を 300g に換算できる人は
 * いない。買う単位を基準にした3択なら、見た瞬間に答えられる。
 *
 * 開くのは献立を作る直前でいい。在庫が効くのはそのときだけで、
 * それ以外のタイミングで正確でも意味がない（D-037 の延長）。
 * 気づいたときに1品だけ直したい場合も、同じ画面で足りる。
 */

const LEVELS: { value: StockLevel; label: string }[] = [
  { value: 'plenty', label: 'ある' },
  { value: 'little', label: '少し' },
  { value: 'none', label: '無い' },
];

/** いまの見込み量が3択のどれに当たるか。押す前から現在地が分かるようにする */
function levelOf(item: InventoryItem, perUnit: number): StockLevel {
  if (item.quantity <= 0) return 'none';
  return item.quantity >= perUnit * 0.6 ? 'plenty' : 'little';
}

export function StockScreen() {
  const nav = useNavigate();
  const undo = useUndoBar();
  const rows = useLiveQuery(
    async () => (await db.inventory.where('deleted').equals(0).toArray()).filter((r) => r.quantity > 0),
    [],
  );
  const ingredients = useLiveQuery(() => db.ingredients.where('deleted').equals(0).toArray(), []);

  if (!rows || !ingredients) return null;

  const byId = new Map<string, Ingredient>(ingredients.map((i) => [i.id, i]));
  const sections = [...new Set(rows.map((r) => byId.get(r.ingredientId)?.section ?? 'other'))];

  const done = async () => {
    await markStockChecked();
    nav(-1);
  };

  return (
    <div className="pb-8">
      <PageHeader title="家にあるもの" backTo="/plan" />
      {undo.bar}

      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="記録されている食材はありません"
            description="買い物を終えると、買ったものがここに並びます。"
          />
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            見たままを押してください。ここで直したぶんは、次の献立でそのまま使われます。
            触らなかったものは、いまの見込みのままにします。
          </p>

          {sections.map((sec) => (
            <div key={sec} className="space-y-2">
              <div className="text-[10px] text-muted-foreground">
                {STORE_SECTION_LABELS[sec as StoreSection]}
              </div>
              <div className="divide-y rounded-lg border">
                {rows
                  .filter((r) => (byId.get(r.ingredientId)?.section ?? 'other') === sec)
                  .map((r) => {
                    const perUnit = byId.get(r.ingredientId)?.purchase.gramsPerUnit ?? r.quantity;
                    const cur = levelOf(r, perUnit);
                    return (
                      <div key={r.id} className="flex items-center gap-2 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{r.ingredientName}</div>
                          <div className="text-[10px] tabular-nums text-muted-foreground">
                            見込み {Math.round(r.quantity)}g
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {LEVELS.map((l) => (
                            <button
                              key={l.value}
                              onClick={() => {
                                // 押す前の行をそのまま覚えておく。「無い」を
                                // 誤って押しても、量を推測し直さずに戻せる
                                const before = { ...r };
                                void setStockLevel(r, l.value);
                                undo.offer(
                                  r.ingredientName + 'を「' + l.label + '」にしました',
                                  () => restoreStock(before),
                                );
                              }}
                              className={cn(
                                'min-h-9 rounded-md border px-2.5 text-xs',
                                cur === l.value
                                  ? 'pf-pop border-foreground bg-foreground font-medium text-background'
                                  : 'border-border text-muted-foreground',
                              )}
                            >
                              {l.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}

          <button
            onClick={() => void done()}
            className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background"
          >
            確認しました
          </button>
        </div>
      )}
    </div>
  );
}
