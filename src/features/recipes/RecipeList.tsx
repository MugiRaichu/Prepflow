import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { removeUserRecipe, setRecipeEnabled } from '@/db/repositories/userRecipes';
import { RECIPE_ROLE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import type { Recipe } from '@/db/schema';

/**
 * レシピの一覧。
 *
 * 献立に使われる母集団がここ。品数が増えるほど献立の質は上がるが、
 * 「食べたくないもの」が混ざると質は下がる。消すのと休ませるのを分けてある。
 * 組み込みレシピは消しても起動時に戻ってくる（D-062）ので、休ませるほうを使う。
 */
export function RecipeList() {
  const [tab, setTab] = useState<'all' | 'user'>('all');

  const recipes = useLiveQuery(
    async () => (await db.recipes.toArray()).sort((a, b) => a.title.localeCompare(b.title, 'ja')),
    [],
  );

  const shown = (recipes ?? []).filter((r) => (tab === 'user' ? r.source !== 'builtin' : true));
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
            className="flex size-8 items-center justify-center rounded-md active:bg-accent"
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
          <span className="text-[10px] tabular-nums text-muted-foreground">
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

        <div className="divide-y">
          {shown.map((r) => (
            <Row key={r.id} recipe={r} />
          ))}
        </div>

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
      <button
        onClick={() => void setRecipeEnabled(recipe.id, !on)}
        className="min-w-0 flex-1 text-left"
      >
        <div className={cn('truncate text-sm', !on && 'text-muted-foreground line-through')}>
          {recipe.title}
        </div>
        <div className="text-[10px] tabular-nums text-muted-foreground">
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
        'min-h-9 rounded-md border px-3 text-xs',
        on ? 'border-foreground bg-foreground font-medium text-background' : 'border-border',
      )}
    >
      {children}
    </button>
  );
}
