import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { removeUserRecipe, setRecipeEnabled } from '@/db/repositories/userRecipes';
import { RECIPE_ROLE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { DishImage } from './DishImage';
import type { Recipe, RecipeRole } from '@/db/schema';

/**
 * レシピの一覧。
 *
 * 献立に使われる母集団がここ。品数が増えるほど献立の質は上がるが、
 * 「食べたくないもの」が混ざると質は下がる。消すのと休ませるのを分けてある。
 * 組み込みレシピは消しても起動時に戻ってくる（D-062）ので、休ませるほうを使う。
 */
/**
 * 一度に出す件数。
 *
 * 162品を全部並べると、押せるものが491個・文字が4000字を超える。
 * スマホの1画面に対して多すぎて、探すより先に閉じたくなる。
 * **探すのは絞ってから**にして、既定では上から少しだけ出す。
 */
const PAGE = 20;

const ROLE_TABS: { value: 'all' | RecipeRole; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'main', label: '主菜' },
  { value: 'side', label: '副菜' },
  { value: 'snack', label: '間食' },
];

export function RecipeList() {
  const [tab, setTab] = useState<'all' | 'user'>('all');
  const [role, setRole] = useState<'all' | RecipeRole>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const recipes = useLiveQuery(
    async () => (await db.recipes.toArray()).sort((a, b) => a.title.localeCompare(b.title, 'ja')),
    [],
  );

  const q = query.trim();
  const matched = (recipes ?? []).filter((r) => {
    if (tab === 'user' && r.source === 'builtin') return false;
    if (role !== 'all' && r.role !== role) return false;
    if (!q) return true;
    // 料理名と材料名の両方で探す。「なす」で なすの煮びたし も 麻婆なす も出る
    return (
      r.title.includes(q) || r.ingredients.some((i) => i.ingredientName.includes(q))
    );
  });
  const shown = matched.slice(0, limit);
  const active = (recipes ?? []).filter((r) => r.deleted === 0).length;
  const mine = (recipes ?? []).filter((r) => r.source !== 'builtin').length;

  return (
    <div className="pb-8">
      <PageHeader
        title="レシピ"
        backTo="/settings"
        action={
          <Link
            to="/recipes/new"
            className="flex size-11 items-center justify-center rounded-md active:bg-accent"
            aria-label="足す"
          >
            <Plus className="size-5" />
          </Link>
        }
      />

      <div className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <div className="flex gap-2">
            <Tab on={tab === 'all'} onClick={() => setTab('all')}>
              すべて
            </Tab>
            <Tab on={tab === 'user'} onClick={() => setTab('user')}>
              自作 {mine > 0 && mine}
            </Tab>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            献立に使う {active} 品
          </span>
        </div>

        <Link
          to="/recipes/new"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-semibold text-background"
        >
          <Plus className="size-4" />
          レシピを足す
        </Link>

        {/* 探す手段を先に置く。162品を上から見る人はいない */}
        <div className="flex items-center gap-2 rounded-md border px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="料理名・材料で探す"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {q && (
            <button onClick={() => setQuery('')} className="shrink-0 p-1 text-muted-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-1.5">
          {ROLE_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setRole(t.value);
                setLimit(PAGE);
              }}
              className={cn(
                'min-h-11 flex-1 rounded-md border text-xs',
                role === t.value
                  ? 'border-foreground bg-foreground font-medium text-background'
                  : 'border-border text-muted-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="divide-y">
          {shown.map((r) => (
            <Row key={r.id} recipe={r} />
          ))}
        </div>

        {matched.length > shown.length && (
          <button
            onClick={() => setLimit(limit + PAGE * 2)}
            className="min-h-11 w-full rounded-md border text-xs active:bg-accent"
          >
            もっと見る（残り {matched.length - shown.length} 品）
          </button>
        )}

        {shown.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            まだありません。画面を撮った画像から足せます。
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ recipe }: { recipe: Recipe }) {
  const on = recipe.deleted === 0;
  const n = recipe.nutritionPerServing;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <DishImage recipe={recipe} className="size-12" />
      {/* 行そのものが押しどころ。指が届く高さを持たせる */}
      <button
        onClick={() => void setRecipeEnabled(recipe.id, !on)}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center text-left"
      >
        <div className={cn('truncate text-sm', !on && 'text-muted-foreground line-through')}>
          {recipe.title}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {RECIPE_ROLE_LABELS[recipe.role]} ・ 1食 {Math.round(n.kcal)} kcal ・ P{' '}
          {Math.round(n.proteinG)}g
          {recipe.source !== 'builtin' && ' ・ 自作'}
        </div>
      </button>

      {recipe.source !== 'builtin' && (
        <button
          onClick={() => void removeUserRecipe(recipe.id)}
          className="shrink-0 p-1.5 text-muted-foreground"
          aria-label="消す"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Tab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'min-h-11 rounded-md border px-3 text-xs',
        on ? 'border-foreground bg-foreground font-medium text-background' : 'border-border',
      )}
    >
      {children}
    </button>
  );
}
