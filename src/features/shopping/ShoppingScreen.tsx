import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Eye, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { addPurchased, setPurchaseUnits } from '@/db/repositories/inventory';
import { markPurchased } from '@/db/repositories/staples';
import { autoBackup } from '@/db/repositories/backup';
import { getDefaultStore, learnFromReceipt, reliabilityOf } from '@/db/repositories/stores';
import { StapleCheck } from './StapleCheck';
import { ReceiptScan } from './ReceiptScan';
import { db, nowIso } from '@/db/db';
import { ContainerCheck } from './ContainerCheck';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { STORE_SECTION_LABELS, formatDateJa, todayIso, yen } from '@/lib/labels';
import { useWakeLock } from './useWakeLock';
import type { ShoppingListItem } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * 買い出し画面。圏外で片手で使う前提（D-015）。
 * - 画面スリープを止める
 * - タップ領域を大きく取り、押したものは下へ落として探し直しを無くす
 * - 売り場順に並んでいるので売り場を戻らない
 * - 金額の入力は任意。合計だけ後で入れれば予算管理は成立する
 */
export function ShoppingScreen() {
  const list = useLiveQuery(
    () => db.shoppingLists.where('deleted').equals(0).reverse().sortBy('shoppingDate'),
    [],
  );
  const current = list?.[0];

  const items = useLiveQuery(
    async (): Promise<ShoppingListItem[]> =>
      current
        ? db.shoppingListItems.where('shoppingListId').equals(current.id).sortBy('sortIndex')
        : [],
    [current?.id],
  );

  const wake = useWakeLock(Boolean(current));
  const nav = useNavigate();
  const [stocked, setStocked] = useState(false);
  const [total, setTotal] = useState('');
  /** 「売り切れ・見つからない」を開いているか */
  const [missing, setMissing] = useState(false);
  const store = useLiveQuery(
    async () => (await db.stores.where('deleted').equals(0).toArray()).find((x) => x.isDefault === 1),
    [],
  );

  if (!current) {
    return (
      <div>
        <PageHeader title="買い出し" />
        <div className="p-4">
          <EmptyState
            title="買い出しリストがありません"
            description="週のプランを作ると、売り場の順に並んだリストができます。"
            action={
              <Link
                to="/plan"
                className="mt-1 inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
              >
                週のプランを作る
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const rows = items ?? [];
  const remaining = rows.filter((r) => r.checked === 0);
  const done = rows.filter((r) => r.checked === 1);
  const spent = done.reduce((n, r) => n + (r.actualPriceYen ?? r.estimatedPriceYen), 0);

  // 終えた買い出しは、終えた状態で見せる。
  // 以前は「全部そろいました」とレシート入力と全品目が毎回出ていて、
  // タブを開くたびに買い物の途中に戻ったように見えた（本人指摘）
  if (current.status === 'done') {
    return (
      <div className="pb-8">
        <PageHeader title="買い出し" />
        <div className="space-y-3 p-4">
          <EmptyState
            title="買い出しは終わっています"
            description={
              formatDateJa(current.shoppingDate) +
              ' ・ ' +
              (current.actualTotalYen != null
                ? yen(current.actualTotalYen) + '（見込み ' + yen(current.estimatedTotalYen) + '）'
                : '見込み ' + yen(current.estimatedTotalYen))
            }
          />
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-4 py-3 text-xs text-muted-foreground">
              買ったもの（{done.length} 点）
            </summary>
            <div className="divide-y border-t opacity-60">
              {done.map((r) => (
                <ItemRow key={r.id} item={r} onToggle={() => {}} />
              ))}
            </div>
          </details>
          <p className="text-xs text-muted-foreground">次の献立を作ると、新しいリストになります。</p>
        </div>
      </div>
    );
  }

  // 売り場ごとに区切る。並びは既に動線順
  const groups: { section: string; items: ShoppingListItem[] }[] = [];
  for (const r of remaining) {
    const label = STORE_SECTION_LABELS[r.section];
    const last = groups[groups.length - 1];
    if (last && last.section === label) last.items.push(r);
    else groups.push({ section: label, items: [r] });
  }

  const toggle = async (r: ShoppingListItem) => {
    await db.shoppingListItems.put({
      ...r,
      checked: r.checked === 1 ? 0 : 1,
      ...(r.checked === 1 ? {} : { checkedAt: nowIso() }),
      updatedAt: nowIso(),
    });
  };

  return (
    <div className="pb-24">
      <PageHeader title="買い出し" />

      <div className="sticky top-12 z-10 border-b bg-background px-4 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">
            残り {remaining.length} / {rows.length} 点
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {yen(spent)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              / {yen(current.budgetYen)}
            </span>
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-foreground"
            style={{ width: Math.min((spent / Math.max(current.budgetYen, 1)) * 100, 100) + '%' }}
          />
        </div>
        {wake.active && (
          <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Eye className="size-3" />
            画面が消えないようにしています
          </div>
        )}
      </div>

      {remaining.length === 0 && rows.length > 0 && (
        <div className="space-y-3 p-4">
          <EmptyState
            title="全部そろいました"
            description={'買ったものは在庫として記録され、次の週の買い出しから引かれます。'}
          />

          {/*
            容器の話はここでする。**買い終わったあと。**

            画面の一行目に置いていたので、買い物を始める人がまず容器の
            過不足を読むことになっていた（本人指摘）。買う手は進まないし、
            足りないときの答えは「皿で足りる」で買い足しでもない。
            買い終えたこの位置なら、まだ店にいる可能性があり、
            読んでも次の行動（詰め方）を邪魔しない。足りていれば出ない
          */}
          <ContainerCheck />

          <ReceiptScan items={done} onDone={(t) => { if (t != null) setTotal(String(t)); }} />

          <div className="space-y-2 rounded-lg border p-4">
            <div className="text-sm font-medium">食材だけの合計</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              見込みは {yen(current.estimatedTotalYen)} でした。
              {store
                ? reliabilityOf(store) === 'unknown'
                  ? ' まだ実績がないので、この見込みは目安です。'
                  : reliabilityOf(store) === 'rough'
                    ? ' 実績' + store.sampleCount + '回ぶんで調整中です。'
                    : ' 実績' + store.sampleCount + '回で調整済みです。'
                : ''}
              実際の額を入れると、次の週の見込みがあなたの店に寄ります。飛ばしても構いません。
              同じ会計で日用品を買っていても構いません。上のレシート読み取りを使えば、
              今回の食材の行だけを拾って合計します。
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm">¥</span>
              <input
                type="number"
                inputMode="numeric"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder={String(current.estimatedTotalYen)}
                className="h-11 flex-1 rounded-md border border-input bg-transparent px-3 text-base tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/*
              打った瞬間に差を出す。桁を1つ多く打つ（19000）ような打ち間違いは、
              金額だけ見ても気づきにくいが、差が「+1,760%」と出れば必ず気づく
            */}
            {(() => {
              const n = Number(total);
              if (!n || n <= 0) return null;
              const diff = n - current.estimatedTotalYen;
              const pct = Math.round((diff / Math.max(current.estimatedTotalYen, 1)) * 100);
              const wild = Math.abs(pct) > 60;
              return (
                <div
                  className={cn(
                    'text-xs tabular-nums',
                    wild ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  見込みとの差 {diff >= 0 ? '+' : ''}
                  {yen(diff)}（{pct >= 0 ? '+' : ''}
                  {pct}%）
                  {wild && ' — 桁を打ち間違えていませんか'}
                </div>
              );
            })()}

            <p className="text-xs leading-relaxed text-muted-foreground">
              レシート全体の額ではなく、食材だけの額です。
              日用品を一緒に買った週は、その分を引いた額を入れてください。
            </p>
          </div>

          <button
            onClick={async () => {
              await addPurchased(done);
              // 常備品は「買った日」を記録する。次の切れ時の起点になる
              await markPurchased(done.map((d) => d.ingredientId));
              const actual = Number(total);
              await db.shoppingLists.put({
                ...current,
                status: 'done',
                ...(actual > 0 ? { actualTotalYen: actual } : {}),
                updatedAt: nowIso(),
              });
              if (actual > 0) {
                const store = await getDefaultStore();
                await learnFromReceipt(store.id, actual, current.estimatedTotalYen);
              }
              setStocked(true);
              void autoBackup();
            }}
            disabled={stocked}
            className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background disabled:opacity-40"
          >
            {stocked ? '記録しました' : '買い物を終える'}
          </button>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.section}>
          <div className="bg-secondary/50 px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground">
            {g.section}
          </div>
          <div className="divide-y">
            {g.items.map((r) => (
              <ItemRow key={r.id} item={r} onToggle={() => toggle(r)} />
            ))}
          </div>
        </div>
      ))}

      {/*
        売り切れ・見つからない。**買い出しの最中が、それが分かる唯一の場所。**

        作り置きを始めた時点では買い物は終わっている。台所で気づくのは
        「開けたら傷んでいた」くらいで、ふつうは店で分かる（本人指摘）。
        だから献立の組み直しは、ここから始められるようにする。

        かごに入れていないものが、そのまま「買えなかったもの」の候補になる。
        行ごとにボタンを足さない（全行が2択になると、押すだけの流れが壊れる）。
      */}
      {remaining.length > 0 && (
        <div className="px-4 py-3">
          <button
            onClick={() => setMissing(!missing)}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border text-xs text-muted-foreground active:bg-accent"
          >
            <AlertTriangle className="size-3.5" />
            売り切れ・見つからないものがある
          </button>
          {missing && (
            <div className="pf-rise mt-2 space-y-3 rounded-lg border p-3">
              <p className="text-xs leading-relaxed">
                買えなかったものを選んでください。
                <b>それを使わない献立に作り直します。</b>
              </p>
              <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
                <li>・かごに入れたものは、そのまま使います</li>
                <li>・家に余っている食材から先に使います</li>
                <li>・押しても案が出るだけです。気に入らなければ戻れます</li>
              </ul>
              <div className="flex flex-wrap gap-1.5">
                {remaining.map((r) => (
                  <button
                    key={r.id}
                    onClick={() =>
                      nav('/plan', {
                        state: {
                          fromDate: todayIso(),
                          withoutIngredientIds: [r.ingredientId],
                          withoutNames: [r.name],
                        },
                      })
                    }
                    className="min-h-11 rounded-md border px-3 text-xs active:bg-accent"
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setMissing(false)}
                className="min-h-11 w-full text-xs text-muted-foreground"
              >
                やめる
              </button>
            </div>
          )}
        </div>
      )}

      <StapleCheck list={current} />

      {done.length > 0 && (
        <div className="mt-6">
          <div className="px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground">
            かごに入れた（{done.length}）
          </div>
          <div className="divide-y opacity-40">
            {done.map((r) => (
              <ItemRow key={r.id} item={r} onToggle={() => toggle(r)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 1行。押すとかごに入る。
 *
 * 個数は**押した後**にだけ直せるようにする。野菜はちょうどの個数で
 * 売っていないので、3本入りしか無かった、まとめ買いのほうが安かった、
 * という場面のほうが普通で、そのまま記録すると在庫が実際と合わなくなる。
 *
 * かごに入れる前から個数の増減を出すと、全行に操作が2つ並んで
 * 「押すだけ」の流れが壊れる（D-083）。入れた行にだけ出す。
 */
function ItemRow({ item, onToggle }: { item: ShoppingListItem; onToggle: () => void }) {
  const checked = item.checked === 1;
  return (
    <div>
      <button
        onClick={onToggle}
        className="pf-press flex min-h-16 w-full items-center gap-3 px-4 text-left"
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full border',
            checked ? 'border-foreground bg-foreground text-background pf-pop' : 'border-border',
          )}
        >
          {checked && <Check className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-base font-medium', checked && 'line-through')}>
            {item.name}
          </span>
          <span className="block text-xs text-muted-foreground">{item.displayQuantity}</span>
        </span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {yen(item.estimatedPriceYen)}
        </span>
      </button>

      {checked && (
        <div className="flex items-center gap-2 px-4 pb-2 pl-14">
          <span className="text-xs text-muted-foreground">買った数</span>
          <button
            onClick={() => void setPurchaseUnits(item, item.purchaseUnits - 1)}
            disabled={item.purchaseUnits <= 1}
            className="flex size-11 items-center justify-center rounded-md border text-sm active:bg-accent disabled:opacity-30"
            aria-label="減らす"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="min-w-6 text-center text-sm tabular-nums">{item.purchaseUnits}</span>
          <button
            onClick={() => void setPurchaseUnits(item, item.purchaseUnits + 1)}
            className="flex size-11 items-center justify-center rounded-md border text-sm active:bg-accent"
            aria-label="増やす"
          >
            <Plus className="size-3.5" />
          </button>
          {/* 増やした先で何が起きるかを言う。言わないと、ただの数字になる（D-084） */}
          <span className="text-xs text-muted-foreground">
            余ったぶんは来週の献立で先に使います
          </span>
        </div>
      )}
    </div>
  );
}
