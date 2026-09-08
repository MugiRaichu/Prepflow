import { useCallback, useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ＋/− で数値を変える。キーボードを出さないための部品。
 *
 * **押しっぱなしで続けて動く。**体重を 65kg から 52kg へ動かすのに、
 * 0.5きざみで26回叩かせていた（本人指摘）。年齢も身長も同じ。
 *
 * 一度は「誤操作で大きく動くほうが害が大きい」として入れていなかったが、
 * 逆だった。**連打のほうが誤操作を生む**——狙った数を通り過ぎ、
 * 戻すのにまた連打することになる。
 *
 * 事故を防ぐのは、長押しを避けることではなく効きかたのほうで作る。
 *
 *   ・押してすぐは動かない（420ms）。触れただけでは走り出さない
 *   ・走り出しはゆっくり（260ms間隔）で、押し続けるほど速くなる（最短60ms）
 *   ・指を離した瞬間に止まる。上限・下限でも止まる
 *
 * 狙った数の手前で離せば止まるので、行き過ぎても1〜2回で戻せる。
 */
const HOLD_DELAY_MS = 420;
const FIRST_INTERVAL_MS = 260;
const MIN_INTERVAL_MS = 60;
/** 1回ごとに間隔を縮める率。0.82 だと約1.5秒で最速に届く */
const SPEEDUP = 0.82;

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
  const clamp = useCallback(
    (v: number) => {
      let n = v;
      if (min != null) n = Math.max(n, min);
      if (max != null) n = Math.min(n, max);
      // 浮動小数の誤差を丸める（0.1 刻み対策）
      return Math.round(n * 1000) / 1000;
    },
    [min, max],
  );

  /*
   * 繰り返しの中から「いまの値」を読む。
   * setTimeout の中に閉じ込めた props は前の描画のものなので、
   * そのまま足すと**ずっと同じ数から1歩ずつ**になってしまう。
   */
  const latest = useRef({ value, onChange, step, clamp });
  latest.current = { value, onChange, step, clamp };

  const timer = useRef<number | undefined>(undefined);
  /** 押している間に1回でも繰り返しが走ったか。走ったなら離したときの click は捨てる */
  const repeated = useRef(false);

  const stop = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  /** 1歩動かす。上限・下限に着いたら false を返す */
  const bump = useCallback((dir: 1 | -1): boolean => {
    const { value: v, onChange: fn, step: s, clamp: cl } = latest.current;
    const next = cl(v + dir * s);
    if (next === v) return false;
    fn(next);
    return true;
  }, []);

  const start = useCallback(
    (dir: 1 | -1) => {
      stop();
      repeated.current = false;
      let interval = FIRST_INTERVAL_MS;
      const tick = () => {
        repeated.current = true;
        if (!bump(dir)) return stop(); // 端に着いたら止まる
        interval = Math.max(MIN_INTERVAL_MS, interval * SPEEDUP);
        timer.current = window.setTimeout(tick, interval);
      };
      timer.current = window.setTimeout(tick, HOLD_DELAY_MS);
    },
    [bump, stop],
  );

  // 画面の外で指を離しても止める（押したまま外へ滑らせた場合）
  useEffect(() => {
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      stop();
    };
  }, [stop]);

  const atMin = min != null && value <= min;
  const atMax = max != null && value >= max;

  const btn =
    'flex size-11 shrink-0 select-none touch-none items-center justify-center rounded-md border border-border active:scale-95 disabled:opacity-30 disabled:active:scale-100';

  /*
   * 押した瞬間ではなく離したとき（click）に1歩動かす。
   * こうするとキーボードの Enter / Space でもそのまま動く。
   * 長押しで繰り返しが走っていたら、離したときのぶんは足さない。
   */
  const hold = (dir: 1 | -1) => ({
    onPointerDown: () => start(dir),
    onPointerUp: stop,
    onPointerLeave: stop,
    onClick: () => {
      if (repeated.current) {
        repeated.current = false;
        return;
      }
      bump(dir);
    },
  });

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button type="button" className={btn} disabled={atMin} aria-label="減らす" {...hold(-1)}>
        <Minus className="size-4" />
      </button>

      <div className="flex min-w-0 flex-1 items-baseline justify-center gap-1">
        <span className="text-xl font-semibold tabular-nums">
          {format ? format(value) : value.toLocaleString('ja-JP')}
        </span>
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>

      <button type="button" className={btn} disabled={atMax} aria-label="増やす" {...hold(1)}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}
