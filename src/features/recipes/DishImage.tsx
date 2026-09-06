import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera } from 'lucide-react';
import { db } from '@/db/db';
import { setRecipePhoto } from '@/db/repositories/recipePhotos';
import type { Recipe } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * 料理の見た目。
 *
 * 写真があればそれを出す。無ければ、料理から決まる絵を出す。
 *
 * **よそから写真を持ってこない。**権利の確認ができないうえ、138品ぶんを
 * 同梱するとアプリが数十MBになり、オフラインで動く前提が崩れる
 * （D-073 / D-105 と同じ線）。作ったときに1枚撮れば、次からその写真が出る。
 *
 * 撮るまでの間も枠だけにしないのは、一覧が全部同じ灰色の四角になると、
 * かえって料理を探しにくくなるため。主材料と作り方から絵を選ぶので、
 * 「肉を焼くもの」「麺」「カレー」くらいの見分けは付く。
 */

type Glyph =
  | 'chicken'
  | 'pork'
  | 'beef'
  | 'fish'
  | 'egg'
  | 'tofu'
  | 'noodle'
  | 'curry'
  | 'friedrice'
  | 'rice'
  | 'salad'
  | 'veg';

/**
 * 食材名から主材料の種類を引く。
 * 「鶏むね肉（皮なし）」のような表記ゆれを吸収するので、部分一致で見る。
 */
const PROTEIN_PATTERNS: [RegExp, Glyph][] = [
  [/合いびき|牛/, 'beef'],
  [/豚|ベーコン/, 'pork'],
  [/鶏|ささみ/, 'chicken'],
  [/鮭|さば|ツナ|えび|ちくわ/, 'fish'],
  [/卵/, 'egg'],
  [/豆腐|厚揚げ|納豆|油揚げ|ビーンズ/, 'tofu'],
];

/** 見た目で「これは○○の料理」と言えるかどうかは、いちばん量の多い材料で決まる */
function dominantProtein(r: Recipe): Glyph | null {
  let best: { glyph: Glyph; grams: number } | null = null;
  for (const item of r.ingredients) {
    for (const [re, glyph] of PROTEIN_PATTERNS) {
      if (!re.test(item.ingredientName)) continue;
      if (!best || item.quantity > best.grams) best = { glyph, grams: item.quantity };
      break;
    }
  }
  return best?.glyph ?? null;
}

/**
 * レシピからどの絵にするかを決める。
 *
 * 見る順は「皿の形が決まるもの」から。麺・カレー・炒飯は、何の肉が入って
 * いようと見た目がその料理になる。そのあとで主材料を見る。
 *
 * 白いごはんの絵は主食（ごはん）だけに使う。**炒飯や丼にごはんの絵を当てると、
 * 主菜も主食も同じ絵になって区別が付かない。**粒と湯気のある別の絵にする。
 */
function glyphOf(r: Recipe): Glyph {
  const tags = new Set(r.tags);
  if (tags.has('麺') || tags.has('パスタ')) return 'noodle';
  if (tags.has('カレー')) return 'curry';
  if (/炒飯|チャーハン|焼き飯|ピラフ|丼|リゾット|ドリア/.test(r.title)) return 'friedrice';
  if (r.role === 'staple') return 'rice';

  // 生のまま和えるものはサラダの絵。火を通す野菜料理とは見た目が違う
  if (r.role === 'side' && /サラダ|マリネ|和え|ナムル|浅漬け|塩もみ|冷奴/.test(r.title)) {
    return 'salad';
  }

  return dominantProtein(r) ?? 'veg';
}

/**
 * 皿の上に主材料が載っている形。線だけで描く（モノクロ）。
 * 皿は共通、中身だけ差し替える。
 */
