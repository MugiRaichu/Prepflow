/**
 * Prepflow — IndexedDB スキーマ（型定義）
 *
 * 設計方針
 * 1. ユーザー固有値は一切ハードコードしない。すべてこのスキーマ上のレコードとして保持する。
 * 2. IndexedDB は boolean をインデックスキーにできない。インデックス対象の真偽値は `Bool`(0|1) を使う。
 * 3. 将来のエクスポート／端末間マージに備え、主キーは自動連番ではなく UUID 文字列とする。
 * 4. 物理削除ではなく `deleted` フラグ（ソフト削除）。undefined はインデックスされないため 0|1 で持つ。
 * 5. 数量は g / ml に正規化して保存し、「大さじ1」等は表示用文字列として別に持つ。
 * 6. オフラインで表示だけしたい項目（食材名など）は意図的に非正規化コピーを持つ。
 */

// ---------------------------------------------------------------------------
// 基本スカラ
// ---------------------------------------------------------------------------

export type UUID = string;
/** 'YYYY-MM-DD'（ローカル日付。日付比較・インデックス用に文字列固定） */
export type ISODate = string;
/** ISO 8601 UTC 文字列 */
export type ISODateTime = string;
/** 'HH:mm' */
export type TimeOfDay = string;

export type Grams = number;
export type Milliliters = number;
export type Kcal = number;
export type Yen = number;
export type Seconds = number;

/** IndexedDB のインデックス対象になる真偽値 */
export type Bool = 0 | 1;

/** 0=日曜 … 6=土曜 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Entity {
  id: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** ソフト削除 */
  deleted: Bool;
  /** 楽観ロック／将来の差分同期用 */
  rev: number;
}

// ---------------------------------------------------------------------------
// 栄養
// ---------------------------------------------------------------------------

export interface Macros {
  kcal: Kcal;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG?: number;
  /** 食塩相当量 */
  saltEqG?: number;
}

/** 可食部100gあたり（日本食品標準成分表の粒度に合わせる） */
export type NutritionPer100g = Macros;

/** 目標値からの許容誤差（%）。AI生成時の制約緩和順序にも使う */
export interface MacroTolerance {
  kcalPct: number;
  proteinPct: number;
  fatPct: number;
  carbPct: number;
}

// ---------------------------------------------------------------------------
// 1. プロファイル（複数人・個別管理）
// ---------------------------------------------------------------------------

export type Sex = 'male' | 'female' | 'unspecified';

/**
 * 嗜好・アレルゲンのタグ。
 * `allergen` / `exclude` はハード制約（絶対に含めない）、
 * `dislike` / `prefer` はソフト制約（weight で重み付け）。
 * この区別が AI プロンプト側の「破ってよい制約／破ってはいけない制約」に直結する。
 */
export type ConstraintKind = 'allergen' | 'exclude' | 'dislike' | 'prefer';

export interface PreferenceTag {
  id: UUID;
  kind: ConstraintKind;
  /** 表示名 例: 'えび' */
  label: string;
  /** 表記ゆれ・別名 例: ['海老', 'エビ', 'むきえび'] */
  aliases: string[];
  /** マスタ食材に確定紐付けできる場合 */
  ingredientIds?: UUID[];
  /** dislike / prefer のみ有効。0.0（弱）〜1.0（強） */
  weight?: number;
  note?: string;
}

/** 活動量による翌週カロリー補正の設定 */
export interface ActivityAdjustConfig {
  enabled: boolean;
  /** 1歩あたり消費kcal。既定 0.04（体重60kg前提の概算） */
  kcalPerStep: number;
  /** 何日分の実績を見て補正するか */
  lookbackDays: number;
  /** 補正の上限（±%）。暴走防止のクリップ */
  maxAdjustPct: number;
  /** 補正をカロリーだけに効かせるか、炭水化物量にも配分するか */
  applyTo: 'kcal_only' | 'kcal_and_carb';
  /** データの入り口 */
  source: 'manual' | 'healthkit_export' | 'google_fit' | 'csv';
}

export interface Profile extends Entity {
  name: string;
  isActive: Bool;
  sex?: Sex;
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
  /**
   * 目標の入力値。体重が変わったら baseTargets を再計算するために保持する。
   * ユーザーが数値を直接いじった場合は manualTargets を立てて再計算を止める。
   */
  goal: DietGoal;
  /**
   * いつまでに何kgか。
   *
   * 「減量」だけでは1日の増減幅が決まらない。3kg落とすのに1か月と半年では
   * 必要な赤字がまるで違う。期限を持って初めて、1日あたりの数字が出せる。
   * 未設定なら goal の既定の増減幅（GOAL_KCAL_DELTA）を使う。
   */
  goalWeightKg?: number;
  goalDate?: ISODate;
  activityLevel: ActivityLevel;
  manualTargets?: boolean;
  /** 基準となる目標PFC・カロリー（活動量補正の適用前）。goal から自動計算される */
  baseTargets: Macros;
  tolerance: MacroTolerance;
  /** 1日の食事枠数（間食含む） */
  mealsPerDay: number;
  /** この人が食べるのは平日夕食だけ、等の限定 */
  activeSlots: MealSlot[];
  activityAdjust: ActivityAdjustConfig;
  preferences: PreferenceTag[];
  /**
   * 避けるアレルゲン。**食材ではなくアレルゲンで持つ。**
   *
   * 食材IDで持つと、あとで食材を足すたびに指定し直しになる。
   * 食材マスタ側が `allergens` を持っているので、タグで指定しておけば
   * 新しい食材にも自動でかかる。レシピの `allergens` は材料から集計済み。
   *
   * これはハード制約で、どれだけ解が見つからなくても緩めない。
   */
  allergens?: AllergenTag[];
  /** 同一レシピを週に何回まで許すか（飽き対策のハード上限） */
  maxSameRecipePerWeek: number;
  /** 0=辛さ不可 … 3=強い辛さ可 */
  spiceTolerance?: 0 | 1 | 2 | 3;

