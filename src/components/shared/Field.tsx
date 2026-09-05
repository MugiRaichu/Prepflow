import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** ラベル + 入力 + 補足の縦積み。設定画面の基本単位 */
export function Field({
  label,
  hint,
  children,
  className,
  inline = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
  /** スイッチなど、ラベルと入力を横並びにする */
  inline?: boolean;
}) {
  return (
    <div
      className={cn(
        inline ? 'flex items-center justify-between gap-4' : 'flex flex-col gap-1.5',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** 数値入力。空文字は undefined として扱う */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  className,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {suffix && <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}
