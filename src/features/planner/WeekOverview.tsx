import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { DishImage } from '@/features/recipes/DishImage';
import { addDaysIso, formatDateJa, MEAL_SLOT_LABELS, todayIso, yen } from '@/lib/labels';
import type { MealSlot, PlannedMeal, Recipe } from '@/db/schema';
import { cn } from '@/lib/utils';

/** 表示順。朝→昼→夕→間食 */
const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };

/**
 * 1週間の献立を俯瞰する。
 *
 * 献立の画面は「作る」ための場所で、1案ずつ深く見せる。
 * こちらは**全体を一度に見る**ための場所。何曜日が重いか、同じ料理が
 * どれくらい続くか、どこまで食べたかは、並べて初めて分かる。
 *
 * 1画面に7日を入れるため、1食1行に畳む。詳しい栄養は日付を押して今日の画面へ。
 */
export function WeekOverview() {
  const today = todayIso();

  const plan = useLiveQuery(
    async () => (await db.weekPlans.where('deleted').equals(0).reverse().sortBy('weekStart'))[0],
    [],
  );
  const meals = useLiveQuery(
    async () =>
      plan ? await db.plannedMeals.where('weekPlanId').equals(plan.id).toArray() : [],
    [plan?.id],
  );
  const recipes = useLiveQuery(() => db.recipes.where('deleted').equals(0).toArray(), []);

  if (!plan || !meals || !recipes) {
    return (
      <div>
        <PageHeader title="1週間の献立" backTo="/plan" />
        <div className="p-4">
          <EmptyState
            title="献立がありません"
            description="献立を作ると、1週間ぶんがここに並びます。"
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

  const byRecipe = new Map<string, Recipe>(recipes.map((r) => [r.id, r]));

  // 献立として組んだものだけ。あとから食べた記録は俯瞰の邪魔になる
  const planned = meals.filter((m) => m.source !== 'leftover' && m.deleted === 0);
  const dates = [...new Set(planned.map((m) => m.date))].sort();

  const ofDate = (d: string): PlannedMeal[] =>
    planned.filter((m) => m.date === d).sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);

  // 同じ料理が週に何食出るか。俯瞰でいちばん知りたいのはここ
  const times = new Map<string, number>();
  for (const m of planned) {
    for (const it of m.items) times.set(it.recipeTitle, (times.get(it.recipeTitle) ?? 0) + 1);
  }
  const repeated = [...times.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);

  const eaten = planned.filter((m) => m.status === 'eaten').length;

  return (
    <div className="pb-8">
      <PageHeader title="1週間の献立" backTo="/plan" />

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="食数" value={eaten + ' / ' + planned.length} />
          <Stat label="見込み" value={yen(plan.estimatedCostYen)} />
          <Stat label="品数" value={times.size + ' 品'} />
        </div>

        {dates.map((d) => {
          const day = ofDate(d);
          const isToday = d === today;
          const past = d < today;
          return (
            <div key={d} className={cn('rounded-lg border', isToday && 'border-foreground')}>
              <div className="flex items-baseline justify-between border-b px-3 py-2">
                <span className={cn('text-xs', isToday ? 'font-semibold' : 'text-muted-foreground')}>
                  {formatDateJa(d)}
                  {isToday && ' ・今日'}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(day.reduce((n, m) => n + m.nutrition.kcal, 0))} kcal
                </span>
              </div>

              <div className="divide-y">
                {day.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-6 shrink-0 text-[10px] text-muted-foreground">
                      {MEAL_SLOT_LABELS[m.slot]}
                    </span>
                    <div className="flex shrink-0 -space-x-1">
                      {m.items.slice(0, 3).map((it, i) => {
                        const r = byRecipe.get(it.recipeId);
                        return r ? (
                          <DishImage key={i} recipe={r} className="size-7 bg-background" />
                        ) : null;
                      })}
                    </div>
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-xs',
                        m.status === 'eaten' && 'text-muted-foreground line-through',
                        m.status === 'skipped' && 'text-muted-foreground',
                      )}
                    >
                      {m.items.map((i) => i.recipeTitle).join(' + ')}
                    </span>
                    {m.status === 'skipped' && (
                      <span className="shrink-0 text-[9px] text-muted-foreground">食べていない</span>
                    )}
                    {m.status === 'eaten' && (
                      <span className="shrink-0 text-[9px] text-muted-foreground">食べた</span>
                    )}
                  </div>
                ))}
                {day.length === 0 && (
                  <div className="px-3 py-2 text-[10px] text-muted-foreground">
                    {past ? '記録がありません' : '予定がありません'}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* 俯瞰でいちばん知りたいのは「同じものが何回出るか」。並べないと分からない */}
        {repeated.length > 0 && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <div className="text-[10px] text-muted-foreground">週に2回以上出る料理</div>
            {repeated.map(([title, n]) => (
              <div key={title} className="flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{title}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{n} 食</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[10px] text-muted-foreground">
          {formatDateJa(plan.weekStart)} から {dates.length} 日ぶん・
          {formatDateJa(addDaysIso(plan.weekStart, dates.length - 1))} まで
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