  // --- 世帯・ライフステージ（v0.5〜） -------------------------------------
  householdId?: UUID;
  role: ProfileRole;
  /**
   * 大人の献立からの取り分け比率（0.0〜1.0）。子供用。
   * 別メニューを作るのではなく同じ鍋から取り分ける前提。
   */
  portionRatio?: number;
  /** 味付け前に取り分ける必要があるか（幼児の減塩）。手順の分岐を生む */
  needsMildSeasoning?: boolean;
  /** 妊娠・授乳などの付加量。baseTargets に加算する */
  lifeStageAdjust?: LifeStageAdjust;
  notes?: string;
}

/** 食べる人の区分。必要量・減塩・取り分けの扱いが変わる */
export type ProfileRole = 'adult' | 'school_child' | 'toddler' | 'infant';

/** 目的。摂取カロリーとタンパク質量の係数を決める */
export type DietGoal = 'cut' | 'maintain' | 'bulk';

/** 活動量。Mifflin-St Jeor の BMR に掛ける係数を決める */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';

/** 妊娠・授乳期の付加量（日本人の食事摂取基準の付加量に相当する枠） */
export interface LifeStageAdjust {
  kind: 'none' | 'pregnancy_early' | 'pregnancy_mid' | 'pregnancy_late' | 'lactation';
  extraKcal: Kcal;
  extraProteinG: number;
  /** 期限。育休と同じく「戻し忘れ」を防ぐ */
  until?: ISODate;
}

// ---------------------------------------------------------------------------
// 1b. 世帯とライフステージ（v0.4〜0.5）
// ---------------------------------------------------------------------------

/**
 * 調理のやり方。ライフステージで変わる前提で、いつでも切り替えられる。
 * - batch  : 週末にまとめて作り、平日は詰めたものを食べる
 * - daily  : 毎日その日に作る（育休中・在宅など、時間がある期間）
 * - hybrid : 平日夕食だけ作り置き、週末は当日調理、など枠ごとに使い分け
 */
export type CookingMode = 'batch' | 'daily' | 'hybrid';

export interface CookingModeConfig {
  mode: CookingMode;
  /** batch / hybrid のとき、作り置きをする曜日 */
  batchDays: Weekday[];
  /** hybrid のとき、当日調理にする食事枠 */
  dailyCookSlots: MealSlot[];
  /** 平日1日あたりに割ける調理時間の上限 */
  maxDailyCookMinutes: number;
  /** 作り置き1回に割ける時間の上限 */
  maxBatchMinutes: number;
}

/**
 * ライフステージのプリセット。設定を一括で切り替えるための入口で、
 * 実際の値は CookingModeConfig とプロファイル側に落ちる。
 */
export type LifeStage =
  | 'single'
  | 'couple_dual_income'    // 共働き（既定の想定）
  | 'couple_single_income'
  | 'parental_leave'        // 育休中。家にいるので daily 寄り
  | 'with_infant'           // 乳児あり
  | 'with_toddler'          // 幼児あり。取り分け・減塩が要る
  | 'with_school_child'
  | 'multi_generation'
  | 'custom';

/**
 * 世帯。ライフステージは時間とともに変わるので履歴として持つ。
 * activeUntil を持たせるのは「育休中の設定に戻し忘れる」事故を防ぐため。
 */
export interface Household extends Entity {
  name: string;
  lifeStage: LifeStage;
  cooking: CookingModeConfig;
  activeFrom: ISODate;
  /** 一時的な状態（育休など）の終了予定日。過ぎたら見直しを促す */
  activeUntil?: ISODate;
  /** 有効な世帯は常に1つ。切替時に前のものを 0 にする */
  isCurrent: Bool;
  note?: string;
}

// ---------------------------------------------------------------------------
// 1d. 生活リズム（起床・就寝・習慣）
// ---------------------------------------------------------------------------

export type HabitKind = 'training' | 'commute' | 'work' | 'bath' | 'study' | 'other';

/** 毎週きまってやること。スケジュールの骨組みになる */
export interface Habit extends Entity {
  name: string;
  kind: HabitKind;
  days: Weekday[];
  startTime: TimeOfDay;
  durationMin: number;
  /** 動かせない予定か。通勤は動かせないが、トレーニングは動かせる */
  fixed: boolean;
  /** kind === 'training' のとき、運動の種類（消費カロリーの概算に使う） */
  exerciseId?: string;
}

/**
 * 1日の骨格。ここから食事とタンパク質の時刻を逆算する。
 * 時刻そのものより「毎日同じであること」のほうが効くので、曜日別には持たない。
 */
export interface DailyRhythm {
  wakeTime: TimeOfDay;
  sleepTime: TimeOfDay;
  /** カフェインを摂るか。摂るなら締切時刻を出す */
  caffeine: boolean;
  /** 就寝前にタンパク質を足すか */
  preSleepProtein: boolean;
}

// ---------------------------------------------------------------------------
// 1c. 予定と調理可能時間（v0.6）
// ---------------------------------------------------------------------------

/**
 * その日の「料理に使える時間」。献立を決めるハード制約になる。
 * Google カレンダーから推定するか、手で入れるか、既定値を使う。
 */
