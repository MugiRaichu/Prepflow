import { cn } from '@/lib/utils';

/**
 * 2〜4択の切替。ドロップダウンを使わないための部品
 * （ドロップダウンは開く・選ぶ・閉じるで3動作かかる）。
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn('grid gap-1 rounded-lg border border-border p-1', className)}
      style={{ gridTemplateColumns: 'repeat(' + options.length + ', minmax(0,1fr))' }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-9 rounded-md px-2 text-sm transition-colors',
              active ? 'bg-foreground font-medium text-background' : 'text-muted-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
