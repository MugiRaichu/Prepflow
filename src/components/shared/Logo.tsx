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
          {/* 蓋。身より広い1本の線。板であることは、はみ出す幅で言う */}
          <path d="M126 288 L386 288" strokeWidth="40" />
          {/* 胴。下がわずかにすぼまる */}
          <path d="M162 296 L176 384 C179 402 193 412 211 412 L301 412 C319 412 333 402 336 384 L350 296" />
          {/* 湯気。右へ傾きながら長くなる */}
          <path d="M196 230 C210 208 194 194 204 174" strokeWidth="28" />
          <path d="M270 220 C294 194 272 176 298 148" strokeWidth="28" opacity="0.66" />
          <path d="M330 232 C358 198 336 180 368 144" strokeWidth="28" opacity="0.4" />
        </g>
      </svg>
      {withText && (
        <span className="pf-wordmark text-lg">Ohitsu</span>
      )}
    </span>
  );
}
