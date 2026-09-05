/**
 * オンボーディングの選択肢。すべてタップで選べる粒度に刻む（D-009）。
 * ここに出す値は「よくある値」であって、正解ではない。全部あとから変えられる。
 */
import type { ChipOption } from '@/components/shared/Chips';
import type { ActivityLevel, DietGoal, Sex, StoreSection } from '@/db/schema';

export const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
  { value: 'unspecified', label: '答えない' },
];

export const GOAL_OPTIONS: ChipOption<DietGoal>[] = [
  { value: 'cut', label: '減量', hint: '体脂肪を落とす' },
  { value: 'maintain', label: '維持', hint: '今の体型を保つ' },
  { value: 'bulk', label: '増量', hint: '筋肉を増やす' },
];

export const ACTIVITY_OPTIONS: ChipOption<ActivityLevel>[] = [
  { value: 'sedentary', label: 'ほぼ座り', hint: 'デスクワーク中心' },
  { value: 'light', label: '軽い運動', hint: '週1〜3回' },
  { value: 'moderate', label: 'よく動く', hint: '週3〜5回' },
  { value: 'active', label: '毎日運動', hint: '週6〜7回' },
];

/** 年齢は5歳刻み。1歳単位の精度は基礎代謝の推定誤差に埋もれる */
export const AGE_OPTIONS: ChipOption<number>[] = [
  20, 25, 30, 35, 40, 45, 50, 55, 60,
].map((a) => ({ value: a, label: String(a) + '代' }));

/** 週の食費。3,000〜10,000 円で刻む */
export const BUDGET_OPTIONS: ChipOption<number>[] = [
  3000, 4000, 5000, 6000, 8000, 10000,
].map((b) => ({ value: b, label: '¥' + b.toLocaleString('ja-JP') }));

/** 電子レンジの出力 */
export const WATTAGE_OPTIONS: ChipOption<number>[] = [500, 600, 700, 1000].map((w) => ({
  value: w,
  label: String(w) + 'W',
}));

/**
 * 「よくある器具構成」。1タップで一括登録するためのプリセット（D-015）。
 * ひとつずつ登録させると、ここで離脱する。
 */
export interface EquipmentPreset {
  id: string;
  label: string;
  hint: string;
  items: {
    kind: import('@/db/schema').EquipmentKind;
    name: string;
    slots: number;
    wattage?: number;
  }[];
}

export const EQUIPMENT_PRESETS: EquipmentPreset[] = [
  {
    id: 'minimal',
    label: 'ミニマル',
    hint: 'レンジ + コンロ1口',
    items: [
      { kind: 'microwave', name: '電子レンジ', slots: 1, wattage: 600 },
      { kind: 'ih_burner', name: 'コンロ', slots: 1 },
    ],
  },
  {
    id: 'standard',
    label: 'ふつう',
    hint: 'レンジ + コンロ2口 + 炊飯器',
    items: [
      { kind: 'microwave', name: '電子レンジ', slots: 1, wattage: 600 },
      { kind: 'stovetop_burner', name: 'コンロ', slots: 2 },
      { kind: 'rice_cooker', name: '炊飯器', slots: 1 },
    ],
  },
  {
    id: 'full',
    label: '充実',
    hint: 'レンジ + コンロ3口 + 炊飯器 + オーブン',
    items: [
      { kind: 'microwave', name: '電子レンジ', slots: 1, wattage: 600 },
      { kind: 'stovetop_burner', name: 'コンロ', slots: 3 },
      { kind: 'rice_cooker', name: '炊飯器', slots: 1 },
      { kind: 'oven', name: 'オーブン', slots: 1 },
    ],
  },
];

/** 容器は「だいたい何個あるか」だけ聞く。サイズは既定でよい */
export interface ContainerPreset {
  id: string;
  label: string;
  hint: string;
  count: number;
  volumeMl: number;
}

export const CONTAINER_PRESETS: ContainerPreset[] = [
  { id: 'none', label: '持っていない', hint: 'あとで買う', count: 0, volumeMl: 500 },
  { id: 'few', label: '3個くらい', hint: '数日分', count: 3, volumeMl: 500 },
  { id: 'many', label: 'たくさん', hint: '10個以上', count: 10, volumeMl: 500 },
];

/** 店内動線の既定順（表示用）。設定で並べ替えられる */
export const SECTION_ORDER_HINT: StoreSection[] = [
  'produce',
  'meat_fish',
  'daily_chilled',
  'dry_grocery',
  'seasoning',
];
