import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search } from 'lucide-react';
import { Stepper } from '@/components/shared/Stepper';
import { addStock, listAddableIngredients, listStock, undoAddStock } from '@/db/repositories/inventory';
import { STORE_SECTION_LABELS } from '@/lib/labels';
import { UNIT_LABEL } from '@/features/planner/logic/shoppingList';
import type { Ingredient, StoreSection } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * すでに家にあるものを足す。
 *
 * **探し方は2つ用意する。**名前が分かっていれば打つ（「にんじん」「ニンジン」どちらでも）。
 * 冷蔵庫を開けながらなら、売り場の区分ごとに並んだ一覧を上から見ていく。
 *
 * **量は買う単位で聞く。**「にんじん 1袋」「卵 半パック」なら見た瞬間に答えられるが、
 * 300g とは答えられない（棚卸しと同じ理由）。
 *
 * 押すまで欄を開かない。開いたまま置いておくと、棚卸しの画面が入力の画面に見える。
 */

/** ひらがな・カタカナ・大小文字の違いを畳む。「ニンジン」で にんじん が出るように */
function fold(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function StockAdd({
  onAdded,
}: {
  /** 足したあと、取り消しの帯を出すために呼ぶ */
  onAdded: (label: string, undo: () => Promise<void>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Ingredient | null>(null);
  const [units, setUnits] = useState(1);

  const ingredients = useLiveQuery(() => (open ? listAddableIngredients() : []), [open]);
  const stock = useLiveQuery(() => (open ? listStock() : []), [open]);
  const have = new Map((stock ?? []).map((s) => [s.ingredientId, s.quantity]));

  const hits = useMemo(() => {
    const list = ingredients ?? [];
    const key = fold(q.trim());
    if (!key) return list;
    return list.filter((i) =>
      [i.name, i.nameKey, ...i.aliases].some((n) => fold(n).includes(key)),
    );
  }, [ingredients, q]);

  const sections = [...new Set(hits.map((i) => i.section))];

  const close = () => {
    setOpen(false);
    setQ('');
    setPicked(null);
    setUnits(1);
  };

  const save = async () => {
    if (!picked) return;
    const r = await addStock(picked.id, units);
    if (r) {
      const unit = UNIT_LABEL[picked.purchase.unit];
      onAdded(picked.name + ' を ' + units + unit + ' 足しました', () => undoAddStock(r));
    }
    // 続けて足すことが多い（冷蔵庫を上から見ていく）。欄は閉じず、選択だけ戻す
    setPicked(null);
    setUnits(1);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium active:bg-accent"
      >
        <Plus className="size-4" />
        家にあるものを足す
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">家にあるものを足す</span>
        <button onClick={close} className="min-h-11 px-2 text-xs text-muted-foreground">
          閉じる
        </button>
      </div>

      <label className="flex items-center gap-2 rounded-md border border-input px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPicked(null);
          }}
          placeholder="名前で探す（にんじん、卵…）"
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>

      {hits.length === 0 && (
        <p className="text-xs text-muted-foreground">
          見つかりません。設定 › 食材・プロテイン から食材そのものを増やせます。
        </p>
      )}

      <div className="max-h-[55vh] space-y-3 overflow-y-auto">
        {sections.map((sec) => (
          <div key={sec}>
            <div className="mb-1 text-xs text-muted-foreground">
              {STORE_SECTION_LABELS[sec as StoreSection]}
            </div>
            <div className="divide-y rounded-md border">
              {hits
                .filter((i) => i.section === sec)
                .map((i) => {
                  const unit = UNIT_LABEL[i.purchase.unit];
                  const isPicked = picked?.id === i.id;
                  const now = have.get(i.id);
                  return (
                    <div key={i.id} className={cn(isPicked && 'bg-secondary')}>
                      <button
                        onClick={() => {
                          setPicked(isPicked ? null : i);
                          setUnits(1);
                        }}
                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">{i.name}</span>
                        {/* もう入っているものは、いまの見込みを添える（二重に足すのを防ぐ） */}
                        {now ? (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            いま {Math.round(now)}g
                          </span>
                        ) : null}
                      </button>

                      {isPicked && (
                        <div className="space-y-2 px-3 pb-3">
                          <Stepper
                            value={units}
                            onChange={setUnits}
                            step={0.5}
                            min={0.5}
                            max={20}
                            suffix={unit}
                          />
                          <p className="text-center text-xs tabular-nums text-muted-foreground">
                            1{unit} = 約{Math.round(i.purchase.gramsPerUnit)}g ・ 足すのは約
                            {Math.round(units * i.purchase.gramsPerUnit)}g
                          </p>
                          <button
                            onClick={() => void save()}
                            className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background"
                          >
                            {units}
                            {unit} 足す
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
