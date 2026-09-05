import type { ScheduleResult } from './logic/types';
import { cn } from '@/lib/utils';

/**
 * 段取りの全体像。
 *
 * 以前は本物のガントチャート（レーン・全タスクの帯・凡例3種）を描いていたが、
 * スマホ幅では文字が潰れて読めず、読み取れる情報より認知負荷のほうが大きかった。
 *
 * この画面で本当に要る情報は1つだけ ——「いつ手が空くか」。
 * それに絞り、1本のバーと時刻順のリストで表す。個々の手順の詳細は
 * 実行中の「次にやること」カードが受け持つので、ここで重ねて出さない。
 */

const fmt = (sec: number) => Math.round(sec / 60) + '分';

/** 人が手を動かしていない区間 */
function freeWindows(result: ScheduleResult): { start: number; end: number }[] {
  const busy = result.tasks
    .filter((t) => t.handsOnSec > 0)
    .map((t) => ({ start: t.startSec, end: t.startSec + t.handsOnSec }))
    .sort((a, b) => a.start - b.start);

  // 重なりをつぶす
  const merged: { start: number; end: number }[] = [];
  for (const b of busy) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }

  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const m of merged) {
    if (m.start > cursor) gaps.push({ start: cursor, end: m.start });
    cursor = Math.max(cursor, m.end);
  }
  if (cursor < result.makespanSec) gaps.push({ start: cursor, end: result.makespanSec });

  // 1分未満の隙間は「空き」と呼べない
  return gaps.filter((g) => g.end - g.start >= 60);
}

export function CookTimeline({ result }: { result: ScheduleResult }) {
  const total = Math.max(result.makespanSec, 1);
  const gaps = freeWindows(result);
  const longest = gaps.reduce<{ start: number; end: number } | null>(
    (m, g) => (!m || g.end - g.start > m.end - m.start ? g : m),
    null,
  );

  return (
    <div className="space-y-4">
      {/* 1本のバー。濃い部分が手を動かす時間 */}
      <div>
        <div className="relative h-6 overflow-hidden rounded-md bg-secondary">
          {result.tasks
            .filter((t) => t.handsOnSec > 0)
            .map((t) => (
              <div
                key={t.id}
                className="absolute inset-y-0 bg-foreground"
                style={{
                  left: (t.startSec / total) * 100 + '%',
                  width: Math.max((t.handsOnSec / total) * 100, 0.8) + '%',
                }}
              />
            ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>開始</span>
          <span>{fmt(total)}後に完了</span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          埋まっているところが手を動かす時間です。
        </p>
      </div>

      {longest && longest.end - longest.start >= 300 && (
        <div className="rounded-md border p-3 text-xs leading-relaxed">
          開始{fmt(longest.start)}後から{fmt(longest.end - longest.start)}、手が空きます。
        </div>
      )}

      {/* 時刻順の手順リスト。表よりこちらのほうが追いやすい */}
      <div className="overflow-hidden rounded-md border">
        {result.tasks.map((t, i) => (
          <div key={t.id} className={cn('flex gap-3 px-3 py-2', i > 0 && 'border-t')}>
            <span className="w-10 shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground">
              {Math.round(t.startSec / 60)}分
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs leading-snug">{t.label}</div>
              <div className="text-[10px] text-muted-foreground">
                {t.recipeTitle}
                {t.equipmentName ? ' ・ ' + t.equipmentName : ''}
                {t.handsOnSec === 0 ? ' ・ 放置' : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {result.bottlenecks.length > 0 && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {result.bottlenecks[0]!.equipmentName}の空き待ちが{' '}
          {fmt(result.bottlenecks[0]!.waitedSec)} あります。増やせばその分だけ縮みます。
        </p>
      )}
    </div>
  );
}
