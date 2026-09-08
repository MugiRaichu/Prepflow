import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/shared/EmptyState';
import { useUndoBar } from '@/components/shared/UndoBar';
import { eatLeftover, listPrepped, undoEatLeftover } from '@/db/repositories/leftovers';
import type { PreppedItem } from '@/db/repositories/leftovers';
import { addDaysIso, formatDateJa, todayIso } from '@/lib/labels';
import { cn } from '@/lib/utils';

/**
 * いま家にある作り置きの一覧。**詰めたものを1か所で管理する。**
 *
 * これまで `/freezer` にしか無く、今日の画面のリンクからしか行けなかった。
 * 「作り置き」のタブから見られないと、詰めたあと何がどれだけ残っているか
 * 分からない（本人指摘）。作り置きのタブと、この画面の両方から使う。
 *
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

export function PreppedList() {
  const undo = useUndoBar();
  const rows = useLiveQuery(listPrepped, []);
  if (!rows) return null;

  const today = todayIso();
  const freezer = rows.filter((x) => x.container.storage === 'freezer');
  const fridge = rows.filter((x) => x.container.storage !== 'freezer');
  const kcal = rows.reduce((n, x) => n + x.container.nutrition.kcal, 0);
  const free = rows.filter((x) => !x.plannedDate).length;

  const eat = async (c: PreppedItem['container']) => {
    const before = { ...c };
    const meal = await eatLeftover(c);
    undo.offer(c.recipeTitle + 'を食べたことにしました', () => undoEatLeftover(meal, before));
  };

  const Group = ({ title, items }: { title: string; items: PreppedItem[] }) =>
    items.length === 0 ? null : (
      <div className="space-y-2">
        <div className="text-[10px] text-muted-foreground">
          {title}（{items.length} 食ぶん）
        </div>
        <div className="divide-y rounded-lg border">
          {items.map(({ container: c, plannedDate }) => {
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
                    {plannedDate
                      ? '・' + formatDateJa(plannedDate).replace(/（.）/, '') + 'に食べる予定'
                      : '・予定なし'}
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
    <div>
      {undo.bar}

      {rows.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="作り置きはありません"
            description="作って詰めたものが、ここに全部並びます。"
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
            いま家にある作り置きです。合わせて {rows.length} 食ぶん・
            {Math.round(kcal)} kcal
            {free > 0 && '、うち ' + free + ' 食ぶんは予定が入っていません'}。
            どれから食べるかは決めません。期限を見て選んでください。
            食べたら押すだけで、その日の摂取に入り、ここから消えます。
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
