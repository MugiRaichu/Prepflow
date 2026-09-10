import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { useObjectUrl } from '@/components/shared/PhotoAdd';
import { logsByDay, removeLog } from '@/db/repositories/photos';
import { formatDateJa, MEAL_SLOT_LABELS } from '@/lib/labels';
import type { MealLog } from '@/db/schema';

/**
 * 残したものを見返す。
 *
 * **日ごとに、残した順に並べる。**料理ごとでも枠ごとでもない——
 * 見返すときに思い出すのは「あの日なに食べたっけ」であって、
 * 「先月の朝食一覧」ではない。
 *
 * 写真と文を**同じ並びに混ぜる**。別々の欄にすると、
 * 撮った日と書いた日を頭で突き合わせることになる。
 */
export function PhotoScreen() {
  const days = useLiveQuery(() => logsByDay(), []);
  const [open, setOpen] = useState<MealLog | null>(null);

  return (
    <div className="pb-8">
      <PageHeader title="記録" backTo="/dashboard" />

      {days && days.length === 0 && (
        <EmptyState
          title="まだ記録がありません"
          description="今日の画面で、食事や間食の横から写真とメモを残せます。記録は端末の中だけに残ります。"
        />
      )}

      <div className="space-y-5 p-4">
        {(days ?? []).map(({ date, logs }) => {
          const shots = logs.filter((l) => l.image);
          const notes = logs.filter((l) => !l.image && l.note);
          return (
            <section key={date}>
              <h2 className="mb-1.5 text-xs text-muted-foreground">{formatDateJa(date)}</h2>
              {shots.length > 0 && (
                /* 横に流す。縦に積むと、3か月ぶんが延々と続く */
                <div className="-mx-4 mb-1.5 flex gap-2 overflow-x-auto px-4 pb-1">
                  {shots.map((l) => (
                    <Thumb key={l.id} log={l} onOpen={() => setOpen(l)} />
                  ))}
                </div>
              )}
              {notes.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setOpen(l)}
                  className="mb-1 flex w-full gap-2 rounded-md border-l-2 border-border py-1 pl-2 text-left"
                >
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {MEAL_SLOT_LABELS[l.slot]}
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-relaxed">{l.note}</span>
                </button>
              ))}
            </section>
          );
        })}
      </div>

      {open && <Viewer log={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Thumb({ log, onOpen }: { log: MealLog; onOpen: () => void }) {
  const url = useObjectUrl(log.image);
  return (
    <button
      onClick={onOpen}
      className="relative size-28 shrink-0 overflow-hidden rounded-lg border bg-secondary"
    >
      {url && <img src={url} alt="" className="size-full object-cover" />}
      {/* 枠の名前だけ小さく。日付は上の見出しが持っている */}
      <span className="absolute bottom-0 left-0 rounded-tr bg-background/85 px-1.5 py-0.5 text-xs">
        {MEAL_SLOT_LABELS[log.slot]}
      </span>
    </button>
  );
}

/**
 * 1件を大きく見る。
 * **消す道もここに置く。**一覧に消すボタンを並べると、流し見のときに触ってしまう。
 */
function Viewer({ log, onClose }: { log: MealLog; onClose: () => void }) {
  const url = useObjectUrl(log.image);
  const [asking, setAsking] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-foreground/90 p-4">
      <div className="flex justify-end">
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="flex size-11 items-center justify-center rounded-full bg-background/90"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {url ? (
          <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        ) : (
          <p className="max-w-sm whitespace-pre-wrap rounded-lg bg-background p-5 text-sm leading-relaxed">
            {log.note}
          </p>
        )}
      </div>

      <div className="space-y-2 pt-3">
        {/* 写真に添えた文があれば、下に出す */}
        {url && log.note && (
          <p className="text-center text-sm leading-relaxed text-background">{log.note}</p>
        )}
        <div className="text-center text-xs text-background">
          {formatDateJa(log.date)}　{MEAL_SLOT_LABELS[log.slot]}
        </div>
        {asking ? (
          <div className="space-y-2">
            <button
              onClick={() => {
                void removeLog(log.id);
                onClose();
              }}
              className="min-h-12 w-full rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground"
            >
              この記録を消す（戻せません）
            </button>
            <button
              onClick={() => setAsking(false)}
              className="min-h-11 w-full text-xs text-background/80"
            >
              やめる
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAsking(true)}
            className="min-h-11 w-full text-xs text-background/80"
          >
            この記録を消す
          </button>
        )}
      </div>
    </div>
  );
}
