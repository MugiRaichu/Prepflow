/**
 * 栄養計算。LLM は使わない（→ 決定記録 D-011 / D-018）。
 *
 * 目標PFCは「ユーザーが決める値」ではなく「体のデータと目的から計算される値」。
 * 設定画面にタンパク質のグラム数を入力させる欄は置かない。
 *
 * 精度について: Mifflin-St Jeor の推定には個人差が±10%程度ある。
 * 初期値の精度は重要ではなく、2〜4週間の体重推移で補正するのが本筋
 * （ActivitySample と WeekPlan.calorieAdjustFactor がその役割）。
 */
import type {
  ActivityLevel,
  DietGoal,
  Kcal,
  LifeStageAdjust,
  Macros,
  Profile,
  Sex,
} from '@/db/schema';

// --- 係数 -------------------------------------------------------------------

/** 活動量係数（BMR に掛ける） */
export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,   // 座り仕事・運動なし
  light: 1.375,     // 軽い運動 週1〜3
  moderate: 1.55,   // 中程度 週3〜5
  active: 1.725,    // 高い 週6〜7
};

/**
 * 目的によるカロリー係数。
 *
 * 割合だけで決めると、TDEE が小さい人ほど増減が足りなくなる。
 * TDEE 1,800 kcal の人の +10% は +180 kcal で、増量にはまるで足りない
 * （体重を増やすのに必要なのは概ね +300〜500 kcal/日）。
 * 割合と絶対量の**厳しいほう**を採る。
 */
export const GOAL_KCAL_FACTOR: Record<DietGoal, number> = {
  cut: 0.8,
  maintain: 1.0,
  bulk: 1.15,
};

/**
 * 目的による絶対量の増減（kcal/日）。割合と併用して、下限（増量）
 * ないし上限（減量）を保証する。
 *
 * 増量 +300: 除脂肪を狙う増量の一般的な下限。これ未満だと体重が動かない
 * 減量 -400: 週あたり約0.4kgの減少に相当。-500 を超えると筋量が落ちやすい
 */
export const GOAL_KCAL_DELTA: Record<DietGoal, number> = {
  cut: -400,
  maintain: 0,
  bulk: 300,
};

/** 目的によるタンパク質量（体重1kgあたりg）。減量時に高くするのは筋量維持のため */
export const GOAL_PROTEIN_PER_KG: Record<DietGoal, number> = {
  cut: 2.0,
  maintain: 1.6,
  bulk: 1.8,
};

/** 脂質は総カロリーのこの割合。ホルモン維持のため下限も設ける */
export const FAT_KCAL_RATIO = 0.25;
export const FAT_FLOOR_PER_KG = 0.7;

const KCAL_PER_G = { protein: 4, fat: 9, carb: 4 } as const;

// --- 既定値（オンボーディングをスキップしても動くように） -------------------

export const DEFAULT_BODY = {
  heightCm: 170,
  weightKg: 65,
  birthYear: new Date().getFullYear() - 30,
  sex: 'unspecified' as Sex,
};

// --- 計算 -------------------------------------------------------------------

/** Mifflin-St Jeor 式による基礎代謝(kcal/日) */
export function basalMetabolicRate(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}): Kcal {
  const { sex, weightKg, heightCm, ageYears } = input;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  // unspecified は男女の中間（+5 と -161 の平均 = -78）
  const offset = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  return base + offset;
}

/** 総消費カロリー(kcal/日) */
export function totalDailyEnergy(bmr: Kcal, activity: ActivityLevel): Kcal {
  return bmr * ACTIVITY_FACTOR[activity];
}

export interface TargetInput {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
  activityLevel: ActivityLevel;
  goal: DietGoal;
  lifeStageAdjust?: LifeStageAdjust;
  /**
   * 「いつまでに何kg」から出した1日あたりの増減（kcal）。減量なら負。
   * 入っていれば goal の既定の増減幅より優先する（weightPace で出す）。
   */
  paceKcalPerDay?: number;
}

/**
 * 目標PFC・カロリーを算出する。
 * 減量時でも基礎代謝を下回らせない（極端な設定の事故防止）。
 */
export function calcTargets(input: TargetInput): Macros {
  const bmr = basalMetabolicRate(input);
  const tdee = totalDailyEnergy(bmr, input.activityLevel);

  const extraKcal = input.lifeStageAdjust?.extraKcal ?? 0;
  const extraProteinG = input.lifeStageAdjust?.extraProteinG ?? 0;

  /*
   * 目標カロリー。
   *
   * **「いつまでに何kg」が入っていれば、そちらを使う。**
   * 本人が期限まで決めているのに、既定の増減幅（-400 / +300）で上書きするのは
   * 数字を勝手に変えることになる。無理のあるペースかどうかは画面で伝える。
   *
   * 入っていなければ、割合と絶対量の厳しいほうを採る
   * （増量なら多いほう、減量なら少ないほう）。
   */
  const byRatio = tdee * GOAL_KCAL_FACTOR[input.goal];
  const byDelta = tdee + GOAL_KCAL_DELTA[input.goal];
  const goalKcal =
    input.paceKcalPerDay != null
      ? tdee + input.paceKcalPerDay
      : input.goal === 'bulk'
        ? Math.max(byRatio, byDelta)
        : input.goal === 'cut'
          ? Math.min(byRatio, byDelta)
          : byRatio;

  // 減量でも基礎代謝は下回らせない（極端な設定の事故防止）
  const kcal = Math.max(goalKcal, bmr) + extraKcal;

  const proteinG = input.weightKg * GOAL_PROTEIN_PER_KG[input.goal] + extraProteinG;

  const fatFromRatio = (kcal * FAT_KCAL_RATIO) / KCAL_PER_G.fat;
  const fatFloor = input.weightKg * FAT_FLOOR_PER_KG;
  const fatG = Math.max(fatFromRatio, fatFloor);

  // 残りを炭水化物に。負にならないよう 0 で止める
  const remainingKcal =
    kcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  const carbG = Math.max(remainingKcal / KCAL_PER_G.carb, 0);

  return {
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbG: Math.round(carbG),
  };
}

