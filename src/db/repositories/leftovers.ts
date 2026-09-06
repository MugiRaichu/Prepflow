import { db, newEntity, nowIso } from '@/db/db';
import { todayIso } from '@/lib/labels';
import type { ContainerAssignment, PlannedMeal } from '@/db/schema';

/**
 * 冷蔵庫・冷凍庫に残っている作り置き。
 *
 * 食べなかった日のぶん、冷凍に回したぶん、作り直しで献立から外れたぶん。
 * これらは**予定の無い食べ物**として残る。夜食に食べることもあれば、
 * 翌週まで置くこともある。
 *
 * これまで、食べても記録する手段が無かった。摂取カロリーを集計している以上、
 * 食べたのに数えないのは、食べていないのに数えるのと同じくらい困る。
 *
 * **押すのは1回。**いつ食べたかは聞かない（押した日でいい）。
 */

/**
 * いま家にある作り置き**全部**。詰めてあって、まだ食べていないもの。
 *
 * 予定が立っているものも含める。作り置きは「何をどれだけ作ってあるか」が
 * 見えないと管理できない。予定の有無は `plannedDate` で分かるようにする。
 */
export interface PreppedItem {
  container: ContainerAssignment;
  /** 食べる予定の日。予定が無ければ null（在庫として残っている） */
  plannedDate: string | null;
}

export async function listPrepped(): Promise<PreppedItem[]> {
  const all = (await db.containerAssignments.toArray()).filter(
    (c) => c.deleted === 0 && c.packed === 1 && !c.consumedAt,
  );
  if (all.length === 0) return [];

  const meals = await db.plannedMeals.toArray();
  const today = todayIso();
  const planned = new Map<string, string>();
  for (const m of meals) {
    if (m.deleted === 1 || m.status === 'skipped' || m.date < today) continue;
    for (const it of m.items) {
      if (it.containerAssignmentId) planned.set(it.containerAssignmentId, m.date);
    }
  }

  return all
    .map((c) => ({ container: c, plannedDate: planned.get(c.id) ?? null }))
    .sort(
      (a, b) =>
        a.container.useByDate.localeCompare(b.container.useByDate) ||
        a.container.containerLabel.localeCompare(b.container.containerLabel, 'ja', {
          numeric: true,
        }),
    );
}

/** 予定の無い作り置き。詰めてあって、まだ食べていないもの */
export async function listLeftovers(): Promise<ContainerAssignment[]> {
  const all = (await db.containerAssignments.toArray()).filter(
    (c) => c.deleted === 0 && c.packed === 1 && !c.consumedAt,
  );
  if (all.length === 0) return [];

  // これから食べる予定が立っているものは「残り」ではない
  const meals = await db.plannedMeals.toArray();
  const today = todayIso();
  const planned = new Set<string>();
  for (const m of meals) {
    if (m.deleted === 1) continue;
    // 食べない、と決めた食事の容器は予定から外れて「残り」になる
    if (m.status === 'skipped') continue;
    if (m.date < today) continue;
    for (const it of m.items) if (it.containerAssignmentId) planned.add(it.containerAssignmentId);
  }

  return all
    .filter((c) => !planned.has(c.id))
    .sort((a, b) => a.useByDate.localeCompare(b.useByDate));
}

/**
 * 残りものを食べた。
 *
 * 押した日の「間食」として記録する。摂取に入り、容器は消える。
 * 献立の食事とは別枠にするのは、その日の献立を食べたかどうかと
 * 混ざらないようにするため。
 */
export async function eatLeftover(c: ContainerAssignment): Promise<PlannedMeal> {
  const now = nowIso();
  const meal: PlannedMeal = {
    ...newEntity(),
    weekPlanId: c.weekPlanId,
    profileId: c.profileId,
    date: todayIso(),
    slot: 'snack',
    items: [
      {
        recipeId: c.recipeId,
        recipeTitle: c.recipeTitle,
        grams: c.grams,
        containerAssignmentId: c.id,
      },
    ],
    nutrition: { ...c.nutrition },
    status: 'eaten',
    eatenAt: now,
    // 献立ではなく食べた記録。今日の食事の欄には出さない
    source: 'leftover',
    note: '残っていたぶん',
  };

  await db.plannedMeals.add(meal);
  await db.containerAssignments.put({ ...c, consumedAt: now, updatedAt: now });
  return meal;
}

/** 取り消し。記録した食事を消して、容器を戻す */
export async function undoEatLeftover(
  meal: PlannedMeal,
  before: ContainerAssignment,
): Promise<void> {
  await db.plannedMeals.delete(meal.id);
  await db.containerAssignments.put({ ...before, updatedAt: nowIso() });
}
