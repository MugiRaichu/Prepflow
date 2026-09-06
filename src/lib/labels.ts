/**
 * enum 値 → 日本語ラベル。UI 専用。DB には英字キーのまま保存する。
 */
import type {
  AllergenTag,
  ConstraintKind,
  RecipeRole,
  ContainerMaterial,
  EquipmentKind,
  MealSlot,
  StoreSection,
  Weekday,
  AiRouteMode,
} from '@/db/schema';

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: '日',
  1: '月',
  2: '火',
  3: '水',
  4: '木',
  5: '金',
  6: '土',
};

export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  microwave: '電子レンジ',
  oven: 'オーブン',
  oven_toaster: 'オーブントースター',
  stovetop_burner: 'ガスコンロ',
  ih_burner: 'IH コンロ',
  rice_cooker: '炊飯器',
  pressure_cooker: '圧力鍋（電気）',
  air_fryer: 'エアフライヤー',
  slow_cooker: 'スロークッカー',
  kettle: '電気ケトル',
  blender: 'ミキサー',
  hand_mixer: 'ハンドブレンダー',
  food_processor: 'フードプロセッサー',
  shaker: 'シェイカー',
  fridge: '冷蔵庫',
  freezer: '冷凍庫',
  other: 'その他',
};

export const CONTAINER_MATERIAL_LABELS: Record<ContainerMaterial, string> = {
  plastic: 'プラスチック',
  glass: 'ガラス',
  stainless: 'ステンレス',
  silicone: 'シリコン',
  zipper_bag: 'ジッパー袋',
  other: 'その他',
};

export const STORE_SECTION_LABELS: Record<StoreSection, string> = {
  produce: '野菜・果物',
  meat_fish: '精肉・鮮魚',
  daily_chilled: '日配品',
  dry_grocery: '乾物・米・麺',
  seasoning: '調味料',
  frozen: '冷凍',
  bakery: 'パン',
  beverage: '飲料',
  other: 'その他',
};

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: '朝',
  lunch: '昼',
  dinner: '夕',
  snack: '間食',
};

/** 食事枠の正しい並び。タップした順ではなくこの順に揃える */
export const MEAL_SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const sortSlots = (slots: MealSlot[]): MealSlot[] =>
  [...slots].sort((a, b) => MEAL_SLOT_ORDER.indexOf(a) - MEAL_SLOT_ORDER.indexOf(b));

export const CONSTRAINT_KIND_LABELS: Record<ConstraintKind, string> = {
  allergen: 'アレルゲン',
  exclude: '除外',
  dislike: '苦手',
  prefer: '好き',
};

export const ROUTE_MODE_LABELS: Record<AiRouteMode, string> = {
  local_first: '軽い質問は端末内、重い生成はクラウド',
  cloud_first: '通信できるときは常にクラウド',
  local_only: '端末内のみ（クラウドを呼ばない）',
  cloud_only: 'クラウドのみ',
};

export const RECIPE_ROLE_LABELS: Record<RecipeRole, string> = {
  main: '主菜',
  side: '副菜',
  staple: '主食',
  snack: '間食',
};

export const yen = (n: number | undefined) =>
  n == null ? '—' : `¥${Math.round(n).toLocaleString('ja-JP')}`;

export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const formatDateJa = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY_LABELS[d.getDay() as Weekday]}）`;
};

/**
 * アレルゲンの表示名。
 *
 * 並びは食品表示法の区分に合わせる。表示義務のある8品目（特定原材料）を先に、
 * 推奨の20品目（準ずるもの）を後に置く。区切りは MANDATORY_ALLERGENS の件数。
 * 「そば」「落花生」「かに」「あわび」「いくら」は該当する食材をまだ持っていないが、
 * 自分でレシピを足したときに効くので選択肢としては出す。
 */
export const ALLERGEN_LABELS: Record<AllergenTag, string> = {
  egg: '卵',
  milk: '乳',
  wheat: '小麦',
  buckwheat: 'そば',
  peanut: '落花生',
  shrimp: 'えび',
  crab: 'かに',
  walnut: 'くるみ',
  soy: '大豆',
  sesame: 'ごま',
  cashew: 'カシューナッツ',
  almond: 'アーモンド',
  squid: 'いか',
  salmon: 'さけ',
  mackerel: 'さば',
  beef: '牛肉',
  pork: '豚肉',
  chicken: '鶏肉',
  gelatin: 'ゼラチン',
  orange: 'オレンジ',
  kiwi: 'キウイ',
  peach: 'もも',
  apple: 'りんご',
  banana: 'バナナ',
  yam: 'やまいも',
  matsutake: 'まつたけ',
};

/** 表示義務のある8品目（特定原材料）。誤食の結果が重いので上に出す */
export const MANDATORY_ALLERGENS: AllergenTag[] = [
  'egg', 'milk', 'wheat', 'buckwheat', 'peanut', 'shrimp', 'crab', 'walnut',
];

/** 表示が推奨される品目（特定原材料に準ずるもの） */
export const OPTIONAL_ALLERGENS: AllergenTag[] = [
  'soy', 'sesame', 'cashew', 'almond', 'squid', 'salmon', 'mackerel',
  'beef', 'pork', 'chicken', 'gelatin', 'orange', 'kiwi', 'peach',
  'apple', 'banana', 'yam', 'matsutake',
];
