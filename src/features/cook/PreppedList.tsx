import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/shared/EmptyState';
import { useUndoBar } from '@/components/shared/UndoBar';
import {
  eatLeftover,
  listEatenToday,
  listPrepped,
  undoEatByContainer,
  undoEatLeftover,
} from '@/db/repositories/leftovers';
import type { ContainerAssignment } from '@/db/schema';
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

/**
 * 今日食べたもの。
 *
 * 「食べた」を押すと一覧から**消えていた**。押し間違えたのか効いたのかが
 * 画面から分からず、取り消しの帯は数秒で消える（本人指摘）。
 * 下に残しておけば、効いたことも、戻せることも見える。
 */
function EatenToday({
  rows,
  undo,
}: {
  rows: ContainerAssignment[];
  undo: ReturnType<typeof useUndoBar>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        今日食べたもの（{rows.length} 件）
      </div>
      <div className="divide-y rounded-lg border">
        {rows.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {c.containerLabel}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-muted-foreground line-through">
                {c.recipeTitle}
              </span>
              <span className="block text-xs tabular-nums text-muted-foreground">
                {Math.round(c.grams)}g・{Math.round(c.nutrition.kcal)} kcal
              </span>
            </span>
            {/* 押し間違いはここから戻す。帯が消えたあとでも戻せる */}
            <button
              onClick={() => {
                void undoEatByContainer(c);
                undo.offer(c.recipeTitle + 'を戻しました', async () => {
                  await eatLeftover(c);
                });
              }}
              className="min-h-11 shrink-0 rounded-md border px-2.5 text-xs text-muted-foreground active:bg-accent"
            >
              戻す
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PreppedList() {
  const undo = useUndoBar();
  const rows = useLiveQuery(listPrepped, []);
  const eaten = useLiveQuery(listEatenToday, []);
  if (!rows) return null;

  const today = todayIso();
  const freezer = rows.filter((x) => x.container.storage === 'freezer');
  const fridge = rows.filter((x) => x.container.storage !== 'freezer');
  const kcal = rows.reduce((n, x) => n + x.container.nutrition.kcal, 0);
  // まとめ詰めは特定の日のものではないので、「予定なし」に数えない
  const free = rows.filter((x) => !x.plannedDate && x.container.portion !== 'batch').length;

  const eat = async (c: PreppedItem['container']) => {
    const before = { ...c };
    const meal = await eatLeftover(c);
    undo.offer(c.recipeTitle + 'を食べたことにしました', () => undoEatLeftover(meal, before));
  };

  const Group = ({ title, items }: { title: string; items: PreppedItem[] }) =>
    items.length === 0 ? null : (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          {title}（{items.length} 個）
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
                <span className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-xs font-semibold">
                  {c.containerLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{c.recipeTitle}</span>
                  {/*
                    **いつ食べるかを一番大きく出す。**
                    以前は「9/8に作った」を先頭に置いていたが、作った日を
                    知っても手は動かない（本人指摘）。冷蔵庫を開けて探して
                    いるのは「今日食べるのはどれか」なので、それを先に出す。
                    期限とグラムは、その下に小さく添える。
                  */}
                  <span className="mt-0.5 block text-sm font-medium tabular-nums">
                    {c.portion === 'batch'
                      ? '取り分け用' + (c.servingsCount ? '（' + c.servingsCount + '食ぶん）' : '')
                      : plannedDate
                        ? plannedDate === today
                          ? '今日たべる'
                          : formatDateJa(plannedDate).replace(/（.）/, '') + 'にたべる'
                        : '食べる日は未定'}
                  </span>
                  <span
                    className={cn(
                      'block text-xs tabular-nums',
                      over || soon ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {/* 味が先に落ちる品だけ、その日を出す。同じなら期限だけ */}
                    {c.bestByDate && c.bestByDate < c.useByDate
                      ? 'おいしいのは ' + formatDateJa(c.bestByDate) + 'まで（期限は ' +
                        formatDateJa(c.useByDate) + '）'
                      : formatDateJa(c.useByDate) +
                        'まで' +
                        (over ? '（過ぎています）' : '（あと' + daysLeft(c.useByDate, today) + '日）')}
                    ・{Math.round(c.grams)}g・{Math.round(c.nutrition.kcal)} kcal
                    {/*
                      **なぜ前に置いてあるかを言う。**並び順だけでは
                      「早く食べて」が伝わらない。凍っていて期限は先なのに
                      上にある品は、理由が無いと後回しにされる
                    */}
                    {c.storage === 'freezer' && c.bestByDate && c.bestByDate < c.useByDate && (
                      <span className="block text-foreground">
                        冷凍で食感が変わる材料が入っています。早めに
                      </span>
                    )}
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
        <div className="space-y-4 p-4">
          <EmptyState
            title="作り置きはありません"
            description="作って詰めたものが、ここに全部並びます。"
            action={
              <Link
                to="/cook"
                className="mt-1 inline-flex min-h-11 items-center rounded-md border px-4 text-sm"
              >
                作り置きへ
              </Link>
            }
          />
          {/* 全部食べ切った直後は、ここだけが「効いた」証拠になる */}
          <EatenToday rows={eaten ?? []} undo={undo} />
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {/*
            **「食ぶん」で数えない。**主菜は1食ずつ、副菜はまとめて詰めるので、
            容器の数と食数は一致しない。
            **「消えます」とも言わない。**押したものは下の「今日食べたもの」へ
            移る（消えると押し間違いを戻せない。本人指摘）
          */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            いま家にある作り置きです。合わせて {rows.length} 個・
            {Math.round(kcal)} kcal
            {free > 0 && '、うち ' + free + ' 個は食べる日が決まっていません'}。
            <b className="text-foreground">おいしいうちに食べたい順</b>
            に並べています（傷む日ではなく、味が落ちる日の順）。
            食べたら押すだけで、その日の摂取に入ります。
          </p>

          <Group title="冷凍庫" items={freezer} />
          <Group title="冷蔵庫" items={fridge} />

          <p className="text-xs leading-relaxed text-muted-foreground">
            冷凍したものは、食べる前日に冷蔵へ移してください。
          </p>

          <EatenToday rows={eaten ?? []} undo={undo} />
        </div>
      )}
    </div>
  );
}
