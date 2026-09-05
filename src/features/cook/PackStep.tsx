import { useLiveQuery } from 'dexie-react-hooks';
import { Check } from 'lucide-react';
import { db, nowIso } from '@/db/db';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDateJa, MEAL_SLOT_LABELS } from '@/lib/labels';
import type { ContainerAssignment } from '@/db/schema';

/**
 * 詰める工程。調理が終わったあとに続けて出す。
 *
 * 専用のタブは作らない。詰めるのは調理の最後の作業であって、
 * 独立して開く画面ではないため。1枚ずつ大きく出して、
 * マスキングテープにラベル記号を書いて貼るだけで済むようにする。
 */
export function PackStep({ weekPlanId }: { weekPlanId: string }) {
  const assignments = useLiveQuery(
    async () =>
      (await db.containerAssignments.where('weekPlanId').equals(weekPlanId).toArray())
        .filter((a) => a.deleted === 0)
        .sort((a, b) => a.containerLabel.localeCompare(b.containerLabel, 'ja', { numeric: true })),
    [weekPlanId],
  );

  if (!assignments) return null;

  const todo = assignments.filter((a) => a.packed === 0);
  const next = todo[0];

  if (!next) {
    // 行き先は容器ごとに違う。冷蔵で持たない日ぶんは冷凍に回してある（generate.ts）。
    // 全部「冷蔵庫へ」と言うと、4日目以降のぶんを冷蔵に入れて傷ませることになる
    const fridge = assignments.filter((a) => a.storage === 'fridge').length;
    const freezer = assignments.length - fridge;
    const where =
      freezer === 0
        ? '冷蔵庫へ ' + fridge + '食ぶん。'
        : fridge === 0
          ? '冷凍庫へ ' + freezer + '食ぶん。'
          : '冷蔵庫へ ' + fridge + '食ぶん、冷凍庫へ ' + freezer + '食ぶん。';
    return (
      <EmptyState
        title="全部詰め終わりました"
        description={
          where + (freezer > 0 ? ' 冷凍したぶんは、食べる前日に冷蔵へ移してください。' : '')
        }
      />
    );
  }

  const pack = async (a: ContainerAssignment) => {
    await db.containerAssignments.put({
      ...a,
      packed: 1,
      cookedAt: a.cookedAt ?? nowIso(),
      updatedAt: nowIso(),
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">容器に詰める</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          残り {todo.length} / {assignments.length}
        </span>
      </div>

      <div className="pf-rise space-y-4 rounded-lg border-2 border-foreground p-5">
        <div className="flex items-baseline gap-3">
          <span className="rounded border px-2 py-1 font-mono text-2xl font-bold">
            {next.containerLabel}
          </span>
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <div>{formatDateJa(next.intendedDate)}</div>
            <div>
              {MEAL_SLOT_LABELS[next.intendedSlot]}・{next.profileName}
            </div>
          </div>
        </div>

        <p className="text-lg font-semibold leading-snug">{next.recipeTitle}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{Math.round(next.grams)} g</span>
          <span>{Math.round(next.nutrition.kcal)} kcal</span>
          <span>P {Math.round(next.nutrition.proteinG)}g</span>
          <span>{next.storage === 'freezer' ? '冷凍' : '冷蔵'}</span>
        </div>

        {next.storage === 'freezer' && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            冷凍します。食べる前日に冷蔵へ移してください。
          </p>
        )}

        <button
          onClick={() => pack(next)}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-base font-semibold text-background"
        >
          <Check className="size-5" />
          詰めた
        </button>
      </div>

      {todo.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {todo.slice(1, 12).map((a) => (
            <span
              key={a.id}
              className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {a.containerLabel}
            </span>
          ))}
          {todo.length > 12 && (
            <span className="px-1 text-[10px] text-muted-foreground">ほか{todo.length - 12}</span>
          )}
        </div>
      )}
    </div>
  );
}
