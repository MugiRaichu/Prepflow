import { cn } from '@/lib/utils';

export interface ChipOption<T> {
  value: T;
  label: string;
  /** 補足。1〜2語まで。長いと選ぶのが遅くなる */
  hint?: string;
}

function chipClass(active: boolean) {
  return cn(
    // 指で押す前提の最小高さ
    'min-h-11 rounded-md border px-3 py-2 text-sm',
    active
      ? 'border-foreground bg-foreground text-background font-medium pf-pop'
      : 'border-border text-foreground hover:bg-accent',
  );
}

function hintClass(active: boolean) {
  return cn(
    'block text-xs leading-tight',
    active ? 'text-background/70' : 'text-muted-foreground',
  );
}

function gridStyle(columns?: number) {
  return columns
    ? { gridTemplateColumns: 'repeat(' + columns + ', minmax(0,1fr))' }
    : undefined;
}

/**
 * プリセットをタップで選ぶ。設定画面の数値入力はまずこれを使う。
 * 自由入力は「その他」の逃げ道としてのみ許す。
 */
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  columns,
  className,
}: {
  options: ChipOption<T>[];
  value: T | undefined;
  onChange: (v: T) => void;
  /** 1行に並べる数。未指定なら折り返し */
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('gap-2', columns ? 'grid' : 'flex flex-wrap', className)}
      style={gridStyle(columns)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            aria-label={o.label}
            className={chipClass(active)}
          >
            <span className="block leading-tight">{o.label}</span>
            {o.hint && <span className={hintClass(active)}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 複数選択版。アレルゲンや食事枠の指定に使う。
 *
 * onToggle は「押された項目」だけを返す。onChange は描画時点の配列から
 * 新しい配列を作るため、続けて2つ押すと2つ目が1つ目を打ち消す。
 * 保存先が非同期（IndexedDB）の場合は onToggle を使うこと。
 */
export function MultiChips<T extends string | number>({
  options,
  values,
  onChange,
  onToggle,
  columns,
  className,
}: {
  options: ChipOption<T>[];
  values: T[];
  onChange?: (v: T[]) => void;
  onToggle?: (v: T) => void;
  columns?: number;
  className?: string;
}) {
  const toggle = (v: T) => {
    if (onToggle) return onToggle(v);
    onChange?.(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };

  return (
    <div
      className={cn('gap-2', columns ? 'grid' : 'flex flex-wrap', className)}
      style={gridStyle(columns)}
    >
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => toggle(o.value)}
            aria-pressed={active}
            aria-label={o.label}
            className={chipClass(active)}
          >
            <span className="block leading-tight">{o.label}</span>
            {o.hint && <span className={hintClass(active)}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
