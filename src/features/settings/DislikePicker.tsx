import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { foodPreferenceOf, setFoodPreference } from '@/db/repositories/profiles';
import { STORE_SECTION_LABELS } from '@/lib/labels';
import type { Ingredient, Profile, StoreSection } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * 好き嫌い。
 *
 * アレルギーと分けているのは、強さが違うから。アレルギーは体の問題で
 * 絶対に緩めないが、好き嫌いには「できれば避けたい」と「絶対に無理」がある。
 * 全部を絶対にすると、苦手なものが数個あるだけで献立が組めなくなる。
 *
 * **1つのチップを押すたびに段階が上がる。**画面を2つに分けると、
 * 同じ食材が2箇所に出て、どちらに入れたか分からなくなる。
 *   1回 → 苦手（できるだけ避ける）
 *   2回 → 入れない（絶対に出さない）
 *   3回 → 解除
 *
 * 調味料は出さない。しょうゆが苦手な人はいるが、それは献立ではなく
 * 味付けの話で、ここで外すと作れる料理がほぼ無くなる。
 */
const HIDDEN_SECTIONS: StoreSection[] = ['seasoning'];

const NEXT: Record<string, 'dislike' | 'exclude' | null> = {
  none: 'dislike',
  dislike: 'exclude',
  exclude: null,
};

export function DislikePicker({ profile }: { profile: Profile }) {
  const all = useLiveQuery(() => db.ingredients.where('deleted').equals(0).toArray(), []);
  if (!all) return null;

  const items = all.filter((i) => !HIDDEN_SECTIONS.includes(i.section));
  const sections = [...new Set(items.map((i) => i.section))];
  const chosen = items.filter((i) => foodPreferenceOf(profile, i.id));

  const cycle = (ing: Ingredient) => {
    const cur = foodPreferenceOf(profile, ing.id) ?? 'none';
    void setFoodPreference(
      profile.id,
      { id: ing.id, name: ing.name, aliases: ing.aliases },
      NEXT[cur] ?? null,
    );
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">好き嫌い</div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        押すたびに変わります。1回で「苦手」、もう1回で「入れない」、もう1回で解除。
      </p>

      {sections.map((sec) => (
        <div key={sec} className="space-y-1.5 pt-1">
          <div className="text-[10px] text-muted-foreground">{STORE_SECTION_LABELS[sec]}</div>
          <div className="flex flex-wrap gap-1.5">
            {items
              .filter((i) => i.section === sec)
              .map((ing) => {
                const state = foodPreferenceOf(profile, ing.id);
                return (
                  <button
                    key={ing.id}
                    onClick={() => cycle(ing)}
                    className={cn(
                      'min-h-10 rounded-md border px-2.5 text-xs',
                      state === 'exclude'
                        ? 'pf-pop border-foreground bg-foreground font-medium text-background line-through'
                        : state === 'dislike'
                          ? 'pf-pop border-foreground font-medium'
                          : 'border-border text-muted-foreground',
                    )}
                  >
                    {ing.name}
                  </button>
                );
              })}
          </div>
        </div>
      ))}

      {/* 何を選んだのかを、状態ごとに言葉で返す。見た目の差だけでは伝わらない（D-084） */}
      {chosen.length > 0 && (
        <div className="space-y-1 rounded-lg border p-3 text-[11px] leading-relaxed">
          {(['dislike', 'exclude'] as const).map((kind) => {
            const list = chosen.filter((i) => foodPreferenceOf(profile, i.id) === kind);
            if (list.length === 0) return null;
            return (
              <div key={kind}>
                <span className="font-medium">{list.map((i) => i.name).join('・')}</span>
                {kind === 'dislike'
                  ? ' は、できるだけ避けます。ほかに手がないときだけ出ます。'
                  : ' は、絶対に献立に出しません。'}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
