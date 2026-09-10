import { cn } from '@/lib/utils';

/**
 * ヘッダー用ロゴ。public/icons/icon.svg と同じ一筆。
 *
 * **24px でも形が変わらない。**線1本なので、減らすところが無い——
 * 太さだけ上げれば、そのまま小さくできる。
 */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 512 512" className="size-6 shrink-0" aria-hidden="true">
        <rect width="512" height="512" rx="112" className="fill-primary" />
        <path
          d="M118 168 C 118 316 178 388 256 388 C 334 388 394 316 394 168 C 394 118 330 108 306 152 C 282 196 348 226 396 172"
          fill="none"
          stroke="currentColor"
          className="text-background"
          strokeWidth="44"
          strokeLinecap="round"
        />
      </svg>
      {withText && <span className="pf-wordmark text-lg">Plenora</span>}
    </span>
  );
}
