import type { AllergenTag, CookingMode, Macros, Recipe, Yen } from '@/db/schema';

/** 1品を何バッチ作るか */
export interface PlanItem {
  recipe: Recipe;
  batches: number;
  /** batches × servings。カバーする食数で割って1食あたりに配分する */
  totalServings: number;
}

export interface WeekPlanCandidate {
  mains: PlanItem[];
  sides: PlanItem[];
  /** 1食あたりのごはんの量（人数分）。0 なら主食なし */
  riceServings: number;
  ricePlan?: PlanItem;
  /** 1食あたりの栄養（ごはん込み） */
  perMeal: Macros;
  /** 目標との乖離（0 が完全一致） */
  deviation: number;
  estimatedCostYen: Yen;
  /** 作り置きにかかる素の合計時間（分）。並行調理で短縮される前の値 */
  rawMinutes: number;
  /** 人が手を動かす合計時間（分）。並行調理でもこれ以下にはならない */
  handsOnMinutes: number;
  score: number;
  /** なぜこの案なのかの説明。UI にそのまま出す */
  notes: string[];
}

export interface SolveInput {
  recipes: Recipe[];
  /** カバーする食数（人数 × 日数 × 枠数） */
  meals: number;
  /** 1食あたりの目標栄養 */
  target: Macros;
  budgetYen: Yen;
  maxPrepMinutes: number;
  maxRecipesPerWeek: number;
  maxFridgeDays: number;
  allowFreezing: boolean;
  /** 絶対に含めない食材ID（アレルゲン・除外） */
  bannedIngredientIds: Set<string>;
  /**
   * 避けるアレルゲン。レシピの `allergens`（材料から集計済み）と突き合わせる。
   * 食材IDと違い、あとで食材が増えても指定し直しが要らない。
   * **どれだけ解が見つからなくても緩めない。**
   */
  bannedAllergens: Set<AllergenTag>;
  /** 苦手な食材ID → 重み(0..1) */
  dislikedIngredientIds: Map<string, number>;
  /** 直近で作ったレシピID。連続を避ける */
  recentRecipeIds: Set<string>;
  /** 「このタグの主菜を週N食」。今週の希望 */
  requiredTagMeals: { tag: string; meals: number }[];
  /**
   * 今週かならず入れる料理。**探索の出発点になる。**
   * 空なら普通に全候補から探す。
   */
  pinnedRecipeIds?: Set<string>;
  /** 今週は避けたいタグ */
  avoidTags: string[];
  /**
   * 1食あたりカロリーの許容差（0.25 なら ±25%）。
   * これを超える案は採らない。身体づくりのアプリで50%超過を黙って出すのは害。
   */
  maxKcalDeviation: number;
  /**
   * 作り方。batch はまとめて作って詰める。daily はその日に作るので
   * 「1回でまとめて何分」ではなく「1日あたり何分」で縛る。
   */
  mode: CookingMode;
  /** daily / hybrid のときの1日あたりの調理時間（分） */
  maxDailyCookMinutes: number;
  /** 調理する日数。daily では手数をこの日数で割って1日あたりを見る */
  cookDays: number;
  /** たんぱく質の許容差。身体づくりのアプリなのでカロリーとは別に縛る */
  maxProteinDeviation: number;
  /**
   * 脂質の下限（目標に対する比）。0.6 なら目標の6割を下回る案は採らない。
   *
   * カロリーとたんぱく質だけを縛ると、足りないカロリーはごはんで埋まるので
   * 「脂質が半分、炭水化物が4割増し」の案が通ってしまう。実際にそうなった。
   * 脂質はホルモンと脂溶性ビタミンに要るので、下限だけは持つ。
   * 上限は置かない（多いぶんは deviation のスコアで自然に負ける）。
   */
  minFatRatio: number;
  /**
   * 同じ主菜を何食まで載せてよいか。献立の飽きの許容範囲。
   *
   * 14食を主菜2品で埋めると、朝昼晩ずっと同じものになる。
   * どこまで同じでよいかは人によるので、こちらで決めずに設定で聞く。
   * 小さくするほど品数が増え、買い物も調理も増える。
   */
  maxSameDishMeals: number;
  /**
   * 調理時間の上限を、本人が今週の希望として明示したか。
   *
   * 既定値（設定画面の値）なら勝手に延ばしてよいが、本人が「今週は15分まで」と
   * 言ったのを黙って45分に延ばすと、時短を頼んだのに時短にならない。
   * 明示されているときは緩和の対象から外し、代わりに「何分なら組めるか」を返す。
   */
  timeCapIsExplicit: boolean;
  /**
   * レシピごとの原価の上書き（円）。
   *
   * 家にある食材を引いた「買わなければならない分」の原価。
   * これを渡すと、今週の余りを使う案が自然に安く見えて勝つ。
   * 週の途中で作り直すときと、次の週の献立で使う。無ければ estimatedCostYen。
   */
  costOverride?: Map<string, number>;
}

export interface SolveResult {
  candidates: WeekPlanCandidate[];
  /** 解が出なかった理由。UI で何を緩めればよいか示す */
  rejections: Record<string, number>;
  /**
   * 時間**以外**の条件をすべて満たす案の中で、最も短い調理時間（分）。
   * 単位は mode に合わせる（daily なら1日あたり）。
   * 「15分では組めないが18分なら組める」と具体的に言うために持つ。
   */
  minFeasibleMinutes: number | null;
}
