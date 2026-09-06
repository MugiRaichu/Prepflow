import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { db } from '@/db/db';
import { todayIso, formatDateJa, MEAL_SLOT_LABELS } from '@/lib/labels';
import { sumMacros } from '@/lib/nutrition';
import { EmptyState } from '@/components/shared/EmptyState';
import type {
  AppSettings,
  ContainerAssignment,
  Habit,
  Macros,
  PlannedMeal,
  Profile,
  Recipe,
  Weekday,
  WeekPlan,
} from '@/db/schema';
import { DishImage } from '@/features/recipes/DishImage';
import { useUndoBar } from '@/components/shared/UndoBar';
import { handleMissedMeal, undoMissedMeal } from '@/db/repositories/meals';
import { eatLeftover, listLeftovers, undoEatLeftover } from '@/db/repositories/leftovers';
import type { MissedAction } from '@/db/repositories/meals';
import { addDaysIso } from '@/lib/labels';
import { buildTimeline, toMin } from '@/features/rhythm/logic/timeline';
import type { CalendarBlock } from '@/features/rhythm/logic/timeline';
import { blocksFor, readCache, syncCalendarIfStale } from '@/calendar/gasCalendar';
import { useCookingMode } from '@/features/household/useCookingMode';
import { handsOnMinutes } from '@/db/data/build';
import { perDayMinutes } from '@/features/planner/logic/time';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

/**
 * 何週続けて献立を作れているか。
 * 「1回の量」ではなく「決まった間隔で続けること」が効くので、これを見せる。
 * 途切れたら 0 に戻るが、責める文言は出さない。
 */
function weekStreak(plans: WeekPlan[], today: string): number {
  if (plans.length === 0) return 0;
  const starts = new Set(plans.map((p) => p.weekStart));
  let streak = 0;
  // 直近のプランの週から1週ずつ遡る
  let cursor = plans[0]!.weekStart;
  // 今週より未来のプランは数えない
  if (cursor > addDaysIso(today, 7)) return 0;
  while (starts.has(cursor)) {
    streak++;
    cursor = addDaysIso(cursor, -7);
  }
  return streak;
}

/**
 * 平日に開く画面。入力させない（D-015）。
 * 「今日これを食べる」を1つ大きく出すだけで、記録も操作も要らない。
 */
