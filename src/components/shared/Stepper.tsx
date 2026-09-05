import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ＋/− で数値を変える。キーボードを出さないための部品。
 * 長押しの連続増減はあえて入れていない（誤操作で大きく動くほうが害が大きい）。
 */
export function Stepper({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  format,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  /** 表示整形。既定は toLocaleString */
  format?: (v: number) => string;
  className?: string;
}) {
  const clamp = (v: number) => {
    let n = v;
    if (min != null) n = Math.max(n, min);
    if (max != null) n = Math.min(n, max);
    // 浮動小数の誤差を丸める（0.1 刻み対策）
    return Math.round(n * 1000) / 1000;
  };

  const atMin = min != null && value <= min;
  const atMax = max != null && value >= max;

  const btn =
    'flex size-11 shrink-0 items-center justify-center rounded-md border border-border active:scale-95 disabled:opacity-30 disabled:active:scale-100';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(clamp(value - step))}
        disabled={atMin}
        aria-label="減らす"
      >
        <Minus className="size-4" />
      </button>

      <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1">
        <span className="text-xl font-semibold tabular-nums">
          {format ? format(value) : value.toLocaleString('ja-JP')}
        </span>
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>

      <button
        type="button"
        className={btn}
        onClick={() => onChange(clamp(value + step))}
        disabled={atMax}
        aria-label="増やす"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
