/**
 * 今週の希望と、希望が厳しすぎたときの緩め方。
 *
 * 「パスタを3日にしたい」のような気分は、栄養や予算と同じ重みの制約ではない。
 * だが黙って無視するのが一番悪い。ここでは次の方針を取る。
 *
 *   1. まず希望を全部かけたまま解く
 *   2. 解が無ければ、決まった順序で1段ずつ緩めて解き直す
 *   3. 何を緩めたかを必ず画面に出す
 *
 * 順序の考え方: 本人が今まさに口にした希望（パスタ3日）は後まで守る。
 * 先に譲るのは「本人が意識していない既定値」から。
 *
 * 絶対に緩めないもの:
 *   - アレルゲン・除外食材（安全）
 *   - 保存日数の上限（食品衛生）
 * この2つはどれだけ解が見つからなくても触らない。
 *
 * カロリーの許容差は緩めるが、希望の食数を減らすより「後」に置いている。
 * 身体づくりのアプリで摂取量が5割増える案を黙って出すのは、
 * 気分の希望を1日削るより害が大きい。
 */
import { solveWeek } from './solver';
import type { SolveInput, WeekPlanCandidate } from './types';

export interface WeekRequest {
  /** 「このタグの主菜を週N食」 */
  wants: { tag: string; meals: number }[];
  /** 今週は避けたいタグ */
  avoidTags: string[];
  /**
   * 今週だけ手を動かす時間を縛る（分）。**単位は作り方で変わる**。
   *
   *   まとめて作る → 作り置きする1回ぶんの上限
   *   毎日作る     → 1日あたりの上限
   *
   * 同じ「時短」でも、毎日作る人の45分と、週末にまとめる人の45分は
   * まったく別物なので、同じ数字を両方に当てない。
   */
  timeCapMinutes?: number;
}

export const EMPTY_REQUEST: WeekRequest = { wants: [], avoidTags: [] };

interface RelaxStep {
  /** 画面にそのまま出す文言 */
  label: string;
  apply: (i: SolveInput) => SolveInput;
  /** この段を使うのは、対象の制約が実際にかかっているときだけ */
  applicableWhen?: (i: SolveInput) => boolean;
}

/**
 * 緩める順序。上から順に、累積で適用する。
 * 予算を最後に置いているのは、実際にお金が出ていく唯一の制約だから。
 */
const LADDER: RelaxStep[] = [
  {
    label: '品数の上限を1品増やしました',
    apply: (i) => ({ ...i, maxRecipesPerWeek: i.maxRecipesPerWeek + 1 }),
  },
  {
    label: '苦手な食材を今週は許容しました',
    applicableWhen: (i) => i.dislikedIngredientIds.size > 0,
    apply: (i) => ({ ...i, dislikedIngredientIds: new Map() }),
  },
  {
    label: '品数の上限をさらに1品増やしました',
    apply: (i) => ({ ...i, maxRecipesPerWeek: i.maxRecipesPerWeek + 1 }),
  },
  {
    // 食数が少ないと、飽きの上限が過剰な制約になる。
    // 4食を「同じ料理は3食まで」で組むのは、品数の刻み（1バッチ4〜6食分）と合わない。
    // 同じものをもう1食食べるのは、たんぱく質を外すより軽い
    label: '同じ料理が続いてよい回数を1食ふやしました',
    applicableWhen: (i) => i.maxSameDishMeals < i.meals,
    apply: (i) => ({ ...i, maxSameDishMeals: i.maxSameDishMeals + 1 }),
  },
  {
    label: '同じ料理が続いてよい回数をさらに1食ふやしました',
    applicableWhen: (i) => i.maxSameDishMeals < i.meals,
    apply: (i) => ({ ...i, maxSameDishMeals: i.maxSameDishMeals + 1 }),
  },
  {
    label: '「避けたい」の指定を外しました',
    applicableWhen: (i) => i.avoidTags.length > 0,
    apply: (i) => ({ ...i, avoidTags: [] }),
  },
  {
    label: 'たんぱく質の許容差を ±30% に広げました',
    applicableWhen: (i) => i.maxProteinDeviation < 0.3,
    apply: (i) => ({ ...i, maxProteinDeviation: 0.3 }),
  },
  {
    label: '脂質の下限を下げました',
    applicableWhen: (i) => i.minFatRatio > 0.45,
    apply: (i) => ({ ...i, minFatRatio: 0.45 }),
  },
  {
    label: 'カロリーの許容差を ±35% に広げました',
    applicableWhen: (i) => i.maxKcalDeviation < 0.35,
    apply: (i) => ({ ...i, maxKcalDeviation: 0.35 }),
  },
  {
    label: '希望の食数を1食減らしました',
    applicableWhen: (i) => i.requiredTagMeals.some((r) => r.meals > 1),
    apply: (i) => ({
      ...i,
      requiredTagMeals: i.requiredTagMeals.map((r) => ({ ...r, meals: Math.max(r.meals - 1, 1) })),
    }),
  },
  {
    // 本人が今週の時短を指定しているときは触らない。
    // 時短を頼まれて黙って延ばすのは、頼まれたことをしないのと同じ
    label: '調理時間の上限を30分延ばしました',
    applicableWhen: (i) => !i.timeCapIsExplicit,
    apply: (i) => ({ ...i, maxPrepMinutes: i.maxPrepMinutes + 30 }),
  },
  {
    label: '希望の食数をもう1食減らしました',
    applicableWhen: (i) => i.requiredTagMeals.some((r) => r.meals > 1),
    apply: (i) => ({
      ...i,
      requiredTagMeals: i.requiredTagMeals.map((r) => ({ ...r, meals: Math.max(r.meals - 1, 1) })),
    }),
  },
  {
    label: 'カロリーの許容差を ±50% に広げました',
    applicableWhen: (i) => i.maxKcalDeviation < 0.5,
    apply: (i) => ({ ...i, maxKcalDeviation: 0.5 }),
  },
  {
    // 最後の手段。ここまで来たら「同じものが続く」より「組めない」ほうが困る
    label: '同じ料理が続く回数の上限を外しました',
    applicableWhen: (i) => i.maxSameDishMeals < i.meals,
    apply: (i) => ({ ...i, maxSameDishMeals: i.meals }),
  },
  {
    label: '予算を1割ふやしました',
    apply: (i) => ({ ...i, budgetYen: Math.round(i.budgetYen * 1.1) }),
  },
  {
    label: '希望の指定を今週は見送りました',
    applicableWhen: (i) => i.requiredTagMeals.length > 0,
    apply: (i) => ({ ...i, requiredTagMeals: [] }),
  },
  {
    label: '予算をさらに1割ふやしました',
    apply: (i) => ({ ...i, budgetYen: Math.round(i.budgetYen * 1.1) }),
  },
];

