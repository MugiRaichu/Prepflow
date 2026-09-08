import { cn } from '@/lib/utils';

/**
 * ヘッダー用ロゴ。public/icons/icon.svg と同じ形。
 *
 * **24px では要素を減らす。**アイコンには皿と中身の波もあるが、
 * この大きさでは潰れて団子になる。器と湯気だけ残す。
 * 線も太くする（細いままだと消える）。
 */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 512 512" className="size-6 shrink-0" aria-hidden="true">
        <rect width="512" height="512" rx="112" className="fill-primary" />
        <g
          fill="none"
          stroke="currentColor"
          className="text-background"
          strokeWidth="34"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* 器。口の線と、受ける弧 */}
          <path d="M136 292 H376" />
          <path d="M136 292 C136 346 190 382 256 382 C322 382 376 346 376 292" />
          {/* 湯気。右へ傾きながら長くなる＝平日へ流れていく */}
          <path d="M186 248 C200 224 184 208 194 186" strokeWidth="28" />
          <path d="M254 242 C278 214 256 194 282 164" strokeWidth="28" opacity="0.66" />
          <path d="M320 248 C350 212 328 192 362 150" strokeWidth="28" opacity="0.4" />
        </g>
      </svg>
      {withText && (
        <span className="pf-wordmark text-lg">Ohitsu</span>
      )}
    </span>
  );
}
