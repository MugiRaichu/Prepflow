import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Plus, Trash2 } from 'lucide-react';
import { db, touch } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { Chips, MultiChips } from '@/components/shared/Chips';
import { Stepper } from '@/components/shared/Stepper';
import { addIngredient } from '@/db/repositories/userRecipes';
import { ALLERGEN_LABELS, MANDATORY_ALLERGENS, STORE_SECTION_LABELS } from '@/lib/labels';
import type { AllergenTag, Ingredient, StoreSection, Unit } from '@/db/schema';

/**
 * 食材とプロテイン商品の登録。
 *
 * ここは**このアプリで唯一、栄養の数字を人が入れる場所**。
 * ただし、ほとんどの人は数字を入れない。プロテインは種類ごとの差が製品ごとの差より
 * ずっと大きいので、種類をタップすれば代表値が入る。
 * パッケージと違う人だけ「詳しく直す」を開く。
 */
export function IngredientSettings() {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');

  const all = useLiveQuery(
    async () =>
      (await db.ingredients.where('deleted').equals(0).toArray()).sort((a, b) =>
        a.name.localeCompare(b.name, 'ja'),
      ),
    [],
  );

  const shown = useMemo(() => {
    const s = q.trim();
    if (!s) return all ?? [];
    return (all ?? []).filter(
      (i) => i.name.includes(s) || i.nameKey.includes(s) || i.aliases.some((a) => a.includes(s)),
    );
  }, [all, q]);

  const mine = (all ?? []).filter((i) => i.source === 'user');

  return (
    <div className="pb-8">
      <PageHeader
        title="食材・プロテイン"
        backTo="/settings"
        action={
          <button
            onClick={() => setAdding(!adding)}
            className="flex size-8 items-center justify-center rounded-md active:bg-accent"
            aria-label="足す"
          >
            <Plus className="size-5" />
          </button>
        }
      />

      <div className="space-y-4 p-4">
        {adding ? (
          <AddForm onDone={() => setAdding(false)} />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-semibold text-background"
          >
            <Plus className="size-4" />
            プロテインや食材を登録する
          </button>
        )}

        {/* 自分で登録したものを先に。探すのは大抵こちら */}
        {mine.length > 0 && !adding && (
          <div className="space-y-1">
            <div className="text-xs font-medium">登録したもの</div>
            <div className="divide-y rounded-lg border px-3">
              {mine.map((i) => (
                <IngredientRow key={i.id} ing={i} />
              ))}
            </div>
          </div>
        )}

        {!adding && (
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-3 text-xs text-muted-foreground">
              すべての食材（{(all ?? []).length} 品）
            </summary>
            <div className="space-y-2 border-t px-3 pb-3 pt-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="さがす"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none"
              />
              <div className="divide-y">
                {shown.map((i) => (
                  <IngredientRow key={i.id} ing={i} />
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function IngredientRow({ ing }: { ing: Ingredient }) {
  const n = ing.nutritionPer100g;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{ing.name}</div>
        <div className="text-[10px] tabular-nums text-muted-foreground">
          100g {Math.round(n.kcal)} kcal ・ P {n.proteinG}g ・ F {n.fatG}g ・ C {n.carbG}g
        </div>
      </div>
      {ing.source === 'user' && (
        <button
          onClick={async () => {
            const cur = await db.ingredients.get(ing.id);
            if (cur) await db.ingredients.put(touch({ ...cur, deleted: 1 }));
          }}
          className="shrink-0 p-1.5 text-muted-foreground"
          aria-label="消す"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

const SECTION_OPTIONS: StoreSection[] = [
  'other',
  'daily_chilled',
  'meat_fish',
  'produce',
  'dry_grocery',
  'seasoning',
  'frozen',
];

const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'pack', label: '袋・パック' },
  { value: 'piece', label: '個' },
  { value: 'can', label: '缶' },
  { value: 'g', label: 'g' },
];

/**
 * プロテインの種類。**タップで100gあたりの成分が入る。**
 *
 * 製品ごとの差より、種類ごとの差のほうがずっと大きい
 * （ホエイは P75g前後、ゲイナーは P25g・C65g）。種類を選べば
 * ほとんどの人はそれで足り、違う人だけ「詳しく直す」で数字を合わせる。
 * 値は日本で流通している主要製品の中央値に近い概数。
 */
interface Preset {
  key: string;
  label: string;
  hint: string;
  per100g: { kcal: number; proteinG: number; fatG: number; carbG: number };
  unit: Unit;
  gramsPerUnit: number;
  priceYen: number;
  allergens: AllergenTag[];
  section: StoreSection;
}

const PRESETS: Preset[] = [
  { key: 'wpc', label: 'ホエイ', hint: 'いちばん一般的', per100g: { kcal: 396, proteinG: 75, fatG: 5, carbG: 10 }, unit: 'pack', gramsPerUnit: 1000, priceYen: 4500, allergens: ['milk'], section: 'other' },
  { key: 'wpi', label: 'ホエイ WPI', hint: '高たんぱく・低脂質', per100g: { kcal: 380, proteinG: 88, fatG: 1.5, carbG: 3 }, unit: 'pack', gramsPerUnit: 1000, priceYen: 6000, allergens: ['milk'], section: 'other' },
  { key: 'casein', label: 'カゼイン', hint: '寝る前', per100g: { kcal: 370, proteinG: 78, fatG: 2, carbG: 8 }, unit: 'pack', gramsPerUnit: 1000, priceYen: 5000, allergens: ['milk'], section: 'other' },
  { key: 'soy', label: 'ソイ', hint: '乳なし', per100g: { kcal: 375, proteinG: 80, fatG: 3, carbG: 6 }, unit: 'pack', gramsPerUnit: 1000, priceYen: 4000, allergens: ['soy'], section: 'other' },
  { key: 'pea', label: 'ピー', hint: '乳・大豆なし', per100g: { kcal: 380, proteinG: 78, fatG: 6, carbG: 6 }, unit: 'pack', gramsPerUnit: 1000, priceYen: 5000, allergens: [], section: 'other' },
  { key: 'gainer', label: 'ゲイナー', hint: '増量用・炭水化物多め', per100g: { kcal: 380, proteinG: 25, fatG: 4, carbG: 65 }, unit: 'pack', gramsPerUnit: 3000, priceYen: 8000, allergens: ['milk'], section: 'other' },
  { key: 'bar', label: 'プロテインバー', hint: '1本 50g前後', per100g: { kcal: 380, proteinG: 30, fatG: 12, carbG: 40 }, unit: 'piece', gramsPerUnit: 50, priceYen: 200, allergens: ['milk', 'soy', 'wheat'], section: 'other' },
  { key: 'other', label: 'その他の食材', hint: '成分を写す', per100g: { kcal: 100, proteinG: 5, fatG: 3, carbG: 12 }, unit: 'pack', gramsPerUnit: 300, priceYen: 300, allergens: [], section: 'daily_chilled' },
];

/**
 * 登録の入力。
 *
 * 目に入る順に、1. 種類（タップ） 2. 名前 3. 登録ボタン。
 * 成分・単位・値段・売り場は種類から自動で入るので、既定では見せない。
 * 違うときだけ「詳しく直す」を開く。開いた人にだけ、写し間違いの警告を出す。
 */
function AddForm({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [name, setName] = useState('');
  const [detail, setDetail] = useState(false);
  const [section, setSection] = useState<StoreSection>('other');
  const [kcal, setKcal] = useState(0);
  const [protein, setProtein] = useState(0);
  const [fat, setFat] = useState(0);
  const [carb, setCarb] = useState(0);
  const [unit, setUnit] = useState<Unit>('pack');
  const [gramsPerUnit, setGramsPerUnit] = useState(1000);
  const [price, setPrice] = useState(0);
  const [allergens, setAllergens] = useState<AllergenTag[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const pick = (p: Preset) => {
    setPreset(p);
    setSection(p.section);
    setKcal(p.per100g.kcal);
    setProtein(p.per100g.proteinG);
    setFat(p.per100g.fatG);
    setCarb(p.per100g.carbG);
    setUnit(p.unit);
    setGramsPerUnit(p.gramsPerUnit);
    setPrice(p.priceYen);
    setAllergens(p.allergens);
    // 「その他」は成分を写してもらう前提なので、最初から開く
    setDetail(p.key === 'other');
  };

  // 成分から計算したカロリーと、書いてあるカロリーが食い違っていないか
  const computed = protein * 4 + fat * 9 + carb * 4;
  const off = kcal > 0 ? Math.abs(computed - kcal) / kcal : 0;

  const save = async () => {
    if (!preset) return;
    const finalName = name.trim() || (preset.key === 'other' ? '' : preset.label + 'プロテイン');
    if (!finalName) return setErr('名前を入れてください');
    try {
      await addIngredient({
        name: finalName,
        section,
        per100g: { kcal, proteinG: protein, fatG: fat, carbG: carb },
        unit,
        gramsPerUnit,
        typicalPriceYen: price,
        allergens,
        isStaple: true,
      });
      onDone();
    } catch {
      setErr('登録できませんでした');
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {/* 1. 種類。ここだけで登録まで行ける */}
      <div className="space-y-2">
        <div className="text-sm font-medium">種類</div>
        <Chips
          options={PRESETS.map((p) => ({ value: p.key, label: p.label, hint: p.hint }))}
          value={preset?.key}
          onChange={(k) => pick(PRESETS.find((p) => p.key === k)!)}
          columns={2}
        />
      </div>

      {preset && (
        <>
          {/* 2. 名前。空なら種類名で登録する */}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              preset.key === 'other' ? '食材の名前' : preset.label + 'プロテイン（商品名でも）'
            }
            className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base outline-none"
          />

          <div className="text-[11px] tabular-nums text-muted-foreground">
            100gあたり {kcal} kcal ・ P {protein}g ・ F {fat}g ・ C {carb}g
          </div>

          {/* 3. 詳細は畳んでおく。開くのはパッケージと違う人だけ */}
          {!detail ? (
            <button
              onClick={() => setDetail(true)}
              className="min-h-9 w-full rounded-md border text-[11px] text-muted-foreground active:bg-accent"
            >
              パッケージの表示と違う → 詳しく直す
            </button>
          ) : (
            <div className="space-y-4 border-t pt-4">
              <div className="space-y-2">
                <div className="text-xs font-medium">100gあたりの成分</div>
                <Row label="カロリー">
                  <Stepper value={kcal} onChange={setKcal} step={5} min={0} max={900} suffix="kcal" />
                </Row>
                <Row label="たんぱく質">
                  <Stepper value={protein} onChange={setProtein} step={1} min={0} max={100} suffix="g" />
                </Row>
                <Row label="脂質">
                  <Stepper value={fat} onChange={setFat} step={0.5} min={0} max={100} suffix="g" />
                </Row>
                <Row label="炭水化物">
                  <Stepper value={carb} onChange={setCarb} step={1} min={0} max={100} suffix="g" />
                </Row>
                {off > 0.15 && (
                  <div className="rounded-md border border-foreground/40 p-2.5 text-[11px] leading-relaxed">
                    P・F・C から計算すると {Math.round(computed)} kcal です。書いてある値と離れているので、写し間違いがあるかもしれません。
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium">買い方</div>
                <Chips options={UNIT_OPTIONS} value={unit} onChange={setUnit} columns={4} />
                <Row label="1つあたり">
                  <Stepper value={gramsPerUnit} onChange={setGramsPerUnit} step={50} min={10} max={5000} suffix="g" />
                </Row>
                <Row label="値段">
                  <Stepper value={price} onChange={setPrice} step={100} min={0} max={20000} suffix="円" />
                </Row>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium">売り場</div>
                <Chips
                  options={SECTION_OPTIONS.map((v) => ({ value: v, label: STORE_SECTION_LABELS[v] }))}
                  value={section}
                  onChange={setSection}
                  columns={3}
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium">含まれるアレルゲン</div>
                <MultiChips
                  options={MANDATORY_ALLERGENS.map((a) => ({ value: a, label: ALLERGEN_LABELS[a] }))}
                  values={allergens}
                  onChange={setAllergens}
                  columns={4}
                />
              </div>
            </div>
          )}

          {err && <div className="text-xs">{err}</div>}

          <div className="grid grid-cols-2 gap-2">
            <button onClick={onDone} className="min-h-11 rounded-md border text-sm active:bg-accent">
              やめる
            </button>
            <button
              onClick={save}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-foreground text-sm font-semibold text-background"
            >
              <Check className="size-4" />
              登録する
            </button>
          </div>
        </>
      )}

      {!preset && (
        <button onClick={onDone} className="min-h-10 w-full rounded-md border text-xs active:bg-accent">
          やめる
        </button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
