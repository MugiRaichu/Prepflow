import { cn } from '@/lib/utils';

/**
 * 名前の字。**書体を使わず、6文字を描いてある。**
 *
 * 書体は3つ試して3つとも戻ってきた（筆記体・Fraunces・Quicksand・Klee One）。
 * どれも「誰かが作った字」で、**このアプリのものではなかった**。
 * 字を描いてしまえば、どこにも同じものが無い（本人「もっと独自のものに」）。
 *
 * 描き方はアイコンと同じ言葉——**太さの変わらない線、丸い端、丸い角**。
 * 印と名前が同じ手で書かれているように見える。
 *
 * 2か所だけ、意味を持たせてある。
 *   O … お櫃を上から見た形。**右上が開いている**（蓋がずれている）
 *   i の点 … 湯気の一筆
 *
 * 書体を取りに行かないので、**外への通信が1つも無くなる**。
 * 圏外でも見た目が変わらず、届くまで名前が出ない、という待ちも起きない。
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 354 140"
      className={cn('h-[1em] w-auto', className)}
      role="img"
      aria-label="Ohitsu"
      fill="none"
      stroke="currentColor"
      strokeWidth="15"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* O … 右上が開いた輪 */}
      <path d="M 66.5 24.2 A 34 44 0 1 0 79.6 34.3" />
      {/* h */}
      <path d="M 106 20 L 106 110" />
      <path d="M 106 68 C 112 50 140 50 144 68 L 144 110" />
      {/* i … 点は湯気 */}
      <path d="M 164 52 L 164 110" />
      <path d="M 161 36 C 169 29 160 24 168 16" strokeWidth="11" />
      {/* t */}
      <path d="M 194 30 L 194 94 C 194 114 208 112 214 104" />
      <path d="M 180 52 L 212 52" strokeWidth="12" />
      {/* s */}
      <path d="M 276 62 C 270 49 240 49 238 68 C 236 93 276 85 274 92" />
      <path d="M 274 92 C 270 113 244 113 236 100" />
      {/* u */}
      <path d="M 294 52 L 294 92 C 294 113 332 113 332 92 L 332 52" />
      <path d="M 332 52 L 332 110" />
    </svg>
  );
}