export interface DaySchedule extends Entity {
  date: ISODate;
  /** 誰の予定か。世帯共通なら undefined */
  profileId?: UUID;
  /** 帰宅時刻 */
  homeAt?: TimeOfDay;
  /** その日に調理へ割ける分数。0 なら「温めるだけ」しか選べない */
  availableCookMinutes: number;
  /** 外食・欠食が決まっている枠 */
  skipSlots: MealSlot[];
  source: 'manual' | 'google_calendar' | 'default';
  /** 由来イベント。再同期時の突合に使う */
  calendarEventIds?: string[];
}

/** 夕方に出す提案。1つに決めず何通りか出して、押すだけで確定させる */
export interface DailySuggestion extends Entity {
  date: ISODate;
  options: SuggestionOption[];
  chosenIndex?: number;
  /** LINE へ送った時刻 */
  pushedAt?: ISODateTime;
}

export interface SuggestionOption {
  /** 例: '温めるだけ（5分）' */
  label: string;
  kind: 'reheat' | 'quick_cook' | 'cook_fresh' | 'eat_out';
  estimatedMinutes: number;
  /** reheat のとき、どの容器を出すか */
  containerAssignmentIds?: UUID[];
  recipeId?: UUID;
  nutrition: Macros;
  costYen?: Yen;
  /** 例: 'カレンダーで21時帰宅のため' — なぜこの案かを必ず添える */
  reason: string;
}

// ---------------------------------------------------------------------------
// 2. 設備・調理器具
// ---------------------------------------------------------------------------

export type EquipmentKind =
  | 'microwave'
  | 'oven'
  | 'oven_toaster'
  | 'stovetop_burner'
  | 'ih_burner'
  | 'rice_cooker'
  | 'pressure_cooker'
  | 'air_fryer'
  | 'slow_cooker'
  | 'kettle'
  | 'blender'
  | 'hand_mixer'
  | 'food_processor'
  | 'shaker'
  | 'fridge'
  | 'freezer'
  | 'other';

/**
 * 並行調理のボトルネック計算はこのテーブルが根拠になる。
 * `slots` が同時実行可能数（電子レンジ1台なら1、コンロ3口なら3）。
 */
export interface Equipment extends Entity {
  kind: EquipmentKind;
  name: string;
  /** 同時実行スロット数。ガントチャートの排他制御の単位 */
  slots: number;
  isAvailable: Bool;
  /** 電子レンジ・オーブンの出力 */
  wattage?: number;
  capacityLiters?: number;
  maxTempC?: number;
  /** フライパン・鍋の口径（作れる量の上限判定用） */
  diameterCm?: number;
  /** オーブンの予熱など、実作業の前に必ず要る占有時間 */
  preheatSec?: Seconds;
  notes?: string;
}

// ---------------------------------------------------------------------------
// 3. 保存容器
// ---------------------------------------------------------------------------

export type ContainerMaterial =
  | 'plastic'
  | 'glass'
  | 'stainless'
  | 'silicone'
  | 'zipper_bag'
  | 'other';

export interface Container extends Entity {
  /** ラベル印字用の短い識別子 例: 'A1' */
  labelCode: string;
  name: string;
  volumeMl: Milliliters;
  material: ContainerMaterial;
  microwaveSafe: boolean;
  freezerSafe: boolean;
  /** 同型を何個持っているか */
  count: number;
  isAvailable: Bool;
}

// ---------------------------------------------------------------------------
// 4. 食材マスタ
// ---------------------------------------------------------------------------

/** スーパーの売り場区分。動線ソートの基準 */
export type StoreSection =
  | 'produce'        // 野菜・果物
  | 'meat_fish'      // 精肉・鮮魚
  | 'daily_chilled'  // 日配品（豆腐・卵・乳製品・練物）
  | 'dry_grocery'    // 乾物・缶詰・米・麺
  | 'seasoning'      // 調味料
  | 'frozen'         // 冷凍（溶けるので最後）
  | 'bakery'
  | 'beverage'
  | 'other';

/** 既定の店内動線。ユーザーは AppSettings.shopping.sectionOrder で並べ替えできる */
export const DEFAULT_SECTION_ORDER: StoreSection[] = [
  'produce',
  'meat_fish',
  'daily_chilled',
  'dry_grocery',
  'seasoning',
  'bakery',
  'beverage',
  'frozen',
  'other',
];

export type Unit =
  | 'g' | 'ml'
  | 'piece'  // 個
  | 'pack'   // パック
  | 'bunch'  // 束
  | 'can'
  | 'tbsp' | 'tsp'
  | 'clove'  // 片
  | 'sheet'; // 枚

/** 8大アレルゲン＋特定原材料に準ずるもの、の識別キー */
export type AllergenTag =
  | 'egg' | 'milk' | 'wheat' | 'buckwheat' | 'peanut'
  | 'shrimp' | 'crab' | 'walnut'
  | 'soy' | 'sesame' | 'cashew' | 'almond' | 'squid' | 'salmon'
  | 'mackerel' | 'beef' | 'pork' | 'chicken' | 'gelatin'
  | 'orange' | 'kiwi' | 'peach' | 'apple' | 'banana' | 'yam' | 'matsutake';

/**
 * 購入単位の情報。ここが正確でないと買い出しリストが実用にならない。
 * 「鶏むね肉 480g 必要」→「2パック（1パック約250g）」に丸める根拠。
 */
