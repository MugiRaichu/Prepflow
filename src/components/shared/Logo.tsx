import { cn } from '@/lib/utils';

/**
 * ヘッダー用ロゴ。public/icons/icon.svg と同じ形。
 *
 * **24px では要素を減らす。**アイコンには台の楕円・箍（たが）・つまみもあるが、
 * この大きさでは潰れて団子になる。蓋・胴・湯気だけ残す。
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
          {/* 蓋。持ち上がって右へずれている（左が開いている） */}
          <path d="M198 268 L390 268" strokeWidth="40" />
          {/* 口と胴 */}
          <path d="M162 300 L350 300" />
          <path d="M162 300 L176 386 C179 404 193 414 211 414 L301 414 C319 414 333 404 336 386 L350 300" />
          {/* 湯気。開いている左から出て、右へ */}
          <path d="M178 272 C192 246 174 230 186 202" strokeWidth="28" />
          <path d="M226 236 C252 208 228 188 256 156" strokeWidth="28" opacity="0.6" />
        </g>
      </svg>
      {withText && (
        <span className="pf-wordmark text-lg">Ohitsu</span>
      )}
    </span>
  );
}
