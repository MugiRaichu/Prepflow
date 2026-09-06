import type { Recipe, RecipeIngredient, RecipeStep } from '@/db/schema';

/**
 * その手順で使う材料を出す。
 *
 * 「材料を混ぜる」とだけ書いてあっても、何をどれだけ混ぜるのか分からなければ
 * 作れない（本人指摘）。手順の横に材料と分量を出す。
 *
 * **どの材料かは手順の文から読む。**レシピ側に「この手順で使う材料」を
 * 持たせる手もあるが、162品ぶんを人手で埋めることになり、書き足すたびに
 * 抜ける。文に名前が出ていればそれ、出ていなければ全部、という規則で足りる。
 *
 *   「なすを乱切りにする」        → なす
 *   「豚肉と玉ねぎを炒める」       → 豚こま切れ肉・玉ねぎ
 *   「材料を混ぜる」「全部を混ぜて」 → 全部（名前が無いのだから全部が正しい）
 *
 * 分量は仕込み回数ぶんに増やす。2回ぶん作るなら2倍が要る。
 */

/** 名前から、手順の文に出てきそうな形をいくつか作る */
function aliasesOf(name: string): string[] {
  // 「鶏むね肉（皮なし）」→「鶏むね肉」
  const base = name.replace(/（[^）]*）/g, '').trim();
  const out = new Set<string>([base]);

  // 「鶏むね肉」は文中では「鶏むね」と書かれる。末尾の一般語を落とす
  const trimmed = base.replace(/(肉|缶|粉|の素)$/u, '');
  if (trimmed.length >= 2) out.add(trimmed);

  // 「豚こま切れ肉」→「豚こま」。切り方の語まで含めて書かれないことが多い
  const short = base.replace(/(こま切れ|切り身|薄切り|ひき)/u, (m) => m.slice(0, 2));
  if (short !== base && short.length >= 2) out.add(short);

  // 手順では「豚肉を炒める」のように、種類をまとめて書かれる
  const kind = base.match(/^(豚|鶏|牛)/u);
  if (kind) out.add(kind[1] + '肉');

  return [...out].filter((a) => a.length >= 2);
}

/**
 * 「調味料を加えて」で名指しされる材料。
 *
 * 大さじ・小さじで書かれているものを調味料とみなす。分類を引くには食材マスタが
 * 要るが、ここはレシピだけで完結させたい（調理画面が持っているのはレシピだけ）。
 */
function seasonings(items: RecipeIngredient[]): RecipeIngredient[] {
  return items.filter((it) => /大さじ|小さじ|少々/.test(it.displayQuantity ?? ''));
}

/**
 * 手順の文に名前が出ている材料。1つも出ていなければ全部を返す。
 * 「全部」を返すのは投げやりではなく、**名前が書かれていない手順は
 * 材料をまとめて扱う手順**だから（混ぜる・煮る・焼く）。
 */
export function stepIngredients(recipe: Recipe, step: RecipeStep): RecipeIngredient[] {
  const named = recipe.ingredients.filter((it) =>
    aliasesOf(it.ingredientName).some((a) => step.text.includes(a)),
  );
  if (named.length > 0) return named;

  // 「調味料を加えて煮からめる」で肉まで並べても仕方がない
  if (step.text.includes('調味料')) {
    const only = seasonings(recipe.ingredients);
    if (only.length > 0) return only;
  }

  return recipe.ingredients;
}

/** 表示用の分量。仕込み回数ぶんに増やす */
export function amountLabel(item: RecipeIngredient, batches: number): string {
  const grams = Math.round(item.quantity * batches);
  if (!item.displayQuantity) return grams + 'g';
  // 1回ぶんならレシピの書き方をそのまま使う（「大さじ2」のほうが量りやすい）
  if (batches === 1) return item.displayQuantity + '（' + grams + 'g）';
  return grams + 'g（' + item.displayQuantity + ' × ' + batches + '）';
}