export interface PurchaseSpec {
  unit: Unit;
  /** 1購入単位あたりのグラム数（1パック=250g など） */
  gramsPerUnit: Grams;
  /**
   * 数えるときの1つあたりの重さ（卵1個=60g など）。
   *
   * gramsPerUnit は**買う単位**なので、卵なら1パック600gになる。
   * レシピの「卵2個」をこれで換算すると1200gになってしまう。
   * 数えられる食材にはこちらを持たせる。
   */
  gramsPerPiece?: Grams;
  typicalPriceYen: Yen;
  priceUpdatedAt?: ISODateTime;
  /** ばら売り不可なら 1。最低購入数 */
  minUnits: number;
  /** 購入数の刻み（3個パックのみなら 3） */
  unitStep: number;
}

export interface ShelfLife {
  fridgeDays?: number;
  freezerDays?: number;
  pantryDays?: number;
}

export interface Ingredient extends Entity {
  name: string;
  /** 正規化キー（カナ／ひらがな／異表記を畳んだもの）。重複登録の防止に使う */
  nameKey: string;
  aliases: string[];
  section: StoreSection;
  nutritionPer100g: NutritionPer100g;
  purchase: PurchaseSpec;
  /**
   * 歩留まり（0.0〜1.0）。廃棄部＋調理ロスの合成。
   * 必要な可食部量 ÷ yieldRatio = 買うべき量。
   */
  yieldRatio: number;
  shelfLife: ShelfLife;
  allergens: AllergenTag[];
  /** 常備品（調味料など）。既定で買い出しリストから除外できる */
  isStaple: Bool;
  /** 冷凍作り置きに向くか */
  freezeFriendly: boolean;
  source: 'builtin' | 'user' | 'ai';
  notes?: string;
}

// ---------------------------------------------------------------------------
// 5. 在庫
// ---------------------------------------------------------------------------

export type StorageLocation = 'fridge' | 'freezer' | 'pantry';

export interface InventoryItem extends Entity {
  ingredientId: UUID;
  /** 表示用の非正規化コピー（マスタ未取得でも一覧が出る） */
  ingredientName: string;
  /** g または ml に正規化した残量 */
  quantity: Grams | Milliliters;
  location: StorageLocation;
  bestBefore?: ISODate;
  purchasedAt?: ISODate;
  openedAt?: ISODateTime;
  /** 実際に払った単価。価格予測の学習に使う */
  paidPriceYen?: Yen;
  lotNote?: string;
}

/**
 * 常備品（調味料など）の持ち具合。
 *
 * 消費量の積算では当たらない。目分量で使い、アプリが知らない食事でも使うので、
 * 3ヶ月ぶんの誤差は残量より大きくなる。
 * 代わりに「買った日」と「切れた日」だけを記録し、間隔を学ぶ。
 * 1タップで、しかも本人が必ず気づく瞬間に取れる情報なので、実測として信頼できる。
 */
export interface StapleStatus extends Entity {
  ingredientId: UUID;
  /** 最後に買った日 */
  lastPurchasedAt?: ISODate;
  /** 使い切った日。複数回ぶん残して平均を取る */
  depletedAt: ISODate[];
  /** 実測から学んだ持ち日数。無ければ献立の使用量から推定する */
  observedIntervalDays?: number;
  /**
   * 「まだある」と本人が答えた日。
   * 切れた日と同じくらい価値がある情報で、予測を後ろへずらす根拠になる。
   */
  lastConfirmedAt?: ISODate;
}

// ---------------------------------------------------------------------------
// 6. レシピ
// ---------------------------------------------------------------------------

export interface RecipeIngredient {
  ingredientId: UUID;
  /** 非正規化コピー（オフライン表示・AI生成直後のマスタ未登録に耐える） */
  ingredientName: string;
  /** g / ml に正規化した使用量 */
  quantity: Grams | Milliliters;
  /** 表示用 例: '大さじ1', '1/2本' */
  displayQuantity?: string;
  optional: boolean;
  /** 店頭「代替」ボタンの対象にしてよいか（調味料や主役食材は false にする運用） */
  substitutable: boolean;
}

/**
 * 1手順 = ガントチャート上の1タスクの雛形。
 * `durationSec` は機器の占有時間、`handsOnSec` はそのうち人が張り付く時間。
 * この2つを分けているのが並行調理計算の核心（レンジ5分は人を拘束しない）。
 */
export interface RecipeStep {
  index: number;
  text: string;
  /** 必要な機器の「種別」。実機の割当は PrepTask 側で行う */
  equipmentKind?: EquipmentKind;
  durationSec: Seconds;
  handsOnSec: Seconds;
  /** 放置可能か（true なら人リソースを解放できる） */
  unattended: boolean;
  temperatureC?: number;
  wattage?: number;
  /** 先行手順の index。DAG を作る */
  dependsOn: number[];
  /** この手順で使う食材（RecipeIngredient のインデックス） */
  usesIngredients?: number[];
}

export interface RecipeStorage {
  location: 'fridge' | 'freezer';
  /** 保存可能日数。ダッシュボードの期限警告の根拠 */
  keepsDays: number;
  /**
   * おいしく食べられる日数。**日持ち（keepsDays）とは別。**
   *
   * 傷むまでの日数と、味が落ちるまでの日数は違う。和え物やサラダは
   * 3日もつが、2日目には水が出て別の食べ物になる。逆に煮ものは
   * 2日目のほうがうまい。「傷んでいないから」と後回しにすると、
   * おいしくないものばかりが残る（本人指摘）。
   *
   * 省略時は keepsDays と同じ。作り置き一覧の並び順に使う。
   */
  bestWithinDays?: number;
  /**
   * 冷凍に耐えるか。**凍ること自体ではなく、溶けたときに別物になるかどうか。**
   *
   * じゃがいもはスカスカに、豆腐は高野豆腐に、きゅうりや大根は
   * 水が出てくたくたになる。食べられなくなるわけではないので献立からは
   * 外さないが、冷凍に回ったぶんは**先に食べてもらう**（本人指摘）。
   */
  freezesWell?: boolean;
  reheatNote?: string;
}

