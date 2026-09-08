import { db, nowIso } from '@/db/db';
import { addDaysIso, todayIso } from '@/lib/labels';
import type { ContainerAssignment, PlannedMeal } from '@/db/schema';

/**
 * 食べられなかった食事の始末。
 *
 * 急な会食、体調、予定変更——食べない日は必ずある。
 * **食べていないものを食べたことにすると、摂取カロリーの集計が狂う。**
 * 翌週の補正まで狂うので、ここは厳密に扱う。
 *
 * かといって理由を書かせない。押すだけで、食べ物と数字の両方が正しくなる形にする。
 *
 *   freeze … 冷凍して先に回す（食べ物は残る。期限を引き直す）
 *   tomorrow … 明日に食べる（日付をずらす。食べ物も数字も1日後へ）
 *   discard … 捨てた（食べ物は無くなる。摂取には数えない）
 *
 * 同居人が食べた、という4つ目は世帯モデルができてから足す。
 * いま出しても付け替える先が無い。
 */
export type MissedAction = 'freeze' | 'tomorrow' | 'discard';

/** 元に戻すために、触る前の姿をまとめて持っておく */
export interface MissedUndo {
  meal: PlannedMeal;
  containers: ContainerAssignment[];
}

/** 冷凍したものが持つ日数。作った日からではなく、冷凍した日から数える */
const FREEZER_DAYS = 30;

async function containersOf(meal: PlannedMeal): Promise<ContainerAssignment[]> {
  const ids = meal.items
    .map((i) => i.containerAssignmentId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  return (await db.containerAssignments.bulkGet(ids)).filter(
    (c): c is ContainerAssignment => Boolean(c),
  );
}

/**
 * 食べた・食べていないを切り替える。
 *
 * **押した本人が、押したことに気づける形にする。**画面側では、押した瞬間に
 * その食事がカロリーの帯に変わる。ここは数字を正しくするだけ。
 */
export async function setMealEaten(meal: PlannedMeal, eaten: boolean): Promise<void> {
  await db.plannedMeals.put({
    ...meal,
    status: eaten ? 'eaten' : 'planned',
    ...(eaten ? { eatenAt: nowIso() } : { eatenAt: undefined }),
    updatedAt: nowIso(),
  });
}

export async function handleMissedMeal(
  meal: PlannedMeal,
  action: MissedAction,
): Promise<MissedUndo> {
  const containers = await containersOf(meal);
  const before: MissedUndo = { meal: { ...meal }, containers: containers.map((c) => ({ ...c })) };
  const now = nowIso();
  const today = todayIso();

  if (action === 'tomorrow') {
    const next = addDaysIso(meal.date, 1);
    await db.plannedMeals.put({ ...meal, date: next, updatedAt: now });
    for (const c of containers) {
      await db.containerAssignments.put({ ...c, intendedDate: next, updatedAt: now });
    }
    return before;
  }

  // 食べなかったので、摂取には数えない
  await db.plannedMeals.put({ ...meal, status: 'skipped', eatenAt: undefined, updatedAt: now });

  for (const c of containers) {
    if (action === 'freeze') {
      // 食べ物は残る。冷凍した日から数え直す
      await db.containerAssignments.put({
        ...c,
        storage: 'freezer',
        keepsDays: FREEZER_DAYS,
        useByDate: addDaysIso(today, FREEZER_DAYS),
        updatedAt: now,
      });
    } else {
      // 捨てた。食べ物は無くなるが、使った金額は記録として残す
      await db.containerAssignments.put({ ...c, deleted: 1, updatedAt: now });
    }
  }

  return before;
}

/** 取り消し。触る前の姿をそのまま書き戻す */
export async function undoMissedMeal(before: MissedUndo): Promise<void> {
  const now = nowIso();
  await db.plannedMeals.put({ ...before.meal, updatedAt: now });
  for (const c of before.containers) {
    await db.containerAssignments.put({ ...c, updatedAt: now });
  }
}
