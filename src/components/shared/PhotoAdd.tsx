import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { addPhoto } from '@/db/repositories/photos';
import type { ISODate, MealSlot, UUID } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * 写真を1枚足す。
 *
 * **カメラを開くのではなく、端末の写真の口を開く。**
 * `capture` を付けるとカメラが直に起動するが、そうすると
 * **あとから「さっき撮ったあれ」を選べない。**食べる前に撮って、
 * 落ち着いてから登録する、という順番のほうが自然なので、
 * カメラもライブラリも両方出る素の口にしてある。
 *
 * 押してから保存まで数百ミリ秒かかる（縮めているため）。
 * そのあいだボタンを「入れています…」に変える——
 * 無反応だと、もう一度押して2枚入る。
 */
export function PhotoAdd({
  slot,
  date,
  plannedMealId,
  profileId,
  label = '写真',
  className,
  onAdded,
}: {
  slot: MealSlot;
  date?: ISODate;
  plannedMealId?: UUID;
  profileId?: UUID;
  label?: string;
  className?: string;
  onAdded?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const pick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await addPhoto({
        file,
        slot,
        ...(date ? { date } : {}),
        ...(plannedMealId ? { plannedMealId } : {}),
        ...(profileId ? { profileId } : {}),
      });
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
        className="hidden"
        onChange={(e) => void pick(e.target.files)}
      />
      {error && <p className="mt-1 text-xs text-muted-foreground">{error}</p>}
    </>
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