export type RecipeSource = 'ai_cloud' | 'ai_local' | 'user' | 'builtin';

/**
 * 献立の中での役割。ソルバーはこれを使って
 * 「主菜1品＋副菜1品＋ごはん」で1食を組み立てる。
 * たんぱく質は主に主菜から、炭水化物はごはんの量で調整する。
 */
/**
 * 献立の中での役割。
 *
 * `snack` を分けているのは、**間食の枠に食事を入れないため**。
 * 枠を等しく扱っていたとき、間食に主菜＋副菜＋ごはんで1.3kg・1289kcal が
 * 入っていた（本人指摘）。間食は料理ではなく、手軽に食べられるもの。
 */
export type RecipeRole = 'main' | 'side' | 'staple' | 'snack';

export interface Recipe extends Entity {
  title: string;
  summary?: string;
  role: RecipeRole;
  /** 何食分作れるか */
  servings: number;
  /** 出来上がり総重量。1食あたりの詰め量(g)を出すのに使う */
  yieldGrams: Grams;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  /** 1食あたりの計算済み栄養値（保存時に確定させる） */
  nutritionPerServing: Macros;
  estimatedCostYen?: Yen;
  storage: RecipeStorage;
  tags: string[];
  allergens: AllergenTag[];
  source: RecipeSource;
  /** AI生成の来歴。再現性の担保 */
  generatedBy?: { runId: UUID; model: string };
  favorite: Bool;
  timesCooked: number;
  lastCookedAt?: ISODateTime;
}

// ---------------------------------------------------------------------------
// 7. 週次プラン
// ---------------------------------------------------------------------------

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type WeekPlanStatus =
  | 'draft'      // 生成直後・未確定
  | 'shopping'   // 買い出し中
  | 'cooking'    // 作り置き実行中
  | 'active'     // 平日の消費中
  | 'archived';

export interface WeekPlan extends Entity {
  /** その週の起点日（AppSettings.weekStartsOn に従う）。週の一意キー */
  weekStart: ISODate;
  status: WeekPlanStatus;
  profileIds: UUID[];
  recipeIds: UUID[];
  budgetYen: Yen;
  estimatedCostYen?: Yen;
  actualCostYen?: Yen;
  /** 前週の活動量から算出したカロリー補正係数（1.0 = 補正なし） */
  calorieAdjustFactor: number;
  generatedBy?: { runId: UUID; model: string };
  /** 制約を緩めて生成した場合の記録（何を諦めたか） */
  relaxedConstraints?: string[];
  notes?: string;
}

/** 「誰が・いつ・何を・何g食べるか」の確定枠 */
export interface PlannedMeal extends Entity {
  weekPlanId: UUID;
  profileId: UUID;
  date: ISODate;
  slot: MealSlot;
  items: {
    recipeId: UUID;
    recipeTitle: string;
    grams: Grams;
    /** 対応する容器（ラベル）。詰め替え済みなら紐付く */
    containerAssignmentId?: UUID;
  }[];
  /** items から計算した合計栄養値 */
  nutrition: Macros;
  status: 'planned' | 'eaten' | 'skipped' | 'substituted';
  eatenAt?: ISODateTime;
  /**
   * 献立として組んだものか、その場で食べた記録か。
   *
   * 残っていた作り置きを食べたときにも摂取として記録するが、それは
   * **今日の献立ではない**。「今日の食事」の欄には献立だけを出し、
   * 摂取の合計には両方を入れる。区別が無いと、食べた記録が献立に混ざる。
   */
  source?: 'plan' | 'leftover';
  note?: string;
}

// ---------------------------------------------------------------------------
// 8. 容器の割当（ラベリング）
// ---------------------------------------------------------------------------

/** 「どのタッパーに・誰の分を・何g詰めるか」の1枚のラベル */
export interface ContainerAssignment extends Entity {
  weekPlanId: UUID;
  prepSessionId?: UUID;
  containerId?: UUID;
  /** ラベル印字文字列。containerId 未割当でも表示できるよう独立に持つ */
  containerLabel: string;
  recipeId: UUID;
  recipeTitle: string;
  profileId: UUID;
  profileName: string;
  grams: Grams;
  nutrition: Macros;
  /**
   * 詰め方。
   *
   * `meal`  = 1食ぶん。そのまま温めて食べる（主菜）
   * `batch` = まとめ詰め。食べるときに取り分ける（副菜・ごはん）
   *
   * **1容器に主菜と副菜を混ぜない。**以前は1食ぶんの全品を1行に押し込み、
   * `recipeTitle` を「つけそば + かぼちゃの煮もの」、`grams` を合計789gに
   * していた。**実際には詰められない詰め方**を数えていた（本人指摘）。
   * このスキーマが recipeId / recipeTitle を単数で持っているのは元々そのため。
   */
  portion?: 'meal' | 'batch';
  /** batch のとき、何食ぶん入っているか。取り分ける目安になる */
  servingsCount?: number;
  intendedDate: ISODate;
  intendedSlot: MealSlot;
  storage: 'fridge' | 'freezer';
  cookedAt?: ISODateTime;
  /**
   * 何日もつか。詰めた日が決まった時点で useByDate を引き直すために持つ。
   * 献立を組む時点では実際にいつ作るか分からないので、日数のほうを残しておく。
   */
  keepsDays?: number;
  /** cookedAt + keepsDays。期限警告の判定に使う */
  useByDate: ISODate;
  /**
   * cookedAt + bestWithinDays。**傷む前に、味が落ちる。**
   * 一覧はこちらの順に並べる。「傷んでいないから」と後回しにすると、
   * おいしくないものばかりが残る（本人指摘）。
   */
  bestByDate?: ISODate;
  packed: Bool;
  consumedAt?: ISODateTime;
}