export function Dashboard() {
  const today = todayIso();

  const profiles = useLiveQuery(() => db.profiles.where('deleted').equals(0).toArray(), []);
  const meals = useLiveQuery(
    () => db.plannedMeals.where('date').equals(today).toArray(),
    [today],
  );
  const assignments = useLiveQuery(
    () => db.containerAssignments.where('intendedDate').equals(today).toArray(),
    [today],
  );
  const expiring = useLiveQuery(
    () =>
      db.containerAssignments
        .where('useByDate')
        .belowOrEqual(today)
        .filter((a) => a.deleted === 0 && !a.consumedAt)
        .toArray(),
    [today],
  );

  const plans = useLiveQuery(
    () => db.weekPlans.where('deleted').equals(0).reverse().sortBy('weekStart'),
    [],
  );
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  const habits = useLiveQuery(() => db.habits.where('deleted').equals(0).toArray(), []);
  const recipes = useLiveQuery(() => db.recipes.where('deleted').equals(0).toArray(), []);
  const mode = useCookingMode();
  // 献立に絵を出すのに使う。写真があれば写真、無ければ料理から決まる絵
  const byRecipeId = new Map((recipes ?? []).map((r) => [r.id, r]));
  const undo = useUndoBar();

  // カレンダーの予定。今日タブを開いたとき、古ければ取り直す
  const calendar = useLiveQuery(readCache, []);
  useEffect(() => {
    if (settings) void syncCalendarIfStale(settings);
  }, [settings]);

  // 毎日作る人には「作る」の枠を流れに入れる。手を動かす時間は今日の料理から出す
  const cookMinutes = (() => {
    if (mode !== 'daily' || !recipes || !meals) return 0;
    const ids = new Set(meals.flatMap((m) => m.items.map((i) => i.recipeId)));
    const hands = recipes.filter((r) => ids.has(r.id)).reduce((n, r) => n + handsOnMinutes(r), 0);
    return hands > 0 ? Math.round(perDayMinutes(hands, 1)) : 0;
  })();
  const me = profiles?.find((p) => p.isActive === 1);
  const streak = weekStreak(plans ?? [], today);

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-xs text-muted-foreground">{formatDateJa(today)}</div>
        <h1 className="text-2xl font-semibold tracking-tight">今日の食事</h1>
      </div>

      {undo.bar}

      <LeftoverCard onUndo={undo.offer} />

      {expiring && expiring.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-foreground/40 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="text-xs leading-relaxed">
            <div className="font-medium">期限が来ているものが {expiring.length} 件あります</div>
            <div className="text-muted-foreground">
              {expiring.map((a) => a.containerLabel + ' ' + a.recipeTitle).join(' / ')}
            </div>
          </div>
        </div>
      )}

      {meals && meals.length > 0 ? (
        <div className="space-y-3">
          {meals.map((m) => (
            <MealCard
              key={m.id}
              meal={m}
              assignments={assignments ?? []}
              recipes={byRecipeId}
              onUndo={undo.offer}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="今日の予定はまだありません"
          description="週のプランを作ると、ここに毎日の食事が並びます。"
          action={
            <Link
              to="/plan"
              className="mt-1 inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
            >
              週のプランを作る
            </Link>
          }
        />
      )}

      {settings && (
        <TimelineCard
          settings={settings}
          habits={habits ?? []}
          events={blocksFor(calendar ?? null, today)}
          cookMinutes={cookMinutes}
        />
      )}

      {/*
        **食べたものだけを数える。**献立に載っているだけの食事まで足していたので、
        食べられなかった日も目標を満たしたことになっていた。
        食べたら押す、という一手間の意味がここにある
      */}
      {me && (
        <TargetCard
          profile={me}
          eaten={sumMacros(
            (meals ?? []).filter((m) => m.status === 'eaten').map((m) => m.nutrition),
          )}
          planned={sumMacros((meals ?? []).map((m) => m.nutrition))}
        />
      )}

      {streak > 0 && (
        <div className="rounded-lg border p-3 text-xs leading-relaxed">
          <span className="font-medium tabular-nums">{streak} 週</span> 続いています
        </div>
      )}
    </div>
  );
}

/**
 * 予定の無い作り置き。
 *
 * 食べなかった日のぶん、冷凍に回したぶん、作り直しで献立から外れたぶん。
 * 夜食に食べることもあれば翌週まで置くこともあるが、**食べたのに数えない**のは
 * 食べていないのに数えるのと同じくらい困る。
 *
 * 押すのは1回だけ。いつ食べたかは聞かない（押した日でいい）。
 * 期限の近いものから並べる。
 */
function LeftoverCard({
  onUndo,
}: {
  onUndo: (label: string, undo: () => Promise<void>) => void;
}) {
  const rows = useLiveQuery(listLeftovers, []);
  if (!rows || rows.length === 0) return null;

  const eat = async (c: (typeof rows)[number]) => {
    const before = { ...c };
    const meal = await eatLeftover(c);
    onUndo(c.recipeTitle + 'を食べたことにしました', () => undoEatLeftover(meal, before));
  };

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">
        予定の無い作り置きが {rows.length} 食ぶんあります
      </div>
      <div className="divide-y">
        {rows.slice(0, 5).map((c) => (
          <button
            key={c.id}
            onClick={() => void eat(c)}
            className="flex w-full items-center gap-3 py-2.5 text-left active:bg-accent"
          >
            <span className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold">
              {c.containerLabel}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{c.recipeTitle}</span>
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {c.storage === 'freezer' ? '冷凍' : '冷蔵'}・{formatDateJa(c.useByDate)}まで・
                {Math.round(c.nutrition.kcal)} kcal
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">食べた</span>
          </button>
        ))}
      </div>
      {/* 毎日見る場所は短くする。全部を見たい人は冷凍在庫のページへ */}
      <Link
        to="/freezer"
        className="flex min-h-9 items-center justify-center text-[10px] text-muted-foreground underline underline-offset-2"
      >
        {rows.length > 5 ? 'ほか ' + (rows.length - 5) + ' 食ぶんを見る' : '残っているものを全部見る'}
      </Link>
    </div>
  );
}

