import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { useObjectUrl } from '@/components/shared/PhotoAdd';
import { photosByDay, removePhoto } from '@/db/repositories/photos';
import { formatDateJa, MEAL_SLOT_LABELS } from '@/lib/labels';
import type { MealPhoto } from '@/db/schema';

/**
 * 撮った写真を見返す。
 *
 * **日ごとに、撮った順に並べる。**料理ごとでも枠ごとでもない——
 * 見返すときに思い出すのは「あの日なに食べたっけ」であって、
 * 「先月の朝食一覧」ではない。
 *
 * 1日1行。横に並べて、はみ出したぶんは横に流す。
 * 縦に積むと、3か月ぶんで画面が何十回ぶんもスクロールすることになる。
 */
export function PhotoScreen() {
  const days = useLiveQuery(() => photosByDay(), []);
  const [open, setOpen] = useState<MealPhoto | null>(null);

  return (
    <div className="pb-8">
      <PageHeader title="写真" backTo="/dashboard" />

      {days && days.length === 0 && (
        <EmptyState
          title="まだ写真がありません"
          description="今日の画面で、食事や間食の横から入れられます。写真は端末の中だけに残ります。"
        />
      )}

      <div className="space-y-5 p-4">
        {(days ?? []).map(({ date, photos }) => (
          <section key={date}>
            <h2 className="mb-1.5 text-xs text-muted-foreground">{formatDateJa(date)}</h2>
            {/* 横に流す。縦に積むと、3か月ぶんが延々と続く */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {photos.map((p) => (
                <Thumb key={p.id} photo={p} onOpen={() => setOpen(p)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {open && <Viewer photo={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Thumb({ photo, onOpen }: { photo: MealPhoto; onOpen: () => void }) {
  const url = useObjectUrl(photo.image);
  return (
    <button
      onClick={onOpen}
      className="relative size-28 shrink-0 overflow-hidden rounded-lg border bg-secondary"
    >
      {url && <img src={url} alt="" className="size-full object-cover" />}
      {/* 枠の名前だけ小さく。日付は上の見出しが持っている */}
      <span className="absolute bottom-0 left-0 rounded-tr bg-background/85 px-1.5 py-0.5 text-xs">
        {MEAL_SLOT_LABELS[photo.slot]}
      </span>
    </button>
  );
}

/**
 * 1枚を大きく見る。
 * **消す道もここに置く。**一覧に消すボタンを並べると、流し見のときに触ってしまう。
 */
function Viewer({ photo, onClose }: { photo: MealPhoto; onClose: () => void }) {
  const url = useObjectUrl(photo.image);
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
        {url && <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />}
      </div>

      <div className="space-y-2 pt-3">
        <div className="text-center text-xs text-background">
          {formatDateJa(photo.date)}　{MEAL_SLOT_LABELS[photo.slot]}
        </div>
        {asking ? (
          <div className="space-y-2">
            <button
              onClick={() => {
                void removePhoto(photo.id);
                onClose();
              }}
              className="min-h-12 w-full rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground"
            >
              この写真を消す（戻せません）
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
            この写真を消す
          </button>
        )}
      </div>
    </div>
  );
}