// ---------------------------------------------------------------------------
// 9. 作り置きセッション（並行調理ガントチャート）
// ---------------------------------------------------------------------------

export interface PrepSession extends Entity {
  weekPlanId: UUID;
  plannedStartAt: ISODateTime;
  /** スケジューリング結果の総所要時間 */
  totalDurationSec: Seconds;
  /** クリティカルパス上の PrepTask.id 列 */
  criticalPath: UUID[];
  /** 求解器のバージョン。結果の再現性のため */
  solverVersion: string;
  status: 'planned' | 'running' | 'done' | 'abandoned';
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
}

export interface PrepTask extends Entity {
  prepSessionId: UUID;
  recipeId?: UUID;
  recipeStepIndex?: number;
  label: string;
  /** セッション開始からの相対秒。絶対時刻を持たないので開始遅延に強い */
  startOffsetSec: Seconds;
  durationSec: Seconds;
  handsOnSec: Seconds;
  /** 実機の割当結果 */
  equipmentId?: UUID;
  /** Equipment.slots のどのスロットか（0-origin） */
  equipmentSlot?: number;
  /** 人リソースを占有するか。false のタスクは並行に積める */
  requiresCook: boolean;
  dependsOnTaskIds: UUID[];
  /** 描画用レーン番号 */
  lane: number;
  status: 'todo' | 'running' | 'done' | 'skipped';
  actualStartAt?: ISODateTime;
  actualEndAt?: ISODateTime;
}

/**
 * よく行く店の価格水準。
 *
 * 店ごとの実売価格を持つことはできない。公開APIが無く、各社の規約は
 * 自動取得を禁じているのが通例で、そもそも商品単価を Web 公開していない店が多い。
 *
 * できるのは「この店はマスタの想定より何割高いか」を、本人のレシート合計から学ぶこと。
 * 食材どうしの相対価格（鶏むねと豚こまの比）は店が変わっても大きく変わらない。
 * 変わるのは全体の水準なので、係数1つで表せる。
 */
export interface Store extends Entity {
  name: string;
  /** マスタの想定価格に掛ける係数。1.0 が想定どおり */
  priceFactor: number;
  /** レシート合計を突き合わせた回数。少ないうちは「目安」と表示する */
  sampleCount: number;
  /**
   * 各回のレシートが示した係数。直近8回ぶん。
   * 平均ではなく中央値を採るために履歴で持つ。
   * 1週間の買い物には特売やついで買いが混ざるので、
   * 平均だと1回の大きな買い物に引っ張られる。
   */
  observedFactors: number[];
  isDefault: Bool;
}

/** 実績が入るまでの出発点として選ばせる価格帯 */
export type PriceBand = 'cheap' | 'normal' | 'premium';

export const PRICE_BAND_FACTOR: Record<PriceBand, number> = {
  cheap: 0.8,
  normal: 1.0,
  premium: 1.25,
};

// ---------------------------------------------------------------------------
// 10. 買い出しリスト
// ---------------------------------------------------------------------------

export interface ShoppingList extends Entity {
  weekPlanId: UUID;
  /** どの店で買う想定か。見込み金額の係数に使う */
  storeId?: UUID;
  shoppingDate: ISODate;
  budgetYen: Yen;
  estimatedTotalYen: Yen;
  actualTotalYen?: Yen;
  status: 'ready' | 'in_store' | 'done';
}

export interface Substitution {
  fromIngredientId: UUID;
  fromName: string;
  toIngredientId?: UUID;
  toName: string;
  /** 栄養を合わせるための置換量 */
  toQuantity: Grams | Milliliters;
  deltaMacros: Partial<Macros>;
  deltaPriceYen: Yen;
  reason: string;
  decidedBy: 'local_llm' | 'cloud_llm' | 'user';
  decidedAt: ISODateTime;
}

export interface ShoppingListItem extends Entity {
  shoppingListId: UUID;
  ingredientId: UUID;
  /** 非正規化。圏外・マスタ削除後でもリストが壊れない */
  name: string;
  section: StoreSection;
  /** 動線順の並び位置。ドラッグ並べ替えも同じフィールドを書き換える */
  sortIndex: number;
  /** レシピ合計 − 在庫、を歩留まりで割り戻した必要量 */
  requiredQuantity: Grams | Milliliters;
  /** 購入単位に切り上げた個数 */
  purchaseUnits: number;
  unit: Unit;
  /** 表示用 例: '2パック（約500g）' */
  displayQuantity: string;
  estimatedPriceYen: Yen;
  actualPriceYen?: Yen;
  checked: Bool;
  checkedAt?: ISODateTime;
  /** 何のために買うのか。代替提案時に AI へ渡す文脈になる */
  usedByRecipeIds: UUID[];
  substitution?: Substitution;
  /** 切り上げで余る量。作り置き後に在庫へ戻す */
  expectedLeftover?: Grams | Milliliters;
}

// ---------------------------------------------------------------------------
// 11. 活動量
// ---------------------------------------------------------------------------

export interface ActivitySample extends Entity {
  profileId: UUID;
  date: ISODate;
  steps?: number;
  activeKcal?: Kcal;
  restingKcal?: Kcal;
  weightKg?: number;
  source: ActivityAdjustConfig['source'];
}

