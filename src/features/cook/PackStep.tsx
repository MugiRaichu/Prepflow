import { useLiveQuery } from 'dexie-react-hooks';
import { Check } from 'lucide-react';
import { db, nowIso } from '@/db/db';
import { EmptyState } from '@/components/shared/EmptyState';
import { useUndoBar } from '@/components/shared/UndoBar';
import { addDaysIso, formatDateJa, MEAL_SLOT_LABELS, todayIso } from '@/lib/labels';
import type { ContainerAssignment } from '@/db/schema';

/**
 * 詰める工程。調理が終わったあとに続けて出す。
 *
 * 専用のタブは作らない。詰めるのは調理の最後の作業であって、
 * 独立して開く画面ではないため。1枚ずつ大きく出して、
 * マスキングテープにラベル記号を書いて貼るだけで済むようにする。
 */
/** 今日から何日後か。日付だけだと「あと何日あるのか」が頭の中で計算になる */
function daysFromToday(iso: string): string {
  const days = Math.round(
    (new Date(iso + 'T00:00:00').getTime() - new Date(todayIso() + 'T00:00:00').getTime()) / 86400000,
  );
  if (days <= 0) return '今日中';
  if (days === 1) return '明日まで';
  return 'あと' + days + '日';
}

export function PackStep({ weekPlanId }: { weekPlanId: string }) {
  const undo = useUndoBar();
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
    const fridge = assignments.filter((a) => a.storage === 'fridge');
    const freezer = assignments.length - fridge.length;

    // **何日置くのかを言う。**「冷蔵庫へ4食ぶん」だけでは、いつまでに
    // 食べればよいのか分からない（本人指摘）。
    // 出すのは献立上の最終日ではなく、**いちばん早く切れる期限**。
    // 品ごとに日持ちが違うので、最後の1食に合わせると先に傷むものが出る
    const lastDate = fridge
      .map((a) => a.useByDate)
      .sort()[0];

    const where =
      freezer === 0
        ? '冷蔵庫へ ' + fridge.length + '食ぶん。'
        : fridge.length === 0
          ? '冷凍庫へ ' + freezer + '食ぶん。'
          : '冷蔵庫へ ' + fridge.length + '食ぶん、冷凍庫へ ' + freezer + '食ぶん。';

    const until = lastDate
      ? ' 冷蔵のぶんは ' + formatDateJa(lastDate) + 'まで、' + daysFromToday(lastDate) + 'です。'
      : '';

    return (
      <EmptyState
        title="全部詰め終わりました"
        description={
          where + until + (freezer > 0 ? ' 冷凍したぶんは、食べる前日に冷蔵へ移してください。' : '')
        }
      />
    );
  }

  const pack = async (a: ContainerAssignment) => {
    // 期限は「作った日 + もつ日数」。献立を組んだ時点では実際にいつ作るか
    // 分からないので、詰めるこの瞬間に引き直す。
    // 週の頭から数えたままだと、2日遅れて作った週は2日ぶん短く見える
    const cookedAt = a.cookedAt ?? nowIso();
    await db.containerAssignments.put({
      ...a,
      packed: 1,
      cookedAt,
      ...(a.keepsDays ? { useByDate: addDaysIso(cookedAt.slice(0, 10), a.keepsDays) } : {}),
      updatedAt: nowIso(),
    });
  };

  return (
    <div className="space-y-3">
      {undo.bar}
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
          <span>
            {next.storage === 'freezer' ? '冷凍' : '冷蔵'}
            {next.keepsDays ? '（' + next.keepsDays + '日もちます）' : ''}
          </span>
        </div>

        {next.storage === 'freezer' && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            冷凍します。食べる前日に冷蔵へ移してください。
          </p>
        )}

        <button
          onClick={() => {
            // 押す前の行を覚えておく。詰めた印と期限を書き換えるので、
            // 戻すときは行ごと書き戻す
            const before = { ...next };
            void pack(next);
            undo.offer('容器 ' + next.containerLabel + ' を詰めました', async () => {
              await db.containerAssignments.put({ ...before, updatedAt: nowIso() });
            });
          }}
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
