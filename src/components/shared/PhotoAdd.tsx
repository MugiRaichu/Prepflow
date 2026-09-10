import { useEffect, useRef, useState } from 'react';
import { Camera, PenLine } from 'lucide-react';
import { addNote, addPhoto } from '@/db/repositories/photos';
import type { ISODate, MealSlot, UUID } from '@/db/schema';
import { cn } from '@/lib/utils';

interface Where {
  slot: MealSlot;
  date?: ISODate;
  plannedMealId?: UUID;
  profileId?: UUID;
}

const where = (p: Where) => ({
  slot: p.slot,
  ...(p.date ? { date: p.date } : {}),
  ...(p.plannedMealId ? { plannedMealId: p.plannedMealId } : {}),
  ...(p.profileId ? { profileId: p.profileId } : {}),
});

/**
 * 写真を足す。
 *
 * **カメラを開くのではなく、端末の写真の口を開く。**
 * `capture` を付けるとカメラが直に起動するが、そうすると
 * **あとから「さっき撮ったあれ」を選べない。**食べる前に撮って、
 * 落ち着いてから登録する、という順番のほうが自然なので、
 * カメラもライブラリも両方出る素の口にしてある。
 *
 * **一度に何枚でも選べる。**同じ食事で何枚も撮ることがあるし、
 * あとからまとめて登録することもある。1枚ずつ選ばせると、
 * その回数だけ端末の写真の画面を開き直すことになる。
 *
 * 押してから保存まで数百ミリ秒かかる（縮めているため）。
 * そのあいだボタンを「入れています…」に変える——
 * 無反応だと、もう一度押して同じものが2枚入る。
 */
export function PhotoAdd({
  label = '写真',
  className,
  onAdded,
  ...pos
}: Where & { label?: string; className?: string; onAdded?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const pick = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      /*
        1枚ずつ順に入れる。まとめて並列にすると、大きい画像を何枚も
        同時に展開することになり、端末によってはそこで落ちる
      */
      for (const file of list) {
        await addPhoto({ ...where(pos), file });
      }
      onAdded?.();
    } catch {
      // 端末の空きが無い、画像が壊れている、など。押した人にできることを書く
      setError('入れられませんでした。端末の空きを確かめてください。');
    } finally {
      if (alive.current) setBusy(false);
      // 同じ写真をもう一度選べるように、選択を空にしておく
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs text-muted-foreground active:bg-accent disabled:opacity-50',
          className,
        )}
      >
        <Camera className="size-4 shrink-0" />
        {busy ? '入れています…' : label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void pick(e.target.files)}
      />
      {error && <p className="mt-1 text-xs text-muted-foreground">{error}</p>}
    </>
  );
}

/**
 * ひとことだけ残す。
 *
 * **写真を撮れない場面のほうが多い。**外で食べた、片づけてから思い出した、
 * そもそも撮る空気ではなかった——それでも「なにを食べたか」は残したい。
 * 写真と同じ場所に、同じ形で置く（見返すときに1本の並びになる）。
 *
 * **押すまで入力欄を出さない。**空の欄が常に置いてあると、
 * 書かない日に「書き残している」ように見える。
 */
export function NoteAdd({
  label = 'メモ',
  className,
  onAdded,
  ...pos
}: Where & { label?: string; className?: string; onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await addNote({ ...where(pos), note: text });
    setBusy(false);
    setText('');
    setOpen(false);
    onAdded?.();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs text-muted-foreground active:bg-accent',
          className,
        )}
      >
        <PenLine className="size-4 shrink-0" />
        {label}
      </button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        rows={2}
        placeholder="食べたもの、味、ひとこと"
        className="w-full rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex gap-2">
        <button
          onClick={() => void save()}
          disabled={busy || !text.trim()}
          className="min-h-11 flex-1 rounded-lg bg-foreground text-xs font-semibold text-background disabled:opacity-40"
        >
          残す
        </button>
        <button
          onClick={() => {
            setText('');
            setOpen(false);
          }}
          className="min-h-11 flex-1 rounded-lg border text-xs text-muted-foreground"
        >
          やめる
        </button>
      </div>
    </div>
  );
}

/**
 * Blob を <img> に出せる形にする。
 * **使い終わったら手放す**——手放さないと、画面を開くたびに端末のメモリが増える。
 */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob]);
  return url;
}