function GlyphArt({ kind }: { kind: Glyph }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className="size-full" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* 皿 */}
        <ellipse cx="24" cy="30" rx="16" ry="7" opacity="0.5" />
        {kind === 'chicken' && (
          <>
            <path d="M16 27c0-5 4-9 8-9s8 4 8 9" />
            <path d="M20 18l-3-5M28 18l3-5" />
          </>
        )}
        {kind === 'pork' && (
          <>
            <rect x="15" y="20" width="18" height="8" rx="4" />
            <path d="M19 24h10" opacity="0.6" />
          </>
        )}
        {kind === 'beef' && (
          <>
            <path d="M15 27c-1-6 4-9 9-9s10 3 9 9" />
            <path d="M21 22h6" opacity="0.6" />
          </>
        )}
        {kind === 'fish' && (
          <>
            <path d="M13 24c4-5 14-5 18 0-4 5-14 5-18 0z" />
            <path d="M31 24l4-3v6l-4-3z" />
            <circle cx="19" cy="24" r="1" />
          </>
        )}
        {kind === 'egg' && (
          <>
            <ellipse cx="24" cy="24" rx="10" ry="7" />
            <circle cx="24" cy="24" r="3.5" />
          </>
        )}
        {kind === 'tofu' && (
          <>
            <rect x="16" y="19" width="16" height="9" rx="1.5" />
            <path d="M16 23h16M24 19v9" opacity="0.5" />
          </>
        )}
        {kind === 'noodle' && (
          <>
            <path d="M14 26c3-6 17-6 20 0" />
            <path d="M17 22c2-3 12-3 14 0" opacity="0.7" />
            <path d="M20 18c1-2 6-2 7 0" opacity="0.5" />
          </>
        )}
        {kind === 'curry' && (
          <>
            <path d="M13 27c0-4 5-6 11-6" />
            <path d="M24 21c6 0 11 2 11 6" opacity="0.6" />
            <path d="M18 24h4M27 25h3" opacity="0.6" />
          </>
        )}
        {kind === 'rice' && (
          <>
            <path d="M14 24c0 4 4 6 10 6s10-2 10-6z" />
            <path d="M18 21c2-2 10-2 12 0" opacity="0.6" />
          </>
        )}
        {/* 炒飯・丼。粒と湯気で「ごはんもの」と分かるが、白いごはんとは違う */}
        {kind === 'friedrice' && (
          <>
            <path d="M14 26c0-4 4-7 10-7s10 3 10 7" />
            <circle cx="20" cy="23" r="1" opacity="0.7" />
            <circle cx="24" cy="21" r="1" opacity="0.7" />
            <circle cx="28" cy="23" r="1" opacity="0.7" />
            <path d="M22 16c1-1 0-2 1-3M27 16c1-1 0-2 1-3" opacity="0.5" />
          </>
        )}
        {/* サラダ。器から葉がはみ出している形 */}
        {kind === 'salad' && (
          <>
            <path d="M15 24c0 4 4 6 9 6s9-2 9-6z" />
            <path d="M19 23c-1-3 1-5 3-5M24 23c0-4 2-6 4-6M28 24c1-2 3-3 4-3" opacity="0.7" />
          </>
        )}
        {kind === 'veg' && (
          <>
            <path d="M24 28c-6 0-9-4-9-8 5 0 9 3 9 8z" />
            <path d="M24 28c6 0 9-4 9-8-5 0-9 3-9 8z" opacity="0.7" />
            <path d="M24 28v-6" opacity="0.5" />
          </>
        )}
      </g>
    </svg>
  );
}

/** 保存してある写真を読む。表示のたびに Blob URL を作り、外れたら捨てる */
function usePhotoUrl(recipeId: string): string | null {
  const row = useLiveQuery(() => db.recipePhotos.get(recipeId), [recipeId]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!row?.blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(row.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [row]);
  return url;
}

/** 見るだけ。献立や一覧に並べる */
export function DishImage({ recipe, className }: { recipe: Recipe; className?: string }) {
  const url = usePhotoUrl(recipe.id);
  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden rounded-md border bg-secondary/40 text-muted-foreground',
        className,
      )}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <GlyphArt kind={glyphOf(recipe)} />
      )}
    </div>
  );
}

/**
 * 押すと撮る。撮った写真はこのレシピのものとして端末に残る。
 * 撮り直しも同じ操作（上書き）。
 */
export function DishPhotoInput({ recipe, className }: { recipe: Recipe; className?: string }) {
  const url = usePhotoUrl(recipe.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            await setRecipePhoto(recipe.id, f);
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        aria-label={url ? '写真を撮り直す' : '写真をとる'}
        className={cn(
          'relative shrink-0 overflow-hidden rounded-md border bg-secondary/40 text-muted-foreground',
          className,
        )}
      >
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <GlyphArt kind={glyphOf(recipe)} />
        )}
        {/* 撮ってあるものには出さない。まだのものにだけ「撮れる」と示す */}
        {!url && (
          <span className="absolute bottom-0 right-0 flex size-4 items-center justify-center rounded-tl-md bg-foreground text-background">
            <Camera className="size-2.5" />
          </span>
        )}
      </button>
    </>
  );
}
