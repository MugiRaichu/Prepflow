import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { useUndoBar } from '@/components/shared/UndoBar';
import {
  listAskableStock,
  markStockChecked,
  restoreStock,
  setStockLevel,
} from '@/db/repositories/inventory';
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
 * ただし3択を全品に出すと、20品で60個のボタンが並ぶ。面倒で閉じられる
 * （本人指摘）。**聞く相手を絞る。**
 *
 *   - 常備品（調味料）は出さない。しょうゆが切れていることは滅多にない
 *   - 見込みが正しい前提で、**「切れているものだけ」を押してもらう**
 *   - 押すと1段階ずつ減る（ある → 少し → 無い → ある）
 *
 * 「ある」ものは触らなくてよい。押すのは減っているものだけになる。
 * 開くのは献立を作る直前でいい。在庫が効くのはそのときだけ（D-037 の延長）。
 */

const LABEL: Record<StockLevel, string> = {
  plenty: 'ある',
  little: '少し',
  none: '無い',
};

const LEVELS: StockLevel[] = ['plenty', 'little', 'none'];

/** いまの見込み量が3択のどれに当たるか。押す前から現在地が分かるようにする */
function levelOf(item: InventoryItem, perUnit: number): StockLevel {
  if (item.quantity <= 0) return 'none';
  return item.quantity >= perUnit * 0.6 ? 'plenty' : 'little';
}

export function StockScreen() {
  const nav = useNavigate();
  const undo = useUndoBar();
  /** いま3択を開いている行。1行ずつしか開かない */
  const [editing, setEditing] = useState<string | null>(null);
  // 常備品を除いた行だけ。設定に出す数もこれと同じものを数えている
  const rows = useLiveQuery(() => listAskableStock(), []);
  const ingredients = useLiveQuery(() => db.ingredients.where('deleted').equals(0).toArray(), []);

  if (!rows || !ingredients) return null;

  const byId = new Map<string, Ingredient>(ingredients.map((i) => [i.id, i]));

  const asked = rows;
  const sections = [...new Set(asked.map((r) => byId.get(r.ingredientId)?.section ?? 'other'))];

  const done = async () => {
    await markStockChecked();
    nav(-1);
  };

  return (
    <div className="pb-8">
      <PageHeader title="冷蔵庫の残りを直す" backTo="/plan" />
      {undo.bar}

      {asked.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="記録されている食材はありません"
            description="買い物を終えると、買ったものがここに並びます。"
          />
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            減っているものだけ直してください。触らなかったものは、いまの見込みの
            ままにします。調味料は聞きません。
          </p>

          {sections.map((sec) => (
            <div key={sec} className="space-y-2">
              <div className="text-[10px] text-muted-foreground">
                {STORE_SECTION_LABELS[sec as StoreSection]}
              </div>
              <div className="divide-y rounded-lg border">
                {asked
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
                        {/*
                          押すと、その行にだけ3択が開く。

                          1つのボタンを押すたびに減らす形にしたら、
                          **押し間違いを戻せなくなった**（3回押さないと元に戻らず、
                          取り消しの帯も数秒で消える。本人指摘）。
                          いまの状態を出しておいて、直接その状態を選べるようにする。
                          全行に3つ並べるわけではないので、ボタンの数も増えない。
                        */}
                        {editing === r.id ? (
                          <div className="flex shrink-0 gap-1">
                            {LEVELS.map((l) => (
                              <button
                                key={l}
                                onClick={() => {
                                  setEditing(null);
                                  if (l === cur) return;
                                  const before = { ...r };
                                  void setStockLevel(r, l);
                                  undo.offer(
                                    r.ingredientName + 'を「' + LABEL[l] + '」にしました',
                                    () => restoreStock(before),
                                  );
                                }}
                                className={cn(
                                  'min-h-10 w-14 rounded-md border text-xs',
                                  cur === l
                                    ? 'border-primary bg-primary font-medium text-primary-foreground'
                                    : 'border-border',
                                )}
                              >
                                {LABEL[l]}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditing(r.id)}
                            className={cn(
                              'min-h-10 w-24 shrink-0 rounded-md border text-xs',
                              cur === 'plenty'
                                ? 'border-border text-muted-foreground'
                                : 'border-primary font-medium text-primary',
                            )}
                          >
                            {LABEL[cur]} を直す
                          </button>
                        )}
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
