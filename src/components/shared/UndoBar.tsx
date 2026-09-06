import { useCallback, useEffect, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';

/**
 * 取り消し。
 *
 * 指で押す前提の画面では、押し間違いは必ず起きる。**確認ダイアログでは解決しない**
 * ——毎回「よろしいですか」を挟むと、正しい操作まで2タップになり、
 * しかも人は読まずに押すようになる。
 *
 * 押したことは即座に反映し、直後に取り消せるようにする。
 * 元に戻す中身は呼ぶ側が持つ（**押す前の値をそのまま覚えておく**）。
 * 「無い」を押した在庫を元に戻すのに、量を推測し直したりしない。
 *
 * 数秒で消える。残り続けると、画面の下がいつまでも塞がる。
 */
const SHOW_MS = 7000;

interface Pending {
  label: string;
  undo: () => void | Promise<void>;
  /** 同じ操作を続けて押したときに、古い取り消しを差し替えるための鍵 */
  id: number;
}

export function useUndoBar() {
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const offer = useCallback((label: string, undo: () => void | Promise<void>) => {
    window.clearTimeout(timer.current);
    const id = ++seq.current;
    setPending({ label, undo, id });
    timer.current = window.setTimeout(() => {
      setPending((cur) => (cur?.id === id ? null : cur));
    }, SHOW_MS);
  }, []);

  const bar = pending ? (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[86px]">
      <div className="pf-rise pointer-events-auto flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg">
        <span className="min-w-0 flex-1 truncate text-xs">{pending.label}</span>
        <button
          onClick={async () => {
            window.clearTimeout(timer.current);
            setPending(null);
            await pending.undo();
          }}
          className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-medium active:bg-accent"
        >
          <Undo2 className="size-3.5" />
          取り消す
        </button>
      </div>
    </div>
  ) : null;

  return { offer, bar };
}
