/**
 * 容器の過不足を絵で見せる。
 *
 * 「容器が7個足りません」と数だけ出していた。**読んでも手が動かない。**
 * 7という数を頭の中で「今週の食事のうち7食ぶん」に翻訳し、
 * それを「じゃあ皿を7枚出す」まで持っていく作業を、人にやらせていた。
 *
 * 並べるのは今週詰める食数ぶんの升。持っている容器の数だけ順に埋まり、
 * 足りない側には**皿が出てくる**。逃げ道が絵の中に入っているので、
 * 数を読む前に「皿で足りるのか」が分かる。
 *
 * 動かすのは、埋まっていく順序に意味があるから。
 * 一度に全部出すと「多い」しか残らないが、順に埋まると
 * 「ここまでは容器、ここからは皿」という切れ目が見える。
 * 動きが苦手な人には最後の状態だけを静かに置く（`prefers-reduced-motion`）。
 *
 * 色は食材の色（`--food-*`）だけを使う。イラスト専用の色で、装飾には使わない。
 */
const MAX_SLOTS = 14;

/** 容器。ふた付きの保存容器を真横から見た形 */
function Box({ filled, delay }: { filled: boolean; delay: number }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden="true">
      {/* 本体。下が少しすぼまった形にすると、皿と見分けがつく */}
      <path
        d="M4.5 9 L6 19.5 H18 L19.5 9 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeDasharray={filled ? undefined : '2.5 2'}
        opacity={filled ? 1 : 0.45}
      />
      {/* ふた */}
      <path
        d="M3 8 H21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray={filled ? undefined : '2.5 2'}
        opacity={filled ? 1 : 0.45}
      />
      {filled && (
        // 中身。順に落ちてくる
        <path
          d="M6.6 14 L17.4 14 L18 19.5 H6 Z"
          className="pf-fill-drop"
          style={{ animationDelay: delay + 'ms' }}
          fill="var(--food-veg)"
        />
      )}
    </svg>
  );
}

/**
 * 皿にラップ。容器が足りないぶんの逃げ道。
 *
 * 線を減らす。24pxの中に皿・盛り・ラップを全部描くと、
 * 何の絵か分からない塊になる（実際そうなった）。
 * 皿の輪郭とラップの弧の2本だけにして、中身は面で置く。
 */
function Plate({ delay }: { delay: number }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden="true">
      <g className="pf-plate-in" style={{ animationDelay: delay + 'ms' }}>
        {/* ラップ。皿の上にふんわり掛かっている1本の弧 */}
        <path
          d="M4 12.5 Q12 6 20 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.45"
        />
        {/* 盛ったもの */}
        <path d="M8 15.5 Q12 11.5 16 15.5 Z" fill="var(--food-veg)" />
        {/* 皿。少し上から見た楕円 */}
        <ellipse cx="12" cy="16" rx="9" ry="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </g>
    </svg>
  );
}

export function ContainerGauge({ need, have }: { need: number; have: number }) {
  const short = Math.max(0, need - have);
  // 升が多すぎると数えられない。14を超えたら打ち切って、残りは数で言う
  const shownHave = Math.min(have, MAX_SLOTS);
  const shownShort = Math.min(short, Math.max(0, MAX_SLOTS - shownHave));
  const hidden = need - shownHave - shownShort;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-foreground">
        {Array.from({ length: shownHave }, (_, i) => (
          <Box key={'b' + i} filled delay={i * 90} />
        ))}
        {shownShort > 0 && (
          <>
            {/* 切れ目。ここから先は容器がない */}
            <span
              className="pf-gauge-split mx-1 h-6 w-px shrink-0 bg-border"
              style={{ animationDelay: shownHave * 90 + 'ms' }}
            />
            {/*
              **重ねない。**点線の容器の上に皿を描いていたら、線が混ざって
              何の絵か分からない塊になった。容器が無いことは、左との
              区切り線と皿の形で足りている
            */}
            {Array.from({ length: shownShort }, (_, i) => (
              <Plate key={'s' + i} delay={shownHave * 90 + 200 + i * 90} />
            ))}
          </>
        )}
        {hidden > 0 && (
          <span className="ml-0.5 shrink-0 text-[10px] tabular-nums text-muted-foreground">
            ほか {hidden}
          </span>
        )}
      </div>

      {/* 絵が言っていることを、そのまま1行で言う。絵だけに頼らない */}
      <p className="text-[11px] leading-relaxed">
        今週詰めるのは <b>{need} 食ぶん</b>。容器は <b>{have} 個</b>あるので、
        <b>残り {short} 食ぶんは皿に盛ってラップ</b>で足ります。
      </p>
    </div>
  );
}
