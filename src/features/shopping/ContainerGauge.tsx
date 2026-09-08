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
import { BoxGlyph, PlateGlyph } from '@/components/shared/Pictogram';

const MAX_SLOTS = 14;

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
          <BoxGlyph key={'b' + i} delay={i * 90} />
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
              <PlateGlyph key={'s' + i} delay={shownHave * 90 + 200 + i * 90} />
            ))}
          </>
        )}
        {hidden > 0 && (
          <span className="ml-0.5 shrink-0 text-[10px] tabular-nums text-muted-foreground">
            ほか {hidden}
          </span>
        )}
      </div>

      {/*
        絵が言っていることを、そのまま1行で言う。絵だけに頼らない。
        **「食ぶん」と言わない。**主菜は1食ずつ、副菜はまとめて詰めるので、
        容器の数と食数は一致しない（以前は全品を1容器に混ぜて数えていた）
      */}
      <p className="text-[11px] leading-relaxed">
        今週使う容器は <b>{need} 個</b>。持っているのは <b>{have} 個</b>なので、
        <b>残り {short} 個は皿に盛ってラップ</b>で足ります。
      </p>
    </div>
  );
}
