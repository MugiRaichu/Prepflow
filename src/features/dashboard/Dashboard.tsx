import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Boxes, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { listPrepped } from '@/db/repositories/leftovers';
import type { MissedAction } from '@/db/repositories/meals';
import { addDaysIso } from '@/lib/labels';
import { buildTimeline, toMin } from '@/features/rhythm/logic/timeline';
import type { CalendarBlock } from '@/features/rhythm/logic/timeline';
import { blocksFor, readCache } from '@/calendar/gasCalendar';
import { useCalendarSync } from '@/calendar/useCalendarSync';
import { useCookingMode } from '@/features/household/useCookingMode';
import { handsOnMinutes } from '@/db/data/build';
import { perDayMinutes } from '@/features/planner/logic/time';
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

/** 見出しに出す日付の呼び方。日付だけだと、今日との距離が頭の中で計算になる */
function dayLabel(date: string, today: string): string {
  const days = Math.round(
    (new Date(date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000,
  );
  if (days === -1) return '昨日の食事';
  if (days === 1) return '明日の食事';
  if (days < 0) return Math.abs(days) + '日前の食事';
  return days + '日後の食事';
}

/**
 * 平日に開く画面。入力させない（D-015）。
 * 「今日これを食べる」を1つ大きく出すだけで、記録も操作も要らない。
 */
export function Dashboard() {
  const today = todayIso();
  /*
   * 見ている日。**今日から動かせる。**
   *
   * 昨日なにを食べたか、明日なにを食べるかは、その日になる前に知りたい
   * （本人指摘）。日付を押して前後に動かす。今日以外を見ているときは
   * そのことが分かるようにして、1タップで今日へ戻れるようにする。
   */
  const [date, setDate] = useState(todayIso());
  const isToday = date === today;

  const profiles = useLiveQuery(() => db.profiles.where('deleted').equals(0).toArray(), []);
  const meals = useLiveQuery(
    () => db.plannedMeals.where('date').equals(date).toArray(),
    [date],
  );
  /*
   * 「今日の食事」の欄に出すのは**献立だけ**。
   *
   * 残っていた作り置きを食べた記録も同じテーブルに入るが、それは今日の献立では
   * ないので混ぜない。摂取の合計（TargetCard）には両方を入れる。
   */
  /*
   * **消した人の食事は出さない。**
   *
   * 献立は人ごとに作るので、あとで食べる人を減らしても、その人の食事は
   * 残り続けていた。実機では**まったく同じカードが2枚**並び、
   * 片方は誰のものでもなかった（プロファイルはもう無い）。
   * なぜ2回あるのかは、画面からは読み取れない。
   */
  const knownIds = new Set((profiles ?? []).map((p) => p.id));
  const planned = (meals ?? []).filter(
    (m) => m.source !== 'leftover' && (knownIds.size === 0 || knownIds.has(m.profileId)),
  );
  const assignments = useLiveQuery(
    () => db.containerAssignments.where('intendedDate').equals(date).toArray(),
    [date],
  );
  // 期限切れは PreppedStrip の中でラベルを反転させて示す。別枠にしない
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

  /*
   * カレンダーの予定。
   * 開いたときだけでなく、**別のアプリから戻ってきたときにも**取り直す。
   * 直してすぐ戻っても半日前のままだったため（本人指摘）。
   * useLiveQuery なので、取れた瞬間に今日の流れが差し替わる
   */
  const calendar = useLiveQuery(readCache, []);
  useCalendarSync(settings);

  // 毎日作る人には「作る」の枠を流れに入れる。手を動かす時間は今日の料理から出す
  const cookMinutes = (() => {
    if (mode !== 'daily' || !recipes || !meals) return 0;
    const ids = new Set(meals.flatMap((m) => m.items.map((i) => i.recipeId)));
    const hands = recipes.filter((r) => ids.has(r.id)).reduce((n, r) => n + handsOnMinutes(r), 0);
    return hands > 0 ? Math.round(perDayMinutes(hands, 1)) : 0;
  })();
  const me = profiles?.find((p) => p.isActive === 1);
  const manyPeople = (profiles?.length ?? 0) > 1;
  const streak = weekStreak(plans ?? [], today);

  return (
    <div className="space-y-4 p-4">
      {/*
        日付の行。左右で前後の日へ。**指を離さずに1週間をたどれる。**
        今日以外を見ているときだけ「今日へ」を出す（居場所を見失わないため）。
      */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setDate(addDaysIso(date, -1))}
          className="flex size-11 shrink-0 items-center justify-center rounded-md border active:bg-accent"
          aria-label="前の日"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div className="min-w-0 flex-1 text-center">
          <div className="text-xs text-muted-foreground">
            {formatDateJa(date)}
            {isToday && ' ・今日'}
          </div>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {isToday ? '今日の食事' : dayLabel(date, today)}
          </h1>
        </div>

        <button
          onClick={() => setDate(addDaysIso(date, 1))}
          className="flex size-11 shrink-0 items-center justify-center rounded-md border active:bg-accent"
          aria-label="次の日"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {!isToday && (
        <button
          onClick={() => setDate(today)}
          className="min-h-11 w-full rounded-md border text-xs text-muted-foreground active:bg-accent"
        >
          今日へ戻る
        </button>
      )}

      {undo.bar}

      <PreppedStrip />

      {/*
        2人以上いると、**同じ献立のカードが人数ぶん並ぶ。**
        誰のぶんか書いていなかったので、まったく同じカードが2枚出て、
        なぜ2回あるのかが読み取れなかった（実機で確認）。
        1人のときは名前を出さない——書く意味がないうえ、行が1つ増える。
      */}
      {planned.length > 0 ? (
        <div className="space-y-3">
          {planned.map((m) => (
            <MealCard
              key={m.id}
              meal={m}
              assignments={assignments ?? []}
              recipes={byRecipeId}
              onUndo={undo.offer}
              {...(manyPeople
                ? { who: profiles?.find((p) => p.id === m.profileId)?.name ?? '' }
                : {})}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={isToday ? '今日の予定はまだありません' : 'この日の予定はありません'}
          description="週のプランを作ると、ここに毎日の食事が並びます。"
          action={
            <Link
              to="/plan"
              className="mt-1 inline-flex min-h-11 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
            >
              週のプランを作る
            </Link>
          }
        />
      )}

      {/* 今日の流れ・目標・連続週は「今日」の話。ほかの日を見ているときは出さない */}
      {isToday && settings && (
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
      {isToday && me && (
        <TargetCard
          profile={me}
          eaten={sumMacros(
            (meals ?? []).filter((m) => m.status === 'eaten').map((m) => m.nutrition),
          )}
          planned={sumMacros((meals ?? []).map((m) => m.nutrition))}
        />
      )}

      {isToday && streak > 0 && (
        <div className="rounded-lg border p-3 text-xs leading-relaxed">
          <span className="font-medium tabular-nums">{streak} 週</span> 続いています
        </div>
      )}
    </div>
  );
}

/**
 * 作り置きの残り。
 *
 * **料理名を並べない。**今日の画面は「今日食べるもの」を見る場所で、
 * そこに冷蔵庫の中身まで文章で並ぶと、今日の献立が読み取れなくなる。
 * 期限の警告と残りの案内を別々の枠で出していたのも、同じものを2回言っていた。
 *
 * 代わりに**容器のラベルを並べる**。冷蔵庫の中でラベルを探すのと同じ形なので、
 * 数と切迫具合が一目で分かる。名前が要るのは押した先（作り置き一覧）でいい。
 * 期限が来ているものだけ反転して、そこだけ言葉を添える。
 */
function PreppedStrip() {
  const rows = useLiveQuery(listPrepped, []);
  if (!rows || rows.length === 0) return null;

  const today = todayIso();
  const over = rows.filter((x) => x.container.useByDate <= today);
  const soonest = rows[0];

  return (
    <Link to="/freezer" className="block rounded-lg border p-3 active:bg-accent">
      <div className="flex items-center gap-2">
        <Boxes className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm">作り置き {rows.length} 食ぶん</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {rows.slice(0, 14).map(({ container: c }) => (
          <span
            key={c.id}
            className={cn(
              'rounded border px-1.5 py-0.5 font-mono text-xs font-semibold',
              c.useByDate <= today
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            {c.containerLabel}
          </span>
        ))}
        {rows.length > 14 && (
          <span className="px-1 text-xs text-muted-foreground">＋{rows.length - 14}</span>
        )}
      </div>

      <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {over.length > 0
          ? '色のついた ' + over.length + ' 個は期限が来ています。先に食べてください。'
          : soonest
            ? 'いちばん近い期限は ' + formatDateJa(soonest.container.useByDate) + '。'
            : ''}
      </div>
    </Link>
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
  who,
  meal,
  assignments,
  recipes,
  onUndo,
}: {
  /** 誰のぶんか。1人のときは渡さない（書く意味がない） */
  who?: string;
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
        <span className="rounded bg-secondary px-2 py-0.5 text-xs font-medium">
          {who ? who + '・' : ''}
          {MEAL_SLOT_LABELS[meal.slot]}
        </span>
        {eaten && <span className="text-xs text-muted-foreground">食べた</span>}
        {skipped && <span className="text-xs text-muted-foreground">食べていません</span>}
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
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">{m.note}</span>
                </button>
              ))}
              <button
                onClick={() => setAsking(false)}
                className="min-h-11 w-full text-xs text-muted-foreground"
              >
                やめる
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAsking(true)}
              className="min-h-11 w-full text-left text-xs text-muted-foreground"
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
                  <div className="text-xs leading-relaxed opacity-80">{e.note}</div>
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