/**
 * 食べられなかったときの3択。
 *
 * 急な会食、体調、予定変更。**食べていないものを食べたことにすると、
 * 摂取カロリーの集計が狂う。**理由は聞かず、押すだけで食べ物と数字の
 * 両方が正しくなるようにする。
 *
 * 「同居人が食べた」は世帯モデルができてから足す。いま出しても付け替える先が無い。
 */
const MISSED: { value: MissedAction; label: string; note: string }[] = [
  { value: 'freeze', label: '冷凍する', note: '食べ物は残ります。期限を今日から30日に引き直します' },
  { value: 'tomorrow', label: '明日たべる', note: '明日の同じ枠へ移します' },
  { value: 'discard', label: '捨てた', note: '摂取には数えません' },
];

function MealCard({
  meal,
  assignments,
  recipes,
  onUndo,
}: {
  meal: PlannedMeal;
  assignments: ContainerAssignment[];
  recipes: Map<string, Recipe>;
  onUndo: (label: string, undo: () => Promise<void>) => void;
}) {
  const eaten = meal.status === 'eaten';
  const skipped = meal.status === 'skipped';
  const [asking, setAsking] = useState(false);

  const toggle = async () => {
    const next = eaten
      ? { status: 'planned' as const, eatenAt: undefined }
      : { status: 'eaten' as const, eatenAt: new Date().toISOString() };
    await db.plannedMeals.put({ ...meal, ...next, updatedAt: new Date().toISOString() });
  };

  const missed = async (action: MissedAction, label: string) => {
    setAsking(false);
    const before = await handleMissedMeal(meal, action);
    onUndo('この食事を「' + label + '」にしました', () => undoMissedMeal(before));
  };

  return (
    <div className="rounded-lg border p-4">
      <button onClick={toggle} className="w-full text-left active:scale-[0.99]">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-medium">
          {MEAL_SLOT_LABELS[meal.slot]}
        </span>
        {eaten && <span className="text-[10px] text-muted-foreground">食べた</span>}
        {skipped && <span className="text-[10px] text-muted-foreground">食べていません</span>}
      </div>

      {meal.items.map((it, idx) => {
        const a = assignments.find((x) => x.id === it.containerAssignmentId);
        const r = recipes.get(it.recipeId);
        return (
          <div key={idx} className="flex items-center gap-2.5">
            {/* 名前だけの行が並ぶと、どれがどれか読まないと分からない */}
            {r && <DishImage recipe={r} className="size-11" />}
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              {a && (
                <span className="rounded border px-1.5 py-0.5 text-xs font-mono font-semibold">
                  {a.containerLabel}
                </span>
              )}
              <span className="text-lg font-semibold">{it.recipeTitle}</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {Math.round(it.grams)}g
              </span>
            </div>
          </div>
        );
      })}

      <div className="mt-2 text-xs tabular-nums text-muted-foreground">
        {Math.round(meal.nutrition.kcal)} kcal ・ P {Math.round(meal.nutrition.proteinG)}g ・ F{' '}
        {Math.round(meal.nutrition.fatG)}g ・ C {Math.round(meal.nutrition.carbG)}g
      </div>
      </button>

      {/* 食べていない食事の始末。ふだんは1行、押すと3択が開く */}
      {!eaten && !skipped && (
        <div className="mt-3 border-t pt-2">
          {asking ? (
            <div className="space-y-2">
              {MISSED.map((m) => (
                <button
                  key={m.value}
                  onClick={() => void missed(m.value, m.label)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md border px-3 text-left active:bg-accent"
                >
                  <span className="shrink-0 text-xs font-medium">{m.label}</span>
                  <span className="min-w-0 flex-1 text-[10px] text-muted-foreground">{m.note}</span>
                </button>
              ))}
              <button
                onClick={() => setAsking(false)}
                className="min-h-8 w-full text-[10px] text-muted-foreground"
              >
                やめる
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAsking(true)}
              className="min-h-8 w-full text-left text-[10px] text-muted-foreground"
            >
              食べられなかった
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 今日の流れ。起床・就寝・予定から組んだ、食事とたんぱく質の時刻。
 *
 * 以前は設定の「1日の流れ」の一番下にだけあり、起きる時刻を設定しても
 * どこに反映されるのか分からなかった（本人指摘）。見る場所は今日タブ。
 * 目に入るのは**次にやること1つ**。それ以外は薄く並べるだけ。
 */
function TimelineCard({
  settings,
  habits,
  events,
  cookMinutes,
}: {
  settings: AppSettings;
  habits: Habit[];
  events: CalendarBlock[];
  cookMinutes: number;
}) {
  const weekday = new Date().getDay() as Weekday;
  const timeline = buildTimeline({
    rhythm: settings.rhythm,
    habits,
    weekday,
    coverSlots: settings.cooking.coverSlots,
    events,
    ...(cookMinutes > 0 ? { cookMinutes } : {}),
  });
  if (timeline.length === 0) return null;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nextIdx = timeline.findIndex((e) => toMin(e.time) >= nowMin);

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">今日の流れ</span>
        <Link to="/rhythm" className="text-xs underline underline-offset-2">
          変更
        </Link>
      </div>
      <div className="space-y-1.5">
        {timeline.map((e, i) => {
          const isNext = i === nextIdx;
          const past = nextIdx === -1 || i < nextIdx;
          return (
            <div
              key={i}
              className={cn(
                'flex gap-3 rounded-md px-2 py-1.5',
                isNext && 'bg-foreground text-background',
                past && 'text-muted-foreground',
              )}
            >
              <span className="w-11 shrink-0 text-xs font-medium tabular-nums">{e.time}</span>
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm', isNext && 'font-semibold')}>
                  {e.label}
                  {e.endTime ? <span className="ml-1 text-xs opacity-70">〜{e.endTime}</span> : null}
                </div>
                {isNext && e.note ? (
                  <div className="text-[11px] leading-relaxed opacity-80">{e.note}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TargetCard({
  profile,
  eaten,
  planned,
}: {
  profile: Profile;
  eaten: Macros;
  planned: Macros;
}) {
  const t = profile.baseTargets;
  const rows = [
    { label: 'kcal', a: eaten.kcal, p: planned.kcal, t: t.kcal },
    { label: 'P', a: eaten.proteinG, p: planned.proteinG, t: t.proteinG },
    { label: 'F', a: eaten.fatG, p: planned.fatG, t: t.fatG },
    { label: 'C', a: eaten.carbG, p: planned.carbG, t: t.carbG },
  ];

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">
          {profile.name} の目標
          {planned.kcal > eaten.kcal && (
            <span className="ml-1.5">
              （残り {Math.round(planned.kcal - eaten.kcal)} kcal ぶんが献立にあります）
            </span>
          )}
        </span>
        <Link to="/settings" className="shrink-0 text-xs underline underline-offset-2">
          変更
        </Link>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-8 shrink-0 text-xs text-muted-foreground">{r.label}</span>
            {/* 実線が食べたぶん、薄い帯が献立に残っているぶん */}
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/25"
                style={{ width: Math.min((r.p / Math.max(r.t, 1)) * 100, 100) + '%' }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-foreground"
                style={{ width: Math.min((r.a / Math.max(r.t, 1)) * 100, 100) + '%' }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round(r.a)} / {Math.round(r.t)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
