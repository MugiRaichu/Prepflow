import type { Equipment, Recipe, RecipeStep } from '@/db/schema';

/**
 * ごはんの炊き方を、その家に合わせて組み直す。
 *
 * 炊飯器の炊き上がりまでの時間は機種でまるで違う（早炊き20分・普通50分・
 * 土鍋モード70分）。ここを固定値で持つと、段取り全体が実際とずれる。
 * だから所要時間は設定から取る。
 *
 * それに炊飯器を持たない人がいる。鍋や土鍋、飯盒で炊く人は、
 * 火加減を見るぶん手が要るし、コンロを1口占有する。
 * 「炊飯器がないから、ごはんは作れません」では話にならないので、
 * 持っている機器のほうに手順を合わせる。
 *
 * レシピ本体は書き換えない。作るときにだけ差し替える。
 */

/** 炊飯器の炊き上がりまで。設定が無いときの既定（普通炊き） */
export const DEFAULT_RICE_MINUTES = 50;

/** 鍋で炊くとき、火を止めてから蒸らす時間。ここは機器を使わない */
const STEAM_MINUTES = 10;

/** 鍋で炊くあいだ、火加減を見るのに取られる時間 */
const POT_HANDS_MINUTES = 4;

/** 研いで水に浸けるまで。炊き方によらず変わらない */
const WASH_MINUTES = 6;

const step = (
  index: number,
  text: string,
  min: number,
  handsMin: number,
  kind?: RecipeStep['equipmentKind'],
): RecipeStep => ({
  index,
  text,
  durationSec: Math.round(min * 60),
  handsOnSec: Math.round(handsMin * 60),
  unattended: handsMin === 0,
  dependsOn: index === 0 ? [] : [index - 1],
  ...(kind ? { equipmentKind: kind } : {}),
});

/** そのレシピが炊飯（炊飯器を前提にした手順）を含むか */
const isRiceRecipe = (r: Recipe): boolean =>
  r.steps.some((s) => s.equipmentKind === 'rice_cooker');

/**
 * 炊飯の手順を、持っている機器と設定した時間で作り直す。
 * 炊飯を含まないレシピはそのまま返す（同じ参照を返すので比較も効く）。
 */
export function adaptRice(
  recipe: Recipe,
  opts: { hasRiceCooker: boolean; riceMinutes?: number },
): Recipe {
  if (!isRiceRecipe(recipe)) return recipe;

  const total = Math.max(10, opts.riceMinutes ?? DEFAULT_RICE_MINUTES);

  if (opts.hasRiceCooker) {
    return {
      ...recipe,
      steps: [
        step(0, '米を研いで炊飯器にセットする', WASH_MINUTES, WASH_MINUTES),
        // 炊いている間は完全に放置できる。ここを機器占有として持つから、
        // 「炊いている裏で主菜を作る」段取りが組める
        step(1, '炊き上がりを待つ', total, 0, 'rice_cooker'),
      ],
    };
  }

  // 鍋で炊く。蒸らしは火から下ろすので、コンロを空けてから数える
  const boil = Math.max(10, total - STEAM_MINUTES);
  return {
    ...recipe,
    steps: [
      step(0, '米を研いで水に浸ける', WASH_MINUTES, WASH_MINUTES),
      step(1, '鍋を火にかけて炊く（沸いたら弱火）', boil, POT_HANDS_MINUTES, 'stovetop_burner'),
      step(2, '火を止めて蒸らす', STEAM_MINUTES, 0),
    ],
  };
}

/** 使える機器の一覧から、炊飯器を持っているかを判定する */
export const hasRiceCooker = (equipment: Pick<Equipment, 'kind' | 'isAvailable' | 'slots'>[]) =>
  equipment.some((e) => e.kind === 'rice_cooker' && e.isAvailable === 1 && e.slots > 0);
