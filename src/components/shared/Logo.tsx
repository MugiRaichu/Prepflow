import { cn } from '@/lib/utils';

/** ヘッダー用ロゴ。public/icons/icon.svg と同じ幾何。currentColor で白黒どちらにも追従 */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 512 512" className="size-6 shrink-0" aria-hidden="true">
        {/* アプリのアイコンと同じ一筆。地は朱色、線は生成り */}
        <rect width="512" height="512" rx="112" className="fill-primary" />
        <g fill="none" stroke="currentColor" className="text-background" strokeLinecap="round">
          <path d="M118 168 C 118 316 178 388 256 388 C 334 388 394 316 394 168 C 394 118 330 108 306 152 C 282 196 348 226 396 172" strokeWidth="38" />
          {/* 器が受けている中身。輪郭だけでは「うつわ」で終わる */}
          <path d="M 166 250 C 196 214 226 286 256 250 C 286 214 316 286 346 250" strokeWidth="24" opacity="0.72" />
          {/* 湯気。温かいものが今ここにある、は形では言えない */}
          <path d="M 206 128 C 232 100 206 82 220 56" strokeWidth="20" opacity="0.6" />
          <path d="M 288 122 C 314 94 288 76 302 50" strokeWidth="20" opacity="0.45" />
        </g>
      </svg>
      {withText && (
        <span className="pf-wordmark text-lg font-semibold tracking-tight">Prepflow</span>
      )}
    </span>
  );
}
