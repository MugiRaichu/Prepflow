import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 決まっている設定は、1行に畳む。
 *
 * 設定画面は「これから決めるもの」ではなく「もう決まっているもの」を
 * 並べた場所になる。ほとんどの人はほとんどの項目を触らないのに、
 * 全部の選択肢と説明が常に開いていた。
 *
 * 実測（作り方の画面）: 押せるものが39個。曜日の丸が14個、
 * ごはんの選択肢が7個。**その大半は、二度と押されない。**
 *
 * だから既定は畳んでおく。ただし**値は畳んだ状態でも見せる**。
 * 「いま何になっているか」は知りたいことで、押して確かめるものではない。
 *
 *   週に何回作るか            週1回  ›     ← ふだんはこれだけ
 *   ┗ 開くと選択肢と、選んだ結果どうなるかが出る
 *
 * 説明文も畳む側に入れる。**選ぶ前の説明は読まれない。**
 * 読むのは「押したあと何が変わったか」なので、開いたときに出せば足りる。
 */
export function Field({
  label,
  value,
  hint,
  children,
  defaultOpen = false,
}: {
  label: string;
  /** 畳んだままでも見える、いまの値。短く */
  value: string;
  /** いまの選択がどう効くか。開いたときだけ出す */
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn('rounded-lg border', open && 'bg-card')}>
      <button
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center gap-2 px-3 text-left"
      >
        <span className="shrink-0 text-sm">{label}</span>
        <span className="flex-1 truncate text-right text-xs text-muted-foreground">
          {open ? '' : value}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t px-3 py-3">
          {children}
          {/* 選んだ結果を、選択肢のすぐ下に置く。上に置くと選ぶ前に読むことになる */}
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      )}
    </div>
  );
}
