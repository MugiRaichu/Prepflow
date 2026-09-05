/**
 * 運動の消費カロリー。
 *
 * 前提として、これは「正確に計算できない量」である。
 * ここで出すのは母集団の平均値に基づく概算で、個人差は小さくない。
 * 数値を出すからには幅も一緒に出し、真の値だと誤解させないこと。
 *
 * METs（метabolic equivalents）は Compendium of Physical Activities の値。
 * 消費カロリー ≒ METs × 体重kg × 時間h
 * この式は安静時代謝を含むので、純粋な「運動による上乗せ」は (METs - 1) 倍が近い。
 */

export interface ExercisePreset {
  id: string;
  label: string;
  /** Compendium の METs 値 */
  mets: number;
  hint: string;
}

export const EXERCISE_PRESETS: ExercisePreset[] = [
  { id: 'weights_light', label: '筋トレ（軽め）', mets: 3.0, hint: 'マシン中心・休憩長め' },
  { id: 'weights_moderate', label: '筋トレ（ふつう）', mets: 3.5, hint: '8〜15回を複数種目' },
  { id: 'weights_hard', label: '筋トレ（追い込む）', mets: 6.0, hint: '高重量・インターバル短め' },
  { id: 'walk', label: 'ウォーキング', mets: 3.5, hint: '時速5km前後' },
  { id: 'jog', label: 'ジョギング', mets: 7.0, hint: '時速8km前後' },
  { id: 'run', label: 'ランニング', mets: 9.8, hint: '時速10km前後' },
  { id: 'bike', label: '自転車', mets: 6.8, hint: '通勤程度' },
  { id: 'swim', label: '水泳', mets: 7.0, hint: 'クロールでゆっくり' },
  { id: 'yoga', label: 'ヨガ・ストレッチ', mets: 2.5, hint: '' },
  { id: 'other', label: 'その他', mets: 4.0, hint: '中程度の運動' },
];

/**
 * 推定の不確かさ。
 * ウェアラブル端末の消費カロリー計測でさえ、最良の機種で誤差の中央値が約27%、
 * 悪い機種では9割を超える。式による推定も同程度に外れると考えるべき。
 * ここでは控えめに ±30% を幅として出す。
 */
export const KCAL_ESTIMATE_ERROR = 0.3;

export interface KcalEstimate {
  /** 中央の推定値 */
  kcal: number;
  /** 現実的にありうる下限・上限 */
  low: number;
  high: number;
}

/**
 * 運動による消費カロリーの概算。
 * 安静にしていても消費する分を引いて、「運動で上乗せされた分」を返す。
 */
export function estimateExerciseKcal(
  mets: number,
  weightKg: number,
  minutes: number,
): KcalEstimate {
  const hours = minutes / 60;
  // METs は安静時を1とする倍率なので、上乗せ分は (METs - 1)
  const kcal = Math.max(mets - 1, 0) * weightKg * hours;
  return {
    kcal: Math.round(kcal),
    low: Math.round(kcal * (1 - KCAL_ESTIMATE_ERROR)),
    high: Math.round(kcal * (1 + KCAL_ESTIMATE_ERROR)),
  };
}

export const metsOf = (id: string | undefined): number =>
  EXERCISE_PRESETS.find((p) => p.id === id)?.mets ?? 3.5;
