/**
 * SeedRecipe（食材キーと分量だけ）から Recipe（栄養・原価・出来上がり重量つき）を作る。
 *
 * 栄養値と原価をレシピに手書きしないのが要点。手書きすると食材マスタを直したときに
 * 必ず食い違い、しかも気づけない。ここで毎回計算する。
 */
import { newEntity } from '../db';
import { macrosFor, sumMacros } from '@/lib/nutrition';
import type {
  AllergenTag,
  Ingredient,
  Macros,
  Recipe,
  RecipeIngredient,
  RecipeStep,
} from '../schema';
import type { SeedRecipe } from './recipes';

export interface BuildResult {
  recipe: Recipe;
  /** 解決できなかった食材キー。0件でなければシードのバグ */
  missing: string[];
  /** 明らかにおかしい値。yieldFactor の入力ミスを早く見つけるため */
  warnings: string[];
}

/** 1食あたりのグラム数として現実的な範囲。外れたら入力ミスを疑う */
const PLAUSIBLE_GRAMS = { min: 40, max: 550 };

/** 「高たんぱく」と言える1人前のたんぱく質（g）。主菜の中央値は 22g、上位1/4が 27g */
export const HIGH_PROTEIN_G = 25;
export const HIGH_PROTEIN_TAG = '高たんぱく';

export function buildRecipe(seed: SeedRecipe, byKey: Map<string, Ingredient>): BuildResult {
  const missing: string[] = [];
  const ingredients: RecipeIngredient[] = [];
  const macroParts: Macros[] = [];
  const allergens = new Set<AllergenTag>();
  let costYen = 0;
  let rawGrams = 0;

  for (const [key, grams, display] of seed.items) {
    const ing = byKey.get(key);
    if (!ing) {
      missing.push(key);
      continue;
    }
    ingredients.push({
      ingredientId: ing.id,
      ingredientName: ing.name,
      quantity: grams,
      ...(display ? { displayQuantity: display } : {}),
      optional: false,
      // 調味料と常備品は店頭の代替提案の対象にしない
      substitutable: ing.isStaple === 0 && ing.section !== 'seasoning',
    });

    macroParts.push(macrosFor(ing.nutritionPer100g, grams));
    rawGrams += grams;
    // 原価は購入単位あたりの価格から按分する
    costYen += (grams / ing.purchase.gramsPerUnit) * ing.purchase.typicalPriceYen;
    for (const a of ing.allergens) allergens.add(a);
  }

  const total = sumMacros(macroParts);
  const per = (v: number) => Math.round((v / seed.servings) * 10) / 10;

  /*
   * `高たんぱく` は**手で書かせない。計算した値から付け直す。**
   *
   * 手書きのタグを信じていたとき、この印が付いた主菜111品のうち28品が
   * 25g を下回っていた。最も低いものは 10g（トマトと卵の中華炒め）で、
   * 印の無い品より低い。逆に印の無い品が 25g を超えている例も5品あった。
   * つまり「高たんぱくで」と指定した人に、たんぱく質の少ない献立を出していた。
   *
   * 栄養値は食材マスタから計算しているのに、その要約だけ手書きだったのが原因。
   * 分量を1g直しただけでもタグが実態とずれる。ここで付け直せばずれない。
   *
   * しきい値は1人前 25g。主菜の中央値が 22g、上位1/4が 27g なので、
   * 「並より明らかに多い」がこのあたりになる。
   */
  const proteinPerServing = total.proteinG / Math.max(seed.servings, 1);
  const tags = seed.tags.filter((t) => t !== HIGH_PROTEIN_TAG);
  if (seed.role !== 'side' && proteinPerServing >= HIGH_PROTEIN_G) tags.push(HIGH_PROTEIN_TAG);

  const steps: RecipeStep[] = seed.steps.map((s, i) => ({
    index: i,
    text: s.text,
    ...(s.kind ? { equipmentKind: s.kind } : {}),
    durationSec: s.min * 60,
    handsOnSec: s.hands * 60,
    unattended: s.hands === 0,
    dependsOn: s.after ?? [],
  }));

  const recipe: Recipe = {
    ...newEntity(),
    title: seed.title,
    role: seed.role,
    ...(seed.summary ? { summary: seed.summary } : {}),
    servings: seed.servings,
    yieldGrams: Math.round(rawGrams * seed.yieldFactor),
    ingredients,
    steps,
    nutritionPerServing: {
      kcal: per(total.kcal),
      proteinG: per(total.proteinG),
      fatG: per(total.fatG),
      carbG: per(total.carbG),
    },
    estimatedCostYen: Math.round(costYen),
    storage: seed.storage,
    tags,
    allergens: [...allergens],
    source: 'builtin',
    favorite: 0,
    timesCooked: 0,
  };

  const perServingGrams = recipe.yieldGrams / Math.max(seed.servings, 1);
  const warnings: string[] = [];
  if (perServingGrams > PLAUSIBLE_GRAMS.max) {
    warnings.push(
      seed.title + ': 1食 ' + Math.round(perServingGrams) + 'g は多すぎます。yieldFactor を確認',
    );
  }
  // 副菜と間食は少量で当たり前。プロテイン1杯30g を「少なすぎる」とは言わない
  if (perServingGrams < PLAUSIBLE_GRAMS.min && seed.role !== 'side' && seed.role !== 'snack') {
    warnings.push(
      seed.title + ': 1食 ' + Math.round(perServingGrams) + 'g は少なすぎます。分量を確認',
    );
  }

  return { recipe, missing, warnings };
}

/** レシピ全体の所要時間（分）。人が張り付く時間の合計ではなく、機器占有も含めた素の合計 */
export function totalMinutes(r: Recipe): number {
  return Math.round(r.steps.reduce((n, s) => n + s.durationSec, 0) / 60);
}

/** 人が実際に手を動かす時間（分）。並行調理の下限になる */
export function handsOnMinutes(r: Recipe): number {
  return Math.round(r.steps.reduce((n, s) => n + s.handsOnSec, 0) / 60);
}
