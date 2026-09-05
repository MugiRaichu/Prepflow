import { WEEKDAY_LABELS } from '@/lib/labels';
import type { Weekday } from '@/db/schema';
import { cn } from '@/lib/utils';

const ALL: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

function dayClass(active: boolean) {
  return cn(
    'size-10 rounded-full border text-sm',
    active
      ? 'border-foreground bg-foreground font-semibold text-background pf-pop'
      : 'border-border text-muted-foreground',
  );
}

/** 曜日を丸ボタンで選ぶ。単一選択 */
export function WeekdayPicker({
  value,
  onChange,
  className,
}: {
  value: Weekday;
  onChange: (v: Weekday) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1.5', className)}>
      {ALL.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          aria-pressed={d === value}
          className={dayClass(d === value)}
        >
          {WEEKDAY_LABELS[d]}
        </button>
      ))}
    </div>
  );
}

/** 複数選択版。作り置きをする曜日など */
export function WeekdayMultiPicker({
  values,
  onChange,
  className,
}: {
  values: Weekday[];
  onChange: (v: Weekday[]) => void;
  className?: string;
}) {
  const toggle = (d: Weekday) =>
    onChange(values.includes(d) ? values.filter((x) => x !== d) : [...values, d].sort());

  return (
    <div className={cn('flex gap-1.5', className)}>
      {ALL.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => toggle(d)}
          aria-pressed={values.includes(d)}
          className={dayClass(values.includes(d))}
        >
          {WEEKDAY_LABELS[d]}
        </button>
      ))}
    </div>
  );
}