/** Profile から目標を再計算する。manualTargets が立っていれば触らない */
export function recalcProfileTargets(p: Profile, today = new Date().toISOString().slice(0, 10)): Macros {
  if (p.manualTargets) return p.baseTargets;
  const year = new Date().getFullYear();
  // 「いつまでに何kg」が入っていれば、そこから1日あたりの増減を出す
  const pace =
    p.goalWeightKg != null && p.goalDate
      ? weightPace(p.weightKg ?? DEFAULT_BODY.weightKg, p.goalWeightKg, p.goalDate, today)
      : null;
  return calcTargets({
    sex: p.sex ?? DEFAULT_BODY.sex,
    weightKg: p.weightKg ?? DEFAULT_BODY.weightKg,
    heightCm: p.heightCm ?? DEFAULT_BODY.heightCm,
    ageYears: year - (p.birthYear ?? DEFAULT_BODY.birthYear),
    activityLevel: p.activityLevel,
    goal: p.goal,
    ...(p.lifeStageAdjust ? { lifeStageAdjust: p.lifeStageAdjust } : {}),
    ...(pace ? { paceKcalPerDay: pace.kcalPerDay } : {}),
  });
}

/** 実績と目標の差。ダッシュボードのバー表示に使う */
export function macroProgress(actual: Macros, target: Macros) {
  const pct = (a: number, t: number) => (t > 0 ? Math.min(a / t, 1.5) : 0);
  return {
    kcal: pct(actual.kcal, target.kcal),
    protein: pct(actual.proteinG, target.proteinG),
    fat: pct(actual.fatG, target.fatG),
    carb: pct(actual.carbG, target.carbG),
  };
}

/** 複数の Macros を合算する */
export function sumMacros(list: Macros[]): Macros {
  return list.reduce<Macros>(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      proteinG: acc.proteinG + m.proteinG,
      fatG: acc.fatG + m.fatG,
      carbG: acc.carbG + m.carbG,
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
  );
}

/** 食材の栄養(可食部100gあたり) × グラム数 */
export function macrosFor(per100g: Macros, grams: number): Macros {
  const r = grams / 100;
  return {
    kcal: per100g.kcal * r,
    proteinG: per100g.proteinG * r,
    fatG: per100g.fatG * r,
    carbG: per100g.carbG * r,
  };
}

// ---------------------------------------------------------------------------
// 体重の目標（いつまでに何kg）
// ---------------------------------------------------------------------------

/**
 * 体重1kgの増減に必要なカロリー（kcal）。
 * 体脂肪1kg = 約7200kcal。増量では除脂肪も混ざるので実際はこれより軽いが、
 * 目標を甘くするより厳しめに見ておくほうが安全。
 */
export const KCAL_PER_BODY_KG = 7200;

/**
 * 無理のない1週間あたりの変化量（体重に対する割合）。
 *
 * 減量 1.0%: これを超えると筋量が落ち、続かない
 * 増量 0.5%: これを超えるとほぼ脂肪になる
 *
 * ここを超える設定は**止めない。本人が決めること**だが、
 * 何が起きるかは数字で見せる。
 */
export const SAFE_WEEKLY_RATE = { cut: 0.01, bulk: 0.005 };

export interface WeightPace {
  /** 1日あたりの増減（kcal）。減量なら負 */
  kcalPerDay: number;
  /** 1週間あたりの体重変化（kg）。減量なら負 */
  kgPerWeek: number;
  /** 無理のない範囲か */
  safe: boolean;
  /** 無理のない範囲で行ったときにかかる日数 */
  safeDays: number;
  /** 目標までの日数 */
  days: number;
}

/**
 * 目標体重と期限から、1日あたりの増減を出す。
 * 期限が過ぎている・体重差が無い場合は null（既定の増減幅に任せる）。
 */
export function weightPace(
  weightKg: number,
  goalWeightKg: number,
  goalDate: string,
  today: string,
): WeightPace | null {
  const days = Math.round(
    (new Date(goalDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000,
  );
  const diff = goalWeightKg - weightKg;
  if (days <= 0 || Math.abs(diff) < 0.1) return null;

  const kcalPerDay = (diff * KCAL_PER_BODY_KG) / days;
  const kgPerWeek = (diff / days) * 7;

  const limit = weightKg * (diff < 0 ? SAFE_WEEKLY_RATE.cut : SAFE_WEEKLY_RATE.bulk);
  const safe = Math.abs(kgPerWeek) <= limit + 1e-6;
  const safeDays = Math.ceil((Math.abs(diff) / limit) * 7);

  return { kcalPerDay, kgPerWeek, safe, safeDays, days };
}
