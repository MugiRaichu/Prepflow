import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Eye, Timer as TimerIcon } from 'lucide-react';
import { db, nowIso } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { useWakeLock } from '@/features/shopping/useWakeLock';
import { schedule } from './logic/scheduler';
import { CookTimeline } from './CookTimeline';
import { PackStep } from './PackStep';
import { consumeForPlan } from '@/db/repositories/inventory';
import { useCookingMode } from '@/features/household/useCookingMode';
import { useCookTimers } from './useTimers';
import type { RunningTimer } from './useTimers';
import { formatDateJa, todayIso } from '@/lib/labels';
import type { ScheduledTask } from './logic/types';
import type { PlannedMeal } from '@/db/schema';
import { cn } from '@/lib/utils';

const fmtMin = (sec: number) => Math.round(sec / 60) + '分';
const fmtClock = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
};

/**
 * 作り置きの実行画面。
 * 手が汚れている前提なので、次にやること1つだけを大きく出す（D-015）。
 * 全体像は畳んでおく。画面は消さない。
 */
export function CookScreen() {
  const [showAll, setShowAll] = useState(false);

  const mode = useCookingMode();
  const daily = mode === 'daily';
  const today = todayIso();

  const plan = useLiveQuery(
    async () => (await db.weekPlans.where('deleted').equals(0).reverse().sortBy('weekStart'))[0],
    [],
  );
  const recipes = useLiveQuery(() => db.recipes.where('deleted').equals(0).toArray(), []);
  const equipment = useLiveQuery(() => db.equipment.where('deleted').equals(0).toArray(), []);
  // 毎日作る人は、週ぶんではなく今日のぶんだけを作る
  const todayMeals = useLiveQuery(
    async (): Promise<PlannedMeal[]> =>
      daily ? db.plannedMeals.where('date').equals(today).toArray() : [],
    [daily, today],
  );

  // 進み具合は端末に残す。React の state だけだとタブを離れた瞬間に消え、
  // 戻るたびに最初の手順からになっていた（本人指摘）。
  // 週プランごと（毎日作るなら日ごと）に鍵を分け、新しい献立では最初から始まる
  const doneKey = plan ? 'cookDone:' + plan.id + (daily ? ':' + today : '') : null;
  const doneRow = useLiveQuery(
    async () => (doneKey ? await db.meta.get(doneKey) : undefined),
    [doneKey],
  );
  const done = useMemo(
    () => new Set<string>((doneRow?.value as string[] | undefined) ?? []),
    [doneRow],
  );
  const markDone = async (id: string) => {
    if (!doneKey) return;
    await db.meta.put({ key: doneKey, value: [...done, id], updatedAt: nowIso() });
  };

  const result = useMemo(() => {
    if (!plan || !recipes || !equipment) return null;
    if (daily && !todayMeals) return null;
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const counts = new Map<string, number>();
    if (daily) {
      // 今日の献立に出てくる料理だけ。同じ料理が朝と夕に出ても作るのは1回
      for (const meal of todayMeals ?? []) {
        for (const it of meal.items) counts.set(it.recipeId, 1);
      }
    } else {
      for (const id of plan.recipeIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const items: { recipe: NonNullable<ReturnType<typeof byId.get>>; batches: number }[] = [];
    for (const [id, batches] of counts) {
      const r = byId.get(id);
      if (r) items.push({ recipe: r, batches });
    }
    if (items.length === 0) return null;

    return schedule({
      items,
      equipment: equipment
        .filter((e) => e.isAvailable === 1)
        .map((e) => ({
          id: e.id,
          name: e.name,
          kind: e.kind,
          slots: e.slots,
          ...(e.preheatSec ? { preheatSec: e.preheatSec } : {}),
        })),
    });
  }, [plan, recipes, equipment, daily, todayMeals]);

  // 鳴らすのはフック側の仕事（1秒ごとの再描画に頼ると、裏に回ったとき鳴らない）
  const {
    timers,
    start: startTimer,
    stop: stopTimer,
    has: hasTimer,
    noticeBlocked,
  } = useCookTimers(plan?.id);

  const allDone = Boolean(result) && result!.tasks.every((t) => done.has(t.id));
  // 作り終えたら画面を消してよい
  const wake = useWakeLock(Boolean(result) && !allDone);

  // 全部作り終えたら、使った材料を在庫から引く。**1回だけ**。
  // 「引いたか」も端末に残す。state だけだと、戻ってくるたびに引いて在庫が合わなくなる。
  // 読み込み中（undefined）と未記録（null）を分けないと、読み込み中に二重に引く
  const consumedKey = plan ? 'cookConsumed:' + plan.id : null;
  const consumedRow = useLiveQuery(
    async () => (consumedKey ? ((await db.meta.get(consumedKey)) ?? null) : null),
    [consumedKey],
  );
  useEffect(() => {
    // 毎日作る場合はここで週ぶんを引くと在庫が合わなくなる。作り置きのときだけ
    if (allDone && plan && consumedKey && consumedRow === null && !daily) {
      void db.meta.put({ key: consumedKey, value: nowIso(), updatedAt: nowIso() });
      void consumeForPlan(plan);
    }
  }, [allDone, plan, consumedKey, consumedRow, daily]);

  if (!plan || !result) {
    return (
      <div>
        <PageHeader title={daily ? '今日作る' : '作り置き'} />
        <div className="p-4">
          <EmptyState
            title={daily ? '今日のぶんはありません' : '作るものがありません'}
            description={
              daily
                ? plan
                  ? // 献立はあるが今日は範囲外。いつから始まるかを言わないと手が止まる
                    formatDateJa(plan.weekStart) + ' からの献立になっています。'
                  : '献立を作ると、今日のぶんの手順がここに出ます。'
                : '週のプランを作ると、待ち時間の出ない段取りを組みます。'
            }
            action={
              <Link
                to="/plan"
                className="mt-1 inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
              >
                献立を作る
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const remaining = result.tasks.filter((t) => !done.has(t.id));
  const next = remaining[0];
  const upcoming = remaining.slice(1, 4);
  const saved = result.sequentialSec - result.makespanSec;

  return (
    <div className="pb-6">
      <PageHeader title={daily ? '今日作る' : '作り置き'} />

      {/* 手を止めずに並行で動いているものは、常に見える位置に置く。
          スクロールしても隠れない（本人指摘: 同時並行の操作が見えない） */}
      <RunningPanel timers={timers} onStop={(id) => void stopTimer(id)} blocked={noticeBlocked} />

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="全体" value={fmtMin(result.makespanSec)} />
          <Stat label="手を動かす" value={fmtMin(result.handsOnSec)} />
          <Stat label="待ち時間" value={fmtMin(result.idleSec)} />
        </div>

        {saved > 60 && (
          <div className="rounded-lg border p-3 text-xs leading-relaxed">
            順番に作ると {fmtMin(result.sequentialSec)} かかるところを、
            <span className="font-medium"> {fmtMin(result.makespanSec)} </span>
            に詰めました（{fmtMin(saved)} 短縮）。
          </div>
        )}

        {wake.active && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Eye className="size-3" />
            画面が消えないようにしています
          </div>
        )}

        {next ? (
          <NextCard
            task={next}
            running={hasTimer(next.id)}
            onStart={(sec) => void startTimer(next.id, next.recipeTitle + '　' + next.label, sec)}
            // タイマーは止めない。止めると、次の作業に進んだ瞬間に
            // 火にかけたままの鍋の残り時間が消える（本人指摘）
            onDone={() => void markDone(next.id)}
          />
        ) : daily ? (
          // その場で食べるので詰める工程は出さない
          <div className="rounded-lg border p-4 text-center text-sm font-medium">
            今日のぶんはできあがりです
          </div>
        ) : (
          <PackStep weekPlanId={plan.id} />
        )}

        {upcoming.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">このあと</div>
            {upcoming.map((t) => (
              <div key={t.id} className="flex gap-3 rounded-md border px-3 py-2">
                <span className="w-10 shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground">
                  {fmtClock(t.startSec)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{t.label}</div>
                  <div className="text-[10px] text-muted-foreground">{t.recipeTitle}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <button
            onClick={() => setShowAll(!showAll)}
            className="flex min-h-10 w-full items-center justify-center gap-1 rounded-md border text-xs active:bg-accent"
          >
            全体の段取りを見る
            <ChevronDown className={cn('size-3.5 transition-transform', showAll && 'rotate-180')} />
          </button>
          {showAll && (
            <div className="pf-rise mt-3">
              <CookTimeline result={result} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** これ以上の放置時間があるなら、タイマーを勧める（90秒） */
const TIMER_THRESHOLD_SEC = 90;

function NextCard({
  task,
  running,
  onStart,
  onDone,
}: {
  task: ScheduledTask;
  running: boolean;
  onStart: (seconds: number) => void;
  onDone: () => void;
}) {
  // 放置している時間。ここを計り忘れると焦がすか、逆に見張って時間を無駄にする
  const waitSec = Math.max(0, task.durationSec - task.handsOnSec);
  const suggest = waitSec >= TIMER_THRESHOLD_SEC;

  return (
    <div className="pf-rise space-y-4 rounded-lg border-2 border-foreground p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{task.recipeTitle}</span>
        {task.equipmentName && (
          <span className="rounded border px-1.5 py-0.5 text-[10px]">{task.equipmentName}</span>
        )}
      </div>

      <p className="text-xl font-semibold leading-snug">{task.label}</p>

      <div className="flex gap-4 text-xs tabular-nums text-muted-foreground">
        <span>かかる時間 {fmtMin(task.durationSec)}</span>
        {task.handsOnSec === 0 ? (
          <span className="font-medium text-foreground">放置でOK</span>
        ) : (
          <span>手を動かす {fmtMin(task.handsOnSec)}</span>
        )}
      </div>

      {/* 長く待つ手順は、タイマーを置いてから次に進む。
          並行調理では次の作業に移るので、置かないと戻るきっかけが無くなる */}
      {suggest && !running && (
        <button
          onClick={() => onStart(waitSec)}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-foreground text-sm font-semibold active:bg-accent"
        >
          <TimerIcon className="size-4" />
          {fmtMin(waitSec)}のタイマーをかける
        </button>
      )}
      {suggest && running && (
        <div className="text-center text-xs text-muted-foreground">
          タイマーが動いています。次の作業に進んでください
        </div>
      )}

      <button
        onClick={onDone}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-base font-semibold text-background"
      >
        <Check className="size-5" />
        できた
      </button>
    </div>
  );
}

/**
 * いま並行して動いているもの。
 *
 * 段取りは「煮ている間に切る」を前提に組んでいるので、手元の作業と
 * 放置中の鍋やレンジが常に同時に走る。手元だけを大きく出していると、
 * 火にかけたものが視界から消えて焦がす。
 * だから画面の上に貼り付けて、スクロールしても残す。
 */
function RunningPanel({
  timers,
  onStop,
  blocked,
}: {
  timers: RunningTimer[];
  onStop: (id: string) => void;
  blocked: boolean;
}) {
  if (timers.length === 0) return null;
  const sorted = [...timers].sort((a, b) => a.remainSec - b.remainSec);
  const ringing = sorted.filter((t) => t.remainSec === 0).length;

  return (
    <div className="sticky top-12 z-10 space-y-2 border-b bg-background px-4 py-2">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <TimerIcon className="size-3" />
        {ringing > 0 ? (
          <span className="font-medium text-foreground">できあがりました</span>
        ) : (
          <span>同時に進んでいます（{timers.length}）</span>
        )}
      </div>

      {sorted.map((t) => {
        const done = t.remainSec === 0;
        return (
          <button
            key={t.taskId}
            onClick={() => onStop(t.taskId)}
            className={cn(
              'flex min-h-12 w-full items-center gap-3 rounded-lg border px-4 text-left',
              done ? 'pf-ring border-foreground bg-foreground text-background' : 'border-border',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-xs">{t.label}</span>
            <span className="shrink-0 text-lg font-semibold tabular-nums">
              {done ? 'できた' : fmtClock(t.remainSec)}
            </span>
          </button>
        );
      })}

      {/* 断りを入れるのは、実際に使えないときだけ。使えている人には何も出さない */}
      {blocked && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          通知が止められているので、鳴っても知らせられません。この画面を開いたままにしてください。
        </p>
      )}
    </div>
  );
}
