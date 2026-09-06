import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, X } from 'lucide-react';
import { db } from '@/db/db';
import { DishImage } from '@/features/recipes/DishImage';
import { RECIPE_ROLE_LABELS } from '@/lib/labels';
import type { Recipe } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * 今週かならず入れる料理を選ぶ。
 *
 * タグの希望（「鶏肉を2食」）では届かない要求がある。
 * **「唐揚げだけは入れて」は毎週あるが、「鶏肉を2食」では唐揚げは来ない。**
 *
 * 163品を並べても選べないので、入口は検索にする。
 * 料理名と材料の両方で引けるようにしてあるので、
 * 「なす」でも「なすの煮びたし」でも辿り着く。
 *
 * 選んだものは献立に必ず入る。入れすぎると栄養や予算が合わなくなるが、
 * そこは緩和ラダーが最後に外し、外したことは画面に出る。
 */
const MAX_RESULTS = 8;

export function PinPicker({
  pinned,
  onChange,
}: {
  pinned: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const recipes = useLiveQuery(
    () => db.recipes.where('deleted').equals(0).toArray(),
    [],
  );
  if (!recipes) return null;

  const byId = new Map<string, Recipe>(recipes.map((r) => [r.id, r]));
  const chosen = pinned.map((id) => byId.get(id)).filter((r): r is Recipe => Boolean(r));

  const q = query.trim();
  const hits = q
    ? recipes
        .filter(
          (r) =>
            !pinned.includes(r.id) &&
            (r.title.includes(q) || r.ingredients.some((i) => i.ingredientName.includes(q))),
        )
        .slice(0, MAX_RESULTS)
    : [];

  // 選んでいるものが無いときは、1行に畳んでおく（D-083）
  if (!open && chosen.length === 0) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-between rounded-md border px-3 text-left active:bg-accent"
      >
        <span className="text-sm">食べたい料理を指名する</span>
        <span className="text-[10px] text-muted-foreground">押して探す</span>
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="text-sm font-medium">今週かならず入れる料理</div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((r) => (
            <button
              key={r.id}
              onClick={() => onChange(pinned.filter((id) => id !== r.id))}
              className="flex min-h-9 items-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 text-xs font-medium text-primary-foreground"
            >
              {r.title}
              <X className="size-3" />
            </button>
          ))}
        </div>
      )}

      {open ? (
        <>
          <div className="flex items-center gap-2 rounded-md border px-3">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="料理名・材料で探す"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {q && (
              <button onClick={() => setQuery('')} className="shrink-0 p-1 text-muted-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {hits.length > 0 && (
            <div className="divide-y rounded-md border">
              {hits.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    onChange([...pinned, r.id]);
                    setQuery('');
                  }}
                  className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left active:bg-accent"
                >
                  <DishImage recipe={r} className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{r.title}</span>
                    <span className="block text-[10px] tabular-nums text-muted-foreground">
                      {RECIPE_ROLE_LABELS[r.role]}・1食 {Math.round(r.nutritionPerServing.kcal)} kcal
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {q && hits.length === 0 && (
            <p className="text-[10px] text-muted-foreground">見つかりませんでした。</p>
          )}

          <button
            onClick={() => {
              setOpen(false);
              setQuery('');
            }}
            className={cn('min-h-9 w-full text-[10px] text-muted-foreground')}
          >
            閉じる
          </button>
        </>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="min-h-9 w-full rounded-md border text-[11px] text-muted-foreground active:bg-accent"
        >
          ほかにも指名する
        </button>
      )}

      {chosen.length > 0 && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          残りは予算と栄養に合わせて組みます。
          指名が多すぎて組めないときは、指名を外したことを画面に出します。
        </p>
      )}
    </div>
  );
}
