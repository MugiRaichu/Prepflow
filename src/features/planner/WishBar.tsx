import { useState } from 'react';
import { ChevronDown, Minus, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CookingMode } from '@/db/schema';
import type { WeekRequest } from './logic/request';

/**
 * 食材の希望に使うタグ。
 *
 * 「食べたい」と「避けたい」で**同じ並び**にしてある。
 * 以前は食べたい側に鶏肉があるのに避けたい側には無い、という非対称な並びで、
 * 「無いものは指定できないのか、指定する必要がないのか」が読み取れなかった。
 */
const FOOD_TAGS = [
  '鶏肉',
  '豚肉',
  '牛肉',
  '魚',
  '洋食',
  '中華',
  'カレー',
  '麺',
] as const;

/** 指定した食材を主菜に入れる既定の日数 */
const DEFAULT_WANT_MEALS = 2;

/**
 * 調理時間の選択肢。作り方で意味が変わるので数字も変える。
 *
 * まとめて作る人の45分と、毎日作る人の45分はまったく別物。
 * 毎日作る人にとっての時短は「1日10分」であって、
 * ここに45分を出すのは時短の名前で時短でないものを出すことになる。
 */
const TIME_BANDS: Record<'daily' | 'batch', number[]> = {
  daily: [10, 15, 20, 30, 45],
  batch: [20, 30, 45, 60, 90],
};

const timeBandsFor = (mode: CookingMode) => (mode === 'daily' ? TIME_BANDS.daily : TIME_BANDS.batch);

const timeUnitLabel = (mode: CookingMode) =>
  mode === 'daily' ? '1日に手を動かす時間' : 'まとめて作る1回で手を動かす時間';

/**
 * 今週の気分を入れる場所。
 *
 * 既定では畳んでおく。ほとんどの週に希望は無く、
 * 常に選択肢を並べること自体が判断を強いる摩擦になる（D-015）。
 * 希望があるときだけ1タップで開く。
 */
export function WishBar({
  value,
  onChange,
  mode,
  extra,
}: {
  value: WeekRequest;
  onChange: (v: WeekRequest) => void;
  mode: CookingMode;
  /**
   * 一緒に畳んでおくもの（料理の指名）。
   * **入口を2つに分けない。**「希望」と「指名」で別々の枠を出すと、
   * どちらに何を入れるのか考えることになる（本人指摘）。
   */
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wantOf = (tag: string) => value.wants.find((w) => w.tag === tag);

  const toggleWant = (tag: string) => {
    const has = wantOf(tag);
    onChange({
      ...value,
      wants: has
        ? value.wants.filter((w) => w.tag !== tag)
        : [...value.wants, { tag, meals: DEFAULT_WANT_MEALS }],
      // 「食べたい」と「避けたい」は同時に立てない
      avoidTags: value.avoidTags.filter((t) => t !== tag),
    });
  };

  const setMeals = (tag: string, meals: number) =>
    onChange({
      ...value,
      wants: value.wants.map((w) => (w.tag === tag ? { ...w, meals } : w)),
    });

  const toggleAvoid = (tag: string) =>
    onChange({
      ...value,
      avoidTags: value.avoidTags.includes(tag)
        ? value.avoidTags.filter((t) => t !== tag)
        : [...value.avoidTags, tag],
      wants: value.wants.filter((w) => w.tag !== tag),
    });

  const setCap = (min: number | undefined) =>
    onChange({ ...value, ...(min ? { timeCapMinutes: min } : { timeCapMinutes: undefined }) });

  const cap = value.timeCapMinutes;
  // 「9分なら組めます」を受け入れると、選択肢に無い値が入る。
  // どれも光っていない状態にすると、指定が消えたように見えるので並びに足す
  const bands = timeBandsFor(mode);
  const shown = cap != null && !bands.includes(cap) ? [...bands, cap].sort((a, b) => a - b) : bands;
  const active = value.wants.length > 0 || value.avoidTags.length > 0 || cap != null;

  const summary = [
    ...value.wants.map((w) => w.tag + ' ' + w.meals + '日'),
    ...value.avoidTags.map((t) => t + 'なし'),
    ...(cap != null ? [(mode === 'daily' ? '1日' : 'まとめて') + cap + '分まで'] : []),
  ].join('・');

  // 閉じているとき: 1行だけ。押すと開く
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg border px-4 text-left active:bg-accent"
      >
        <span className="flex-1 text-xs text-muted-foreground">
          {active ? summary : '今週の食べたいもの・避けたいもの（任意）'}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-baseline justify-between">
        <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground">
          今週の食べたいもの・避けたいもの
        </button>
        {active && (
          <button
            onClick={() => onChange({ wants: [], avoidTags: [] })}
            className="flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <X className="size-3" />
            クリア
          </button>
        )}
      </div>

      <TagRow
        label="食べたい"
        isOn={(t) => Boolean(wantOf(t))}
        onTap={toggleWant}
      />

      {value.wants.map((w) => (
        <div key={w.tag} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs">{w.tag}</span>
          <button
            onClick={() => setMeals(w.tag, Math.max(w.meals - 1, 1))}
            className="flex size-9 items-center justify-center rounded-md border active:scale-95"
            aria-label="減らす"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="w-12 text-center text-sm font-semibold tabular-nums">{w.meals} 日</span>
          <button
            onClick={() => setMeals(w.tag, Math.min(w.meals + 1, 7))}
            className="flex size-9 items-center justify-center rounded-md border active:scale-95"
            aria-label="増やす"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      ))}

      <TagRow
        label="避けたい"
        isOn={(t) => value.avoidTags.includes(t)}
        onTap={toggleAvoid}
      />

      {/* 料理そのものの指名。ジャンルの指定と同じ枠に置く */}
      {extra}

      <div className="space-y-1.5">
        <div className="text-[10px] text-muted-foreground">{timeUnitLabel(mode)}</div>
        <div className="flex flex-wrap gap-2">
          <Chip on={cap == null} onClick={() => setCap(undefined)}>
            指定なし
          </Chip>
          {shown.map((m) => (
            <Chip key={m} on={cap === m} onClick={() => setCap(m)}>
              {m}分まで
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

function TagRow({
  label,
  isOn,
  onTap,
}: {
  label: string;
  isOn: (tag: string) => boolean;
  onTap: (tag: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {FOOD_TAGS.map((t) => (
          <Chip key={label + t} on={isOn(t)} onClick={() => onTap(t)}>
            {t}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'min-h-10 rounded-md border px-3 text-sm active:scale-[0.98]',
        on ? 'border-foreground bg-foreground font-medium text-background' : 'border-border',
      )}
    >
      {children}
    </button>
  );
}
