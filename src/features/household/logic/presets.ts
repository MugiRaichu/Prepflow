/**
 * ライフステージのプリセット。
 *
 * 生活が変わると、作り方そのものを変える必要がある。
 * 育休で家にいる期間に「週末まとめて作る」を続けるのは合理的でないし、
 * 復帰したら逆になる。ここでは1タップでその切り替えを済ませる。
 *
 * 適用するのは設定であって、献立ではない。何が変わるかを画面に出してから適用する。
 */
import type { CookingModeConfig, LifeStage, MealSlot, Weekday } from '@/db/schema';

export interface LifeStagePreset {
  stage: LifeStage;
  label: string;
  hint: string;
  cooking: CookingModeConfig;
  coverSlots: MealSlot[];
  coverDays: number;
  /** 一時的な状態か。育休のように「いつか戻る」ものは期限を促す */
  temporary?: boolean;
}

const WEEKEND: Weekday[] = [0];

export const LIFE_STAGE_PRESETS: LifeStagePreset[] = [
  {
    stage: 'single',
    label: '一人暮らし',
    hint: '週末にまとめて作る',
    cooking: {
      mode: 'batch',
      batchDays: WEEKEND,
      dailyCookSlots: [],
      maxDailyCookMinutes: 20,
      maxBatchMinutes: 120,
    },
    coverSlots: ['dinner'],
    coverDays: 5,
  },
  {
    stage: 'couple_dual_income',
    label: '共働き',
    hint: '平日は作らない。週末に2人分',
    cooking: {
      mode: 'batch',
      batchDays: WEEKEND,
      dailyCookSlots: [],
      maxDailyCookMinutes: 15,
      maxBatchMinutes: 150,
    },
    coverSlots: ['dinner'],
    coverDays: 5,
  },
  {
    stage: 'couple_single_income',
    label: '片働き',
    hint: '夕食は当日、昼は作り置き',
    cooking: {
      mode: 'hybrid',
      batchDays: WEEKEND,
      dailyCookSlots: ['dinner'],
      maxDailyCookMinutes: 40,
      maxBatchMinutes: 90,
    },
    coverSlots: ['lunch', 'dinner'],
    coverDays: 5,
  },
  {
    stage: 'parental_leave',
    label: '育休中',
    hint: '家にいるので毎日その日に作る',
    cooking: {
      mode: 'daily',
      batchDays: [],
      dailyCookSlots: ['lunch', 'dinner'],
      maxDailyCookMinutes: 35,
      maxBatchMinutes: 60,
    },
    coverSlots: ['lunch', 'dinner'],
    coverDays: 7,
    temporary: true,
  },
  {
    stage: 'with_infant',
    label: '乳児あり',
    hint: '中断が多いので、短い手順だけ',
    cooking: {
      mode: 'hybrid',
      batchDays: WEEKEND,
      dailyCookSlots: [],
      maxDailyCookMinutes: 20,
      maxBatchMinutes: 75,
    },
    coverSlots: ['lunch', 'dinner'],
    coverDays: 5,
  },
  {
    stage: 'with_toddler',
    label: '幼児あり',
    hint: '取り分け前提。味付けは薄め',
    cooking: {
      mode: 'batch',
      batchDays: WEEKEND,
      dailyCookSlots: [],
      maxDailyCookMinutes: 25,
      maxBatchMinutes: 120,
    },
    coverSlots: ['dinner'],
    coverDays: 5,
  },
];

export const presetOf = (stage: LifeStage): LifeStagePreset | undefined =>
  LIFE_STAGE_PRESETS.find((p) => p.stage === stage);

/** 適用したときに何が変わるかを、人が読める形で並べる */
export function diffOf(
  preset: LifeStagePreset,
  current: { mode: string; coverSlots: MealSlot[]; coverDays: number; maxPrepMinutes: number },
): string[] {
  const MODE_LABEL: Record<string, string> = {
    batch: 'まとめて作る',
    daily: '毎日その日に作る',
    hybrid: '枠ごとに使い分ける',
  };
  const SLOT_LABEL: Record<MealSlot, string> = {
    breakfast: '朝',
    lunch: '昼',
    dinner: '夕',
    snack: '間食',
  };

  const out: string[] = [];
  if (preset.cooking.mode !== current.mode) {
    out.push(
      '作り方: ' + MODE_LABEL[current.mode] + ' → ' + MODE_LABEL[preset.cooking.mode],
    );
  }
  const a = current.coverSlots.map((s) => SLOT_LABEL[s]).join('');
  const b = preset.coverSlots.map((s) => SLOT_LABEL[s]).join('');
  if (a !== b) out.push('カバーする食事: ' + a + ' → ' + b);
  if (preset.coverDays !== current.coverDays) {
    out.push('何日分: ' + current.coverDays + '日 → ' + preset.coverDays + '日');
  }
  const nextMinutes =
    preset.cooking.mode === 'daily' ? preset.cooking.maxDailyCookMinutes : preset.cooking.maxBatchMinutes;
  if (nextMinutes !== current.maxPrepMinutes) {
    out.push('1回の調理時間: ' + current.maxPrepMinutes + '分 → ' + nextMinutes + '分');
  }
  return out;
}
