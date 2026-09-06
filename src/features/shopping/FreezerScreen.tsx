import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { useUndoBar } from '@/components/shared/UndoBar';
import { eatLeftover, listLeftovers, undoEatLeftover } from '@/db/repositories/leftovers';
import { addDaysIso, formatDateJa, todayIso } from '@/lib/labels';
import type { ContainerAssignment } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * 冷凍庫・冷蔵庫に残っている作り置き。
 *
 * 食べなかった日のぶん、冷凍に回したぶん、作り直しで献立から外れたぶん。
 * **これは在庫であって、献立ではない。**予定は立っていないが食べ物としては
 * 存在していて、期限もある。
 *
 * 今日の画面には期限の近いものだけを出す（毎日見る場所を長くしない）。
 * 全部を見たいのはこちら。冷凍と冷蔵で分け、期限の近い順に並べる。
 *
 * 押すのは1回。いつ食べたかは聞かない（押した日でいい）。
 */
/** 期限まであと何日か。日付だけだと、頭の中で引き算することになる */
function daysLeft(useBy: string, today: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(useBy + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000,
    ),
  );
}

export function FreezerScreen() {
  const undo = useUndoBar();
  const rows = useLiveQuery(listLeftovers, []);
  if (!rows) return null;

  const today = todayIso();
  const freezer = rows.filter((c) => c.storage === 'freezer');
  const fridge = rows.filter((c) => c.storage !== 'freezer');
  const kcal = rows.reduce((n, c) => n + c.nutrition.kcal, 0);

  const eat = async (c: ContainerAssignment) => {
    const before = { ...c };
    const meal = await eatLeftover(c);
    undo.offer(c.recipeTitle + 'を食べたことにしました', () => undoEatLeftover(meal, before));
  };

  const Group = ({ title, items }: { title: string; items: ContainerAssignment[] }) =>
    items.length === 0 ? null : (
      <div className="space-y-2">
        <div className="text-[10px] text-muted-foreground">
          {title}（{items.length} 食ぶん）
        </div>
        <div className="divide-y rounded-lg border">
          {items.map((c) => {
            const over = c.useByDate < today;
            const soon = !over && c.useByDate <= addDaysIso(today, 2);
            return (
              <button
                key={c.id}
                onClick={() => void eat(c)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-accent"
              >
                <span className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                  {c.containerLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.recipeTitle}</span>
                  {/* **作った日を必ず出す。**「9/10まで」だけだと、それが
                      いつ作ったものか分からず、判断の材料にならない */}
                  <span className="block text-[10px] tabular-nums text-muted-foreground">
                    {c.cookedAt ? formatDateJa(c.cookedAt.slice(0, 10)) + 'に作った' : '作った日は不明'}
                    ・{Math.round(c.grams)}g・{Math.round(c.nutrition.kcal)} kcal
                  </span>
                  <span
                    className={cn(
                      'block text-[10px] tabular-nums',
                      over || soon ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {formatDateJa(c.useByDate)}まで
                    {over ? '（過ぎています）' : '（あと' + daysLeft(c.useByDate, today) + '日）'}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">食べた</span>
              </button>
            );
          })}
        </div>
      </div>
    );

  return (
    <div className="pb-8">
      <PageHeader title="残っている作り置き" backTo="/dashboard" />
      {undo.bar}

      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="残っているものはありません"
            description="献立から外れた作り置きや、冷凍に回したぶんがここに並びます。"
            action={
              <Link
                to="/cook"
                className="mt-1 inline-flex min-h-10 items-center rounded-md border px-4 text-sm"
              >
                作り置きへ
              </Link>
            }
          />
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            予定の入っていない作り置きです。どれから食べるかは決めません。
            期限を見て選んでください。食べたら押すだけで、その日の摂取に入り、
            ここから消えます。合わせて {rows.length} 食ぶん・{Math.round(kcal)} kcal。
          </p>

          <Group title="冷凍庫" items={freezer} />
          <Group title="冷蔵庫" items={fridge} />

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            冷凍したものは、食べる前日に冷蔵へ移してください。
          </p>
        </div>
      )}
    </div>
  );
}