export interface RelaxedResult {
  candidates: WeekPlanCandidate[];
  /** 適用した緩和。空なら希望どおり */
  relaxations: string[];
  /** 緩めきっても解が無かったときの内訳 */
  rejections: Record<string, number>;
  /** 予算を超えた場合の実際の上限。画面で警告する */
  budgetUsedYen: number;
  /**
   * 時間以外はすべて満たせる案の最短時間（分）。
   * 時短の希望が厳しすぎたとき、「何分なら組めるか」を画面で示すために使う。
   */
  minFeasibleMinutes: number | null;
  /**
   * 実際に使われた「同じ料理が続いてよい回数」。緩和されていれば元の設定より大きい。
   *
   * 日別の割り振り（distribute）にも同じ値を渡さないと、
   * ソルバーが4食ぶんとして組んだ案を3食にしか配れず、**最後の食が空になる**。
   * 実際にそうなった（最終日がごはんだけ）。
   */
  maxSameDishMeals: number;
}

/** 希望をかけて解き、駄目なら段階的に緩める */
export function solveWithRequest(base: SolveInput): RelaxedResult {
  let input = base;
  const applied: string[] = [];
  let minFeasible: number | null = null;

  for (let step = 0; step <= LADDER.length; step++) {
    const r = solveWeek(input);
    if (r.minFeasibleMinutes != null) {
      minFeasible =
        minFeasible == null ? r.minFeasibleMinutes : Math.min(minFeasible, r.minFeasibleMinutes);
    }
    if (r.candidates.length > 0) {
      return {
        candidates: r.candidates,
        relaxations: [...applied],
        rejections: r.rejections,
        budgetUsedYen: input.budgetYen,
        minFeasibleMinutes: minFeasible,
        maxSameDishMeals: input.maxSameDishMeals,
      };
    }
    // 詰まっている理由が時間だけなら、そこで止める。
    // minFeasibleMinutes が付いているということは、時間**以外**は全部満たす案が
    // 実在したという意味なので、予算やカロリーを緩めても答えは変わらない。
    // 本人が時短を指定しているのだから、返すべきは「予算を2割増やしました」ではなく
    // 「何分なら組めるか」。緩和を続けるのは無駄で、しかも遅い
    if (input.timeCapIsExplicit && r.minFeasibleMinutes != null) {
      return {
        candidates: [],
        relaxations: [...applied],
        rejections: r.rejections,
        budgetUsedYen: input.budgetYen,
        minFeasibleMinutes: minFeasible,
        maxSameDishMeals: input.maxSameDishMeals,
      };
    }
    const next = LADDER[step];
    if (!next) {
      return {
        candidates: [],
        relaxations: [...applied],
        rejections: r.rejections,
        budgetUsedYen: input.budgetYen,
        minFeasibleMinutes: minFeasible,
        maxSameDishMeals: input.maxSameDishMeals,
      };
    }
    // 効かない緩和は記録しない（「苦手食材を許容」を苦手ゼロの人に見せない）
    if (next.applicableWhen && !next.applicableWhen(input)) continue;
    input = next.apply(input);
    applied.push(next.label);
  }

  return {
    candidates: [],
    relaxations: applied,
    rejections: {},
    budgetUsedYen: input.budgetYen,
    minFeasibleMinutes: minFeasible,
    maxSameDishMeals: input.maxSameDishMeals,
  };
}

/**
 * 希望を SolveInput の形に落とす。
 *
 * 時間の希望だけは、当てる先が作り方で変わる。
 * 毎日作る人に「まとめて45分」を課しても何も起きない（daily の判定は
 * 1日あたりの時間しか見ていない）ので、mode で当て先を切り替える。
 */
export function applyRequest(base: SolveInput, req: WeekRequest): SolveInput {
  const out: SolveInput = {
    ...base,
    requiredTagMeals: req.wants.filter((w) => w.meals > 0),
    avoidTags: req.avoidTags,
  };
  const cap = req.timeCapMinutes;
  if (!cap) return out;

  out.timeCapIsExplicit = true;
  if (base.mode === 'daily') {
    out.maxDailyCookMinutes = Math.min(base.maxDailyCookMinutes, cap);
  } else {
    out.maxPrepMinutes = Math.min(base.maxPrepMinutes, cap);
  }
  return out;
}
