import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { knowledgeOf } from '@/db/data/knowledge';
import { cn } from '@/lib/utils';

/**
 * 「なぜこの時刻か」を開く。
 *
 * 中身は静的なテキスト（出典つき）。端末内AIに事実を語らせない。
 * 小さいモデルは「トレ後30分」「睡眠は22時〜2時」のような俗説を
 * 学習データのまま自信を持って答えるため、ここでは使わない。
 * AIの役割は本人の状況に合わせた言い換えで、それは別ボタンに分ける。
 */
export function WhySheet({
  knowledgeId,
  className,
  onAskAi,
}: {
  knowledgeId: string;
  className?: string;
  /** 端末内AIが有効なときだけ渡す */
  onAskAi?: (k: ReturnType<typeof knowledgeOf>) => void;
}) {
  const [open, setOpen] = useState(false);
  const k = knowledgeOf(knowledgeId);
  if (!k) return null;

  return (
    <div className={cn('mt-1', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground"
      >
        <HelpCircle className="size-3" />
        なぜ？
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="pf-rise mt-2 space-y-2 rounded-md border p-3">
          <div className="text-xs font-medium">{k.title}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">{k.body}</p>

          {k.myth && (
            <div className="rounded border border-foreground/30 p-2">
              <div className="text-xs font-medium">よくある誤解</div>
              <p className="text-xs leading-relaxed text-muted-foreground">{k.myth}</p>
            </div>
          )}

          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">出典</summary>
            <ul className="mt-1 space-y-0.5">
              {k.sources.map((src) => (
                <li key={src} className="text-xs leading-relaxed text-muted-foreground">
                  ・{src}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              確度: {k.confidence === 'high' ? '高い' : k.confidence === 'medium' ? '中くらい' : '低い'}
              ／ 一般的な目安であって、個別の医学的助言ではありません。
            </p>
          </details>

          {onAskAi && (
            <button
              onClick={() => onAskAi(k)}
              className="min-h-11 w-full rounded-md border text-xs active:bg-accent"
            >
              自分の場合はどうか、端末内AIに聞く
            </button>
          )}
        </div>
      )}
    </div>
  );
}
