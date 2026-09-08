import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Boxes, Check, ChevronLeft, ChevronRight, Circle } from 'lucide-react';
import { db } from '@/db/db';
import { todayIso, formatDateJa, MEAL_SLOT_LABELS } from '@/lib/labels';
import { sumMacros } from '@/lib/nutrition';
import { EmptyState } from '@/components/shared/EmptyState';
import type {
  AppSettings,
  ContainerAssignment,
  Habit,
  Macros,
  MealSlot,
  PlannedMeal,
  Profile,
  Recipe,
  Weekday,
  WeekPlan,
} from '@/db/schema';
import { DishImage } from '@/features/recipes/DishImage';
import { useUndoBar } from '@/components/shared/UndoBar';
import { handleMissedMeal, setMealEaten, undoMissedMeal } from '@/db/repositories/meals';
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
   * **消した人の食事は、並べる側だけでなく数える側からも外す。**
   *
   * 献立は人ごとに作るので、あとで食べる人を減らしても、その人の食事は残り続ける。
   * 並べる側では除いていたが（同じカードが2枚出ていたため）、
   * **合計を出す側が同じ除き方をしていなかった。**
   * 画面には1食1369kcalしか出ていないのに、目標の欄は2738kcalを数えていた（本人指摘）。
   *
   * 除き方を1か所にまとめる。ここを通っていないものは、並びにも数字にも出ない。
   */
  const knownIds = new Set((profiles ?? []).map((p) => p.id));
  const dayMeals = (meals ?? []).filter((m) => knownIds.size === 0 || knownIds.has(m.profileId));
  /*
   * 「今日の食事」の欄に出すのは**献立だけ**。
   * 残っていた作り置きを食べた記録も同じテーブルに入るが、それは今日の献立では
   * ないので混ぜない。摂取の合計には両方を入れる。
   */
  const planned = dayMeals.filter((m) => m.source !== 'leftover');
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
  /*
   * 人ごとの、その日の合計。**「食べた」を押した先がどこなのかを見せるために要る。**
   * 押すと、その食事がここへ足されて帯が伸びる。
   */
  const dayTotals = new Map<string, { eaten: number; target: number }>();
  for (const p of profiles ?? []) {
    const eaten = dayMeals
      .filter((m) => m.profileId === p.id && m.status === 'eaten')
      .reduce((n, m) => n + m.nutrition.kcal, 0);
    dayTotals.set(p.id, { eaten, target: p.baseTargets.kcal });
  }

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
        **1日の流れが、そのまま献立表になる。**

        以前は同じことを2か所で言っていた——上に料理だけのカードが3枚、
        下の「今日の流れ」に時刻だけの「朝食・昼食・夕食」。
        「この料理は何時に食べるのか」を知るには、2つを見比べて
        頭の中で突き合わせる必要があった（本人指摘）。

        いまは朝・昼・夕の行の中に、その枠の料理が入っている。
        起きてから寝るまでを上から読めば、いつ何を食べるかが分かる。

        **流れはどの日でも出す。**日をめくったときに画面の形が変わると、
        同じものを探し直すことになる。
      */}
      {settings && (
        <TimelineCard
          date={date}
          isToday={isToday}
          settings={settings}
          habits={habits ?? []}
          events={blocksFor(calendar ?? null, date)}
          cookMinutes={cookMinutes}
          meals={planned}
          assignments={assignments ?? []}
          recipes={byRecipeId}
          profiles={profiles ?? []}
          manyPeople={manyPeople}
          dayTotals={dayTotals}
          dayWord={isToday ? '今日' : 'この日'}
          onUndo={undo.offer}
        />
      )}

      {/* 献立そのものが無い日。流れの下に1回だけ出す（枠ごとに3回言わない） */}
      {planned.length === 0 && (
        <EmptyState
          title={isToday ? '今日の予定はまだありません' : 'この日の予定はありません'}
          description="週のプランを作ると、上の流れの中に毎日の食事が入ります。"
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

      {/*
        **食べたものだけを数える。**献立に載っているだけの食事まで足していたので、
        食べられなかった日も目標を満たしたことになっていた。
        食べたら押す、という一手間の意味がここにある。

        **その人ぶんだけを数える。**目標はその人のものなので、
        家族ぶんや、消した人のぶんを足すと数が合わなくなる（本人指摘）。
      */}
      {isToday && me && (
        <TargetCard
          profile={me}
          eaten={sumMacros(
            dayMeals.filter((m) => m.profileId === me.id && m.status === 'eaten').map((m) => m.nutrition),
          )}
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

function MealBody({
  who,
  meal,
  assignments,
  recipes,
  total,
  dayWord,
  onUndo,
}: {
  /** 誰のぶんか。1人のときは渡さない（書く意味がない） */
  who?: string;
  meal: PlannedMeal;
  assignments: ContainerAssignment[];
  recipes: Map<string, Recipe>;
  /** この人の、その日の合計と目標。帯を出すのに使う */
  total?: { eaten: number; target: number };
  dayWord: string;
  onUndo: (label: string, undo: () => Promise<void>) => void;
}) {
  const eaten = meal.status === 'eaten';
  const skipped = meal.status === 'skipped';
  const [asking, setAsking] = useState(false);
  /*
    押した瞬間だけ動かす。**開き直すたびに全部が動くのは違う**——
    動きは「いま押した」ことを伝えるためのもので、飾りではない。
  */
  const [justAte, setJustAte] = useState(false);

  const eat = async () => {
    setJustAte(true);
    await setMealEaten(meal, true);
    window.setTimeout(() => setJustAte(false), 1100);
  };

  const missed = async (action: MissedAction, label: string) => {
    setAsking(false);
    const before = await handleMissedMeal(meal, action);
    onUndo('この食事を「' + label + '」にしました', () => undoMissedMeal(before));
  };

  return (
    <div>
      {/*
        枠の名前（朝食・昼食・夕食）は**行の見出しがもう出している。**
        ここで繰り返すと、同じ言葉が1つの行に2回並ぶ。
      */}
      {meal.items.map((it, idx) => {
        const a = assignments.find((x) => x.id === it.containerAssignmentId);
        const r = recipes.get(it.recipeId);
        return (
          <div key={idx} className="flex items-center gap-2.5 py-0.5">
            {/* 名前だけの行が並ぶと、どれがどれか読まないと分からない */}
            {r && (
              <DishImage
                recipe={r}
                className={cn(
                  'shrink-0 transition-all duration-500',
                  eaten ? 'size-8 opacity-60' : 'size-11',
                  justAte && 'pf-eat-settle',
                )}
              />
            )}
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              {a && !eaten && (
                <span className="rounded border px-1.5 py-0.5 font-mono text-xs font-semibold">
                  {a.containerLabel}
                </span>
              )}
              <span
                className={cn(
                  'font-semibold transition-all duration-500',
                  eaten ? 'text-sm text-muted-foreground' : 'text-base',
                )}
              >
                {it.recipeTitle}
              </span>
              {!eaten && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Math.round(it.grams)}g
                </span>
              )}
            </div>
          </div>
        );
      })}

      {who && <div className="mt-1 text-xs font-medium text-muted-foreground">{who}</div>}

      {/*
        食べる前は、栄養の内訳。食べたあとは、**その食事が合計のどこへ入ったか。**
        「食べた」と小さく出すだけでは、押したことが何につながったのか分からない
        （初めて見た人には、そもそも押せる場所だと分からなかった）。
      */}
      {eaten && total ? (
        <EatenGauge meal={meal} total={total} dayWord={dayWord} animate={justAte} />
      ) : (
        <div className="mt-1 text-xs tabular-nums text-muted-foreground">
          {Math.round(meal.nutrition.kcal)} kcal ・ P {Math.round(meal.nutrition.proteinG)}g ・ F{' '}
          {Math.round(meal.nutrition.fatG)}g ・ C {Math.round(meal.nutrition.carbG)}g
        </div>
      )}

      {/*
        **どちらか1つを選ぶ形にする。**

        以前は献立の枠そのものが隠しボタンで、押すと「食べた」になっていた。
        押せることがどこにも書いておらず、触っていないのに食べたことになる事故もあった。
        「食べられなかった」のほうは灰色の細い文字で、押せるものに見えていなかった。

        いまは同じ大きさの丸を2つ並べる。**選ぶものが2つある、と見れば分かる。**
      */}
      {!eaten && !skipped && (
        <div className="mt-2">
          {asking ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">この食事をどうしますか</div>
              {MISSED.map((m) => (
                <button
                  key={m.value}
                  onClick={() => void missed(m.value, m.label)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg border bg-background px-3 text-left active:bg-accent"
                >
                  <span className="shrink-0 text-sm font-medium">{m.label}</span>
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
            /* 横に並べると「食べられなかった」が2行に折れる。縦に積む——
               このあと開く3択とも同じ形になり、選ぶものが上から並ぶ */
            <div className="space-y-2">
              <button
                onClick={() => void eat()}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg border bg-background px-3 text-left text-sm font-semibold active:bg-accent"
              >
                <Circle className="size-4 shrink-0 text-muted-foreground" />
                食べた
              </button>
              <button
                onClick={() => setAsking(true)}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg border bg-background px-3 text-left text-sm active:bg-accent"
              >
                <Circle className="size-4 shrink-0 text-muted-foreground" />
                食べられなかった
              </button>
            </div>
          )}
        </div>
      )}

      {/* 押したあと。**戻せる場所を画面に残す**（消える取り消しに頼らない） */}
      {eaten && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground">
            <Check className="size-3.5 text-background" strokeWidth={3} />
          </span>
          <span className="text-sm font-semibold">食べた</span>
          <button
            onClick={() => void setMealEaten(meal, false)}
            className="ml-auto min-h-11 px-2 text-xs text-muted-foreground underline underline-offset-2"
          >
            取り消す
          </button>
        </div>
      )}

      {skipped && <div className="mt-1.5 text-sm text-muted-foreground">食べていません</div>}
    </div>
  );
}

/**
 * 食べたものが、そのままカロリーの帯になる。
 *
 * 押しても小さく「食べた」と出るだけでは、押したことが何につながったのか
 * 分からない（本人指摘）。料理の絵が縮んで沈み、その下に帯が左から伸びる。
 *
 * 帯は**その日の合計**で、濃いところが**いま押した食事**。
 * 自分の1日のどこを埋めたのかが、押したその場で見える。
 */
function EatenGauge({
  meal,
  total,
  dayWord,
  animate,
}: {
  meal: PlannedMeal;
  total: { eaten: number; target: number };
  dayWord: string;
  animate: boolean;
}) {
  const target = Math.max(total.target, 1);
  const mine = Math.min(meal.nutrition.kcal, total.eaten);
  const before = Math.max(0, total.eaten - mine);
  // 目標を超えたぶんは帯の外に出さない。責める見た目にはしない
  const pctBefore = Math.min(100, (before / target) * 100);
  const pctMine = Math.min(100 - pctBefore, (mine / target) * 100);

  return (
    <div className="mt-1.5">
      <div className="relative h-2 overflow-hidden rounded-full bg-secondary">
        {/*
          **濃さの意味を、画面のどこでも同じにする。**
          墨は「食べた」。ここまでに食べたぶんも、いま押したぶんも、どちらも食べている。
          いま押したぶんだけ茜にするのは、**変わったところ**を指すため（差し色はこれ1色）。
        */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground"
          style={{ width: pctBefore + '%' }}
        />
        <div
          className={cn('absolute inset-y-0 rounded-full bg-primary', animate && 'pf-eat-grow')}
          style={{ left: pctBefore + '%', width: pctMine + '%' }}
        />
      </div>
      {/*
        **合計の数字は書かない。**下の「目標」の欄が同じ数字を出しているので、
        ここに並べると同じことを2か所で言うことになる（D-142 と同じ轍）。
        この行が答えるのは「いま押したぶんはどれだけか」だけ。
        1日のどこを埋めたのかは、帯の濃いところが示す。
      */}
      <div className="mt-1 text-xs tabular-nums text-muted-foreground">
        {dayWord}の目標に +{Math.round(mine)} kcal
      </div>
    </div>
  );
}

/**
 * 1日の流れ。起床・就寝・予定から組んだ時刻の上に、**その枠の献立が乗る。**
 *
 * 以前は流れと献立が別々の枠に分かれていて、「この料理は何時に食べるのか」は
 * 2つを見比べないと分からなかった。しかも「朝食」という言葉が画面に2回出ていた
 * （片方は時刻だけ、もう片方は料理だけ）。
 *
 * 起きてから寝るまでを上から1回読めば済むようにする。
 * 目に入るのは**次にやること1つ**。それ以外は薄く並べるだけ。
 */
function TimelineCard({
  date,
  isToday,
  settings,
  habits,
  events,
  cookMinutes,
  meals,
  assignments,
  recipes,
  profiles,
  manyPeople,
  dayTotals,
  dayWord,
  onUndo,
}: {
  date: string;
  isToday: boolean;
  settings: AppSettings;
  habits: Habit[];
  events: CalendarBlock[];
  cookMinutes: number;
  meals: PlannedMeal[];
  assignments: ContainerAssignment[];
  recipes: Map<string, Recipe>;
  profiles: Profile[];
  manyPeople: boolean;
  /** 人ごとの、その日の合計と目標 */
  dayTotals: Map<string, { eaten: number; target: number }>;
  dayWord: string;
  onUndo: (label: string, undo: () => Promise<void>) => void;
}) {
  const weekday = new Date(date + 'T00:00:00').getDay() as Weekday;
  const timeline = buildTimeline({
    rhythm: settings.rhythm,
    habits,
    weekday,
    coverSlots: settings.cooking.coverSlots,
    events,
    ...(cookMinutes > 0 ? { cookMinutes } : {}),
  });
  if (timeline.length === 0) return null;

  // 枠ごとに分ける。2人以上いると、同じ枠に人数ぶんの食事が入る
  const bySlot = new Map<MealSlot, PlannedMeal[]>();
  for (const m of meals) {
    const list = bySlot.get(m.slot);
    if (list) list.push(m);
    else bySlot.set(m.slot, [m]);
  }
  // 流れに枠が無いもの（間食など）。捨てずに末尾へ回す
  const inFlow = new Set(timeline.map((e) => e.slot).filter(Boolean) as MealSlot[]);
  const extraSlots = [...bySlot.keys()].filter((sl) => !inFlow.has(sl));

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // 「次」は今日だけの話。ほかの日には、いま何時かは関係がない
  const nextIdx = isToday ? timeline.findIndex((e) => toMin(e.time) >= nowMin) : -1;

  const nameOf = (m: PlannedMeal) =>
    manyPeople ? (profiles.find((p) => p.id === m.profileId)?.name ?? '') : '';

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <span className="text-xs text-muted-foreground">
          {isToday ? '今日の流れ' : 'この日の流れ'}
        </span>
        <Link
          to="/rhythm"
          className="-mr-2 flex min-h-11 items-center px-2 text-xs underline underline-offset-2"
        >
          変更
        </Link>
      </div>

      <div className="space-y-1">
        {timeline.map((e, i) => {
          const isNext = i === nextIdx;
          const dishes = e.slot ? (bySlot.get(e.slot) ?? []) : [];
          /*
            過ぎた行は薄くする。ただし**まだ食べていない食事は薄くしない**——
            そこがいちばん、いま手を動かす場所だから。
          */
          const pending = dishes.some((m) => m.status !== 'eaten' && m.status !== 'skipped');
          const past = isToday && (nextIdx === -1 || i < nextIdx) && !pending;

          return (
            <div
              key={i}
              className={cn(
                'flex gap-2.5 rounded-md px-1.5 py-1.5',
                // 献立の絵と食材の色が入るので、行ごと反転はさせない。
                // 目印は時刻の丸と地の色。それでも「次」は一目で分かる
                isNext && 'bg-secondary',
                past && 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'w-11 shrink-0 rounded py-0.5 text-center text-xs font-medium tabular-nums',
                  isNext && 'bg-foreground text-background',
                )}
              >
                {e.time}
              </span>

              <div className="min-w-0 flex-1">
                <div className={cn('text-sm', (isNext || dishes.length > 0) && 'font-semibold')}>
                  {e.label}
                  {e.endTime ? <span className="ml-1 text-xs opacity-70">〜{e.endTime}</span> : null}
                </div>

                {/* 補足は「次」の行だけ。全部に出すと、流れが文章になって読めなくなる */}
                {isNext && e.note ? (
                  <div className="text-xs leading-relaxed text-muted-foreground">{e.note}</div>
                ) : null}

                {dishes.length > 0 && (
                  <div className="mt-1 space-y-2">
                    {dishes.map((m) => (
                      <MealBody
                        key={m.id}
                        meal={m}
                        assignments={assignments}
                        recipes={recipes}
                        onUndo={onUndo}
                        dayWord={dayWord}
                        {...(dayTotals.get(m.profileId)
                          ? { total: dayTotals.get(m.profileId)! }
                          : {})}
                        {...(nameOf(m) ? { who: nameOf(m) } : {})}
                      />
                    ))}
                  </div>
                )}

                {/* 流れにある枠なのに献立が無い日は、ここが空になる。何も足さない */}
              </div>
            </div>
          );
        })}

        {/* 間食など、時刻の決まっていない枠。流れの下にまとめる */}
        {extraSlots.map((sl) => (
          <div key={sl} className="flex gap-2.5 rounded-md px-1.5 py-1.5">
            <span className="w-11 shrink-0 py-0.5 text-center text-xs text-muted-foreground">—</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{MEAL_SLOT_LABELS[sl]}</div>
              <div className="mt-1 space-y-2">
                {(bySlot.get(sl) ?? []).map((m) => (
                  <MealBody
                    key={m.id}
                    meal={m}
                    assignments={assignments}
                    recipes={recipes}
                    onUndo={onUndo}
                    dayWord={dayWord}
                    {...(dayTotals.get(m.profileId)
                      ? { total: dayTotals.get(m.profileId)! }
                      : {})}
                    {...(nameOf(m) ? { who: nameOf(m) } : {})}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * その人の、今日の摂取。
 *
 * **食べたぶんだけを描く。**以前は献立に載っているだけのぶんも薄い帯で重ね、
 * 見出しに「残り○○kcalぶんが献立にあります」と添えていた。やめた理由は2つ。
 *
 *   数が合わなかった … 消した人の食事まで足していたので、画面に1食しか
 *     出ていないのに2食ぶんの数字が出ていた（本人指摘）。数える範囲は上でそろえた。
 *
 *   読む意味が無かった … 「献立にあります」の献立がどこを指すのか一通りに読めない。
 *     しかも**残っている食事は、すぐ上の流れに料理名と時刻つきで並んでいる。**
 *     同じことを、より曖昧な言い方で2回言っていた。
 */
function TargetCard({ profile, eaten }: { profile: Profile; eaten: Macros }) {
  const t = profile.baseTargets;
  const rows = [
    { label: 'kcal', a: eaten.kcal, t: t.kcal },
    { label: 'P', a: eaten.proteinG, t: t.proteinG },
    { label: 'F', a: eaten.fatG, t: t.fatG },
    { label: 'C', a: eaten.carbG, t: t.carbG },
  ];

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{profile.name} が今日 食べたぶん</span>
        <Link
          to="/settings"
          className="-mr-2 flex min-h-11 shrink-0 items-center px-2 text-xs underline underline-offset-2"
        >
          変更
        </Link>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-8 shrink-0 text-xs text-muted-foreground">{r.label}</span>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
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
