import { cn } from '@/lib/utils';

/** ヘッダー用ロゴ。public/icons/icon.svg と同じ幾何。currentColor で白黒どちらにも追従 */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 512 512" className="size-6 shrink-0" aria-hidden="true">
        <rect width="512" height="512" rx="96" className="fill-foreground" />
        <g
          fill="none"
          stroke="currentColor"
          className="text-background"
          strokeWidth="36"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M112 152 H400" />
          <path d="M112 256 H304" />
          <path d="M112 360 H208" />
          <path d="M336 312 L384 360 L336 408" />
        </g>
      </svg>
      {withText && <span className="text-base font-semibold tracking-tight">Prepflow</span>}
    </span>
  );
}
