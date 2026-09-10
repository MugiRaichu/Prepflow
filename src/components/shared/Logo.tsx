import { cn } from '@/lib/utils';

/**
 * ヘッダー用ロゴ。public/icons/icon.svg と同じ形（風車）。
 *
 * **24px では線を太くする。**アイコンの太さ（15）のままだと、
 * この大きさでは 0.7px になって消える。
 * 形は減らさない——風車は羽が4枚そろって初めて風車に見える。
 */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 512 512" className="size-6 shrink-0" aria-hidden="true">
        <rect
          width="512"
          height="512"
          rx="112"
          className="fill-background stroke-border"
          strokeWidth="14"
        />
        <g
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* 羽4枚。外へ開く線と、付け根へ戻す線が対になっている */}
          <path d="M 292 250 C 380 226 434 300 360 372" />
          <path d="M 360 372 C 304 320 286 278 286 278" />
          <path d="M 262 292 C 286 380 212 434 140 360" />
          <path d="M 140 360 C 192 304 234 286 234 286" />
          <path d="M 220 262 C 132 286 78 212 152 140" />
          <path d="M 152 140 C 208 192 226 234 226 234" />
          <path d="M 250 220 C 226 132 300 78 372 152" />
          <path d="M 372 152 C 320 208 278 226 278 226" />
          <circle cx="256" cy="256" r="17" />
        </g>
      </svg>
      {withText && <span className="pf-wordmark text-lg">Plenora</span>}
    </span>
  );
}
