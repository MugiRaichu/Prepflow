import { cn } from '@/lib/utils';

/**
 * ヘッダー用ロゴ。public/icons/icon.svg と同じ形。
 *
 * アイコンを描き直した（[[D-151]]）ときに、ここが**前の形のまま残っていた**。
 * ホーム画面と画面の中で違う印が出ると、同じアプリだと分からなくなる。
 *
 * 線は 24px で見るぶん、アイコンより太くしてある。細いままだと消える。
 */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 512 512" className="size-6 shrink-0" aria-hidden="true">
        {/* 地は生成り、線は朱。アイコンと同じ向き */}
        <rect width="512" height="512" rx="112" className="fill-background" />
        <g
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* 器（受けとめる）から、右上へ抜ける流れまでをひと続きで */}
          <path
            d="M400 160 C 389 194 371 228 346 228 L 116 228 C 116 326 166 386 231 386 C 296 386 346 326 346 228"
            strokeWidth="44"
          />
          {/* 湯気。左右で高さを変える（そろえると顔に見える） */}
          <path d="M180 176 C 196 152 178 136 191 108" strokeWidth="28" />
          <path d="M258 184 C 273 164 258 149 269 125" strokeWidth="28" />
        </g>
      </svg>
      {withText && (
        <span className="pf-wordmark text-lg font-semibold tracking-tight">Prepflow</span>
      )}
    </span>
  );
}