// ---------------------------------------------------------------------------
// 12. 設定（シングルトン）と秘密情報
// ---------------------------------------------------------------------------

export interface ShoppingSettings {
  shoppingDay: Weekday;
  weeklyBudgetYen: Yen;
  monthlyBudgetYen?: Yen;
  /** ユーザーの行く店に合わせた売り場順 */
  sectionOrder: StoreSection[];
  /** 購入単位への切り上げを行うか */
  roundUpToPurchaseUnit: boolean;
  /**
   * 献立に出てこない消費の割合（0〜1）。
   * 朝の一杯や卵かけご飯など、アプリが把握しない使い方の取り分。
   * 「切れた」の実測が入るたびに更新する。
   */
  outsideUseRatio: number;
}

/**
 * 1食のごはんの量の決め方。
 * 'auto' は目標カロリーの不足分から決める。それ以外は毎食その量で固定する。
 */
export type RicePolicy = 'auto' | 'none' | 'small' | 'normal' | 'large';

/** 固定したときの人前。ごはん1人前は約165g（茶碗1杯） */
export const RICE_POLICY_SERVINGS: Record<Exclude<RicePolicy, 'auto'>, number> = {
  none: 0,
  small: 0.5,
  normal: 1,
  large: 1.5,
};

export interface CookingSettings {
  /**
   * 作り置きをする曜日。
   * 古い設定のために残す。読むときは `prepDays` を先に見る
   */
  prepDay: Weekday;
  /**
   * 作り置きをする曜日（複数）。
   *
   * 週2回作る人は「日曜と水曜」のように分かれる。1つしか持てなかったので、
   * 週に何回作るかと噛み合っていなかった。
   *
   * ここで効くのは**献立を作るときの開始日の候補**。
   * 決め打ちで週の頭に寄せず、この曜日に印を付けて選びやすくする。
   */
  prepDays?: Weekday[];
  /** 1回の作り置きに使える上限時間 */
  maxPrepMinutes: number;
  allowFreezing: boolean;
  /**
   * 同じ主菜を週に何食まで許すか。献立の「飽き」の許容範囲。
   *
   * 14食を主菜2品で埋めると、朝昼晩ずっと同じものになる。
   * どこまで同じでよいかは人によるので、こちらで決めずに聞く。
   * 小さくするほど品数が増え、買い物も調理も増える。
   */
  maxSameDishMeals: number;
  /**
   * 週に何回、台所に立つか。
   *
   * これまで作り方は「暮らしのプリセット」に付いていたが、**同じ暮らしでも人による**。
   * 育休中でも週1回まとめて作る人はいるし、共働きでも毎日作る人はいる。
   * プリセットは初期値を入れるだけにして、実際の頻度はここで持つ。
   *
   *   1回  → 週末にまとめて作る
   *   2〜4回 → 何日かおきに作る
   *   5回以上 → ほぼ毎日その日に作る
   *
   * 調理1回あたりの時間も、日ごとの時間も、この回数から出す。
   * 以前は「カバーする日数」で割っていたので、週2回作る人の時間が7で割られていた。
   */
  cookSessionsPerWeek?: number;
  /**
   * 1食のごはんの量。
   *
   * 既定の 'auto' は、おかずで足りないカロリーをごはんで埋める（炭水化物の調整弁）。
   * だが**ごはんを食べない人がいる。**糖質を抑えている人、パン派、
   * 主食を別に用意している人。こちらで勝手に付けるものではなかった。
   *
   * 量を決めた場合、カロリーの調整はおかず側で行う。
   * その結果、条件によっては組めなくなることがある（そのときは画面に出る）。
   */
  ricePolicy?: RicePolicy;
  /**
   * ごはんをいつ炊くか。
   *
   * `sameDay`（既定）= 食べる日に炊く。作り置きの段取りには入れない
   * `batchFreeze`    = 作り置きのときにまとめて炊いて、すぐ冷凍する
   *
   * **ごはんを冷蔵に置かない。**炊いたごはんは冷蔵で固くなる（でんぷんの老化）。
   * それまで、5食ぶんのごはんを冷蔵の容器に入れる献立を平気で出していた。
   * 炊飯は炊飯器の予約でほぼ手が要らないので、まとめて作る対象にしなくてよい。
   */
  riceCookMode?: 'sameDay' | 'batchFreeze';
  /**
   * ごはんが炊き上がるまでの分数。
   *
   * 機種でまるで違う（早炊き20分・普通50分・土鍋モード70分）ので、
   * レシピ側に固定値で持たせない。炊飯器を持たない人が鍋で炊く場合も同じ値を使う。
   */
  riceCookMinutes?: number;
  /** 冷蔵保存の上限日数（食品衛生上の自己ルール。既定3） */
  maxFridgeDays: number;
  /** 作り置きでカバーする食事枠。既定は夕食のみ */
  coverSlots: MealSlot[];
  /** 何日分をカバーするか。既定は平日5日 */
  coverDays: number;
}

export type AiRouteMode =
  | 'cloud_first'   // 通信があれば常にクラウド
  | 'local_first'   // 軽量タスクはローカル優先
  | 'local_only'    // クラウドを一切呼ばない
  | 'cloud_only';

export interface AiSettings {
  cloudProvider: 'anthropic' | 'openai' | 'none';
  cloudModel: string;
  /** WebLLM のモデルID 例: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC' */
  localModel: string;
  localEnabled: boolean;
  /** モデルの重みを端末にキャッシュ済みか */
  localModelCached: boolean;
  routeMode: AiRouteMode;
  /** 課金の上限。超えたらクラウド呼び出しを止める */
  maxCloudCallsPerWeek: number;
  /** 生レスポンスを AiRun に保存するか（デバッグ用。既定 false） */
  keepRawResponses: boolean;
}

