/**
 * 絵で言うための部品。
 *
 * **どこにでも置かない。**飾りの絵は認知負荷を増やすだけで、
 * 読むものが1つ増える（D-084: 出す意味のないものを画面に置かない）。
 *
 * 置くのは「数字を頭の中で絵に変換させている場所」だけ。
 *   「容器が7個足りません」→ 7を食数に訳し、皿を7枚出すところまで人がやっていた
 *   「冷蔵庫へ4食ぶん、冷凍庫へ1食ぶん」→ どっちに何を入れるかを人が組み立てていた
 * 数を読む前に形で分かるなら、絵のほうが速い。
 *
 * 形は3つだけに絞る。増やすと語彙を覚える負担が出るので、
 * **同じものは同じ形**で通す（容器はどの画面でも同じ容器の形）。
 *
 * 色は食材の色（`--food-*`）だけ。イラスト専用で、装飾には使わない。
 * 動きは順序に意味があるときだけ付ける。
 * `prefers-reduced-motion` では最後の状態を静かに置く（index.css）。
 */
import { cn } from '@/lib/utils';

export interface GlyphProps {
  /** 動き出すまでの待ち時間（ms）。順に現れることで数が数えられる */
  delay?: number;
  className?: string;
}

/** 保存容器。ふた付きを真横から見た形 */
export function BoxGlyph({ filled = true, delay = 0, className }: GlyphProps & { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6 shrink-0', className)} aria-hidden="true">
      {/* 下がすぼまった形にすると、皿と見分けがつく */}
      <path
        d="M4.5 9 L6 19.5 H18 L19.5 9 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeDasharray={filled ? undefined : '2.5 2'}
        opacity={filled ? 1 : 0.45}
      />
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
 * 皿にラップ。容器が足りないときの逃げ道。
 * 線は2本まで。24pxの中に皿・盛り・ラップを全部描くと、
 * 何の絵か分からない塊になる（実際そうなった）。
 */
export function PlateGlyph({ delay = 0, className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6 shrink-0', className)} aria-hidden="true">
      <g className="pf-plate-in" style={{ animationDelay: delay + 'ms' }}>
        <path
          d="M4 12.5 Q12 6 20 12.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.45"
        />
        <path d="M8 15.5 Q12 11.5 16 15.5 Z" fill="var(--food-veg)" />
        <ellipse cx="12" cy="16" rx="9" ry="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </g>
    </svg>
  );
}

/**
 * 冷蔵庫と冷凍庫。**同じ箱で、中の印だけ変える。**
 * 別々の絵にすると「どっちがどっち」を覚えることになる。
 */
export function ApplianceGlyph({
  kind,
  className,
}: {
  kind: 'fridge' | 'freezer';
  className?: string;
}) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} aria-hidden="true">
      <rect
        x="7"
        y="4"
        width="18"
        height="24"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      {/* 取っ手 */}
      <path d="M21.5 9.5 V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {kind === 'fridge' ? (
        // 棚。冷蔵は「置く場所」
        <>
          <path d="M9 15.5 H23" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
          <path d="M9 21 H23" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
        </>
      ) : (
        // 雪の印。冷凍は「止める場所」
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.75">
          <path d="M16 15 V23" />
          <path d="M12.6 17 L19.4 21" />
          <path d="M19.4 17 L12.6 21" />
        </g>
      )}
    </svg>
  );
}