export interface NotifySettings {
  /** GAS の Web アプリ URL */
  gasEndpointUrl?: string;
  lineEnabled: boolean;
  /** 毎日の通知時刻 */
  dailyPushTime: TimeOfDay;
  /** 買い出しリマインダー時刻 */
  shoppingPushTime?: TimeOfDay;
  /** 提案型通知（何通りか出して選ばせる）。v0.6 */
  suggestionEnabled: boolean;
  /** 提案を送る時刻。帰宅前に届くよう夕方 */
  suggestionTime?: TimeOfDay;
  lastSyncedAt?: ISODateTime;
  /** 同期済みスケジュールのハッシュ。差分がなければ POST しない */
  lastSyncedHash?: string;
}

/**
 * Google カレンダー連携。読み取り専用。
 * 予定から「その日に料理へ割ける時間」を推定して DaySchedule に落とす。
 */
export interface CalendarSettings {
  enabled: boolean;
  provider: 'google' | 'none';
  /** 読み取る対象のカレンダーID */
  calendarIds: string[];
  /** 帰宅時刻の推定に使うキーワード（例: '退勤', '帰宅'） */
  homeKeywords: string[];
  /** 予定から推定できない日の既定調理時間（分） */
  defaultCookMinutes: number;
  /** 何日先まで読むか */
  lookaheadDays: number;
  lastSyncedAt?: ISODateTime;
  /**
   * 献立を Google カレンダーに書き出すか。
   * 書く先は「Prepflow」という専用カレンダーだけ。他のカレンダーには触れない。
   * 書くのは日付・時刻・料理名（と kcal・P）。買い物の中身や体重は書かない。
   */
  publishEnabled?: boolean;
  lastPublishedAt?: ISODateTime;
}

export interface AppSettings {
  /** 常に 'singleton' */
  id: 'singleton';
  updatedAt: ISODateTime;
  schemaVersion: number;
  locale: string;
  theme: 'dark' | 'light' | 'system';
  weekStartsOn: Weekday;
  shopping: ShoppingSettings;
  cooking: CookingSettings;
  ai: AiSettings;
  notify: NotifySettings;
  calendar: CalendarSettings;
  rhythm: DailyRhythm;
  /** 現在有効な世帯。未設定なら単身の既定で動く */
  currentHouseholdId?: UUID;
  /** オンボーディング完了フラグ */
  onboardedAt?: ISODateTime;
}

/**
 * 料理の写真。
 *
 * **レシピ本体とは別のテーブル**に置く（1枚で数十〜数百KBあり、
 * レシピ一覧を読むたびに画像まで読むことになるため）。
 *
 * 中身は Blob。IndexedDB は Blob をそのまま保存できるので、
 * base64 にして膨らませる必要はない。保存前に長辺640pxまで縮めている。
 */
export interface RecipePhoto {
  recipeId: UUID;
  blob: Blob;
  /** 撮った端末の向きなどを考えず、表示は object-fit: cover に任せる */
  width: number;
  height: number;
  updatedAt: ISODateTime;
}

/**
 * APIキー等は通常設定と別テーブルに置く。
 * 理由: バックアップ／エクスポート機能で丸ごと除外できるようにするため。
 * 注意: IndexedDB は平文であり、これは「漏洩しない」保証ではない。
 *       端末が信頼できる前提の上での、事故（設定JSONの共有等）の防止策。
 */
export interface Secret {
  key: 'cloud_api_key' | 'gas_shared_token';
  value: string;
  updatedAt: ISODateTime;
}

// ---------------------------------------------------------------------------
// 13. AI 実行ログ・キャッシュ
// ---------------------------------------------------------------------------

export type AiTaskKind =
  | 'week_plan'
  | 'shopping_optimize'
  | 'gantt_schedule'
  | 'substitute'
  | 'recipe_tweak'
  | 'nutrition_estimate';

export interface AiRun extends Entity {
  kind: AiTaskKind;
  route: 'cloud' | 'local';
  model: string;
  /** 入力のハッシュ。同一入力の再実行を避ける */
  promptHash: string;
  requestSummary: string;
  /** AiSettings.keepRawResponses が true のときだけ保存 */
  rawResponse?: string;
  parsedOk: boolean;
  /** スキーマ検証で落ちた項目。プロンプト改善の材料 */
  validationErrors?: string[];
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  estimatedCostYen?: Yen;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  error?: string;
}

/** 店頭での代替提案キャッシュ。同じ食材を何度も推論させない */
export interface SubstitutionSuggestion extends Entity {
  /** ingredientId + 制約ハッシュ。一意 */
  cacheKey: string;
  ingredientId: UUID;
  suggestions: Omit<Substitution, 'decidedBy' | 'decidedAt'>[];
  route: 'cloud' | 'local';
  hits: number;
}

// ---------------------------------------------------------------------------
// 14. 送信キュー（GAS 連携）
// ---------------------------------------------------------------------------

/**
 * 圏外で設定を変えても取りこぼさないための送信箱。
 * オンライン復帰時に Service Worker / 起動時処理が掃き出す。
 */
export interface OutboxEntry extends Entity {
  target: 'gas_schedule';
  payload: unknown;
  attempts: number;
  lastAttemptAt?: ISODateTime;
  lastError?: string;
  status: 'pending' | 'sent' | 'failed';
}

// ---------------------------------------------------------------------------
// 15. メタ（マイグレーション履歴など）
// ---------------------------------------------------------------------------

export interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: ISODateTime;
}
