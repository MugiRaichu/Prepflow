/**
 * Prepflow — Dexie.js データベース定義
 *
 * インデックス設計の原則
 * - 第1要素は主キー。UUID なので '++' は付けない。
 * - '&' は一意インデックス、'*' は配列の各要素をインデックス（multiEntry）。
 * - '[a+b]' は複合インデックス。「誰の・その日の」のような二軸検索に使う。
 * - boolean はインデックス不可。schema.ts の `Bool`(0|1) を使う。
 * - インデックスは検索に使うものだけ。埋め込みオブジェクトや長い配列は張らない。
 */

import Dexie, { type Table } from 'dexie';
import type {
  Profile,
  Household,
  DaySchedule,
  DailySuggestion,
  Habit,
  Equipment,
  Container,
  Ingredient,
  InventoryItem,
  Recipe,
  WeekPlan,
  PlannedMeal,
  ContainerAssignment,
  PrepSession,
  PrepTask,
  ShoppingList,
  ShoppingListItem,
  ActivitySample,
  AppSettings,
  Secret,
  AiRun,
  SubstitutionSuggestion,
  OutboxEntry,
  MetaRecord,
  StapleStatus,
  Store,
  UUID,
  RecipePhoto,
  MealPhoto,
} from './schema';

export const DB_NAME = 'prepflow';
export const SCHEMA_VERSION = 7;

export class PrepflowDB extends Dexie {
  profiles!: Table<Profile, UUID>;
  households!: Table<Household, UUID>;
  daySchedules!: Table<DaySchedule, UUID>;
  habits!: Table<Habit, UUID>;
  dailySuggestions!: Table<DailySuggestion, UUID>;
  equipment!: Table<Equipment, UUID>;
  containers!: Table<Container, UUID>;
  ingredients!: Table<Ingredient, UUID>;
  inventory!: Table<InventoryItem, UUID>;
  recipes!: Table<Recipe, UUID>;
  weekPlans!: Table<WeekPlan, UUID>;
  plannedMeals!: Table<PlannedMeal, UUID>;
  containerAssignments!: Table<ContainerAssignment, UUID>;
  mealPhotos!: Table<MealPhoto, UUID>;
  prepSessions!: Table<PrepSession, UUID>;
  prepTasks!: Table<PrepTask, UUID>;
  shoppingLists!: Table<ShoppingList, UUID>;
  shoppingListItems!: Table<ShoppingListItem, UUID>;
  activitySamples!: Table<ActivitySample, UUID>;
  settings!: Table<AppSettings, 'singleton'>;
  secrets!: Table<Secret, Secret['key']>;
  aiRuns!: Table<AiRun, UUID>;
  substitutionCache!: Table<SubstitutionSuggestion, UUID>;
  outbox!: Table<OutboxEntry, UUID>;
  meta!: Table<MetaRecord, string>;
  stapleStatus!: Table<StapleStatus, UUID>;
  stores!: Table<Store, UUID>;
  recipePhotos!: Table<RecipePhoto, UUID>;

  constructor() {
    super(DB_NAME);

    this.version(1).stores({
      // --- 設定系 -----------------------------------------------------------
      profiles: 'id, name, isActive, deleted',
      equipment: 'id, kind, isAvailable, deleted',
      containers: 'id, &labelCode, isAvailable, deleted',

      // --- マスタ・在庫 -----------------------------------------------------
      ingredients:
        'id, &nameKey, name, section, isStaple, source, *aliases, *allergens, deleted',
      inventory:
        'id, ingredientId, location, bestBefore, [location+bestBefore], deleted',

      // --- レシピ・プラン ---------------------------------------------------
      recipes: 'id, title, favorite, source, lastCookedAt, *tags, *allergens, deleted',
      weekPlans: 'id, &weekStart, status, deleted',
      plannedMeals:
        'id, weekPlanId, profileId, date, status, [profileId+date], [date+slot], deleted',
      containerAssignments:
        'id, weekPlanId, prepSessionId, containerLabel, intendedDate, useByDate, packed, ' +
        '[profileId+intendedDate], [weekPlanId+packed], deleted',

      // --- 作り置きセッション（ガント） ------------------------------------
      prepSessions: 'id, weekPlanId, status, plannedStartAt, deleted',
      prepTasks:
        'id, prepSessionId, equipmentId, status, [prepSessionId+startOffsetSec], ' +
        '[prepSessionId+lane], deleted',

      // --- 買い出し ---------------------------------------------------------
      shoppingLists: 'id, weekPlanId, shoppingDate, status, deleted',
      shoppingListItems:
        'id, shoppingListId, ingredientId, section, checked, ' +
        '[shoppingListId+sortIndex], [shoppingListId+checked], deleted',

      // --- 活動量 -----------------------------------------------------------
      activitySamples: 'id, profileId, date, &[profileId+date], deleted',

      // --- 設定・秘密 -------------------------------------------------------
      settings: 'id',
      secrets: 'key',

      // --- AI ---------------------------------------------------------------
      aiRuns: 'id, kind, route, promptHash, startedAt, deleted',
      substitutionCache: 'id, &cacheKey, ingredientId, updatedAt, deleted',

      // --- 送信キュー・メタ -------------------------------------------------
      outbox: 'id, target, status, createdAt, deleted',
      meta: 'key',
    });

    // v0.4〜0.6 で使う世帯・予定・提案のテーブル。
    // 実装は先だが、後から入れると全レコードの移行が要るのでここで枠を作る。
    this.version(2).stores({
      households: 'id, isCurrent, lifeStage, activeFrom, activeUntil, deleted',
      daySchedules: 'id, date, profileId, source, [profileId+date], deleted',
      dailySuggestions: 'id, &date, pushedAt, deleted',
      // profiles に role / householdId が増えたのでインデックスを張り直す
      profiles: 'id, name, isActive, role, householdId, deleted',
    });

    // 生活リズムの習慣（トレーニング・通勤など）
    this.version(3).stores({
      habits: 'id, kind, startTime, fixed, deleted',
    });

    // 常備品の持ち具合。量ではなく間隔で管理する
    this.version(4).stores({
      stapleStatus: 'id, &ingredientId, lastPurchasedAt, deleted',
    });

    // よく行く店の価格水準。レシート合計から学ぶ
    this.version(5).stores({
      stores: 'id, isDefault, deleted',
      shoppingLists: 'id, weekPlanId, shoppingDate, status, storeId, deleted',
    });

    /*
     * 料理の写真。
     *
     * **この機能はやめた**（撮る口も表示も外した）。作り置きの皿は映えず、
     * 撮る手間だけが増えていた。それでもテーブルの宣言は消さない——
     * 過去の version() を消すと、既に写真を持っている端末が開けなくなる。
     * 撮ってあるものは端末に残る（書き出し・全消しの対象にも入ったまま）。
     *
     * 以下は当時の設計メモ。**レシピ本体とは別のテーブルに置く。**
     *
     * 写真は1枚で数十〜数百KBあり、レシピ行に混ぜるとレシピを1件読むたびに
     * 画像まで読むことになる（一覧は毎回全件読む）。
     * 別テーブルなら、表示する画面だけが取りに行く。
     * 書き出し・バックアップから外すのも、テーブルごとなら簡単。
     */
    this.version(6).stores({
      recipePhotos: 'recipeId, updatedAt',
    });

    /*
     * 食事の写真。**レシピの写真（v6）とは別物。**
     *
     * あちらは「料理に1枚」で、一覧を飾るためのものだった。
     * こちらは「食べた1回に1枚」で、あとで見返すためのもの。
     * 同じ料理でも日ごとに別の写真になるので、同じ表には入らない。
     *
     * `[date+slot]` を張るのは、1日ぶんを枠ごとに引くため（今日の流れに並べる）。
     */
    this.version(7).stores({
      mealPhotos: 'id, date, slot, plannedMealId, [date+slot], takenAt, deleted',
    });

    // 以後、スキーマ変更時は version(8).stores({...}).upgrade(tx => ...) を
    // 追記する。既存の version は消さない（Dexie は履歴を必要とする）。
  }
}

export const db = new PrepflowDB();

// ---------------------------------------------------------------------------
// 共通ヘルパー
// ---------------------------------------------------------------------------

export const nowIso = (): string => new Date().toISOString();

/** 新規レコードの共通フィールドを埋める */
export function newEntity(): {
  id: UUID;
  createdAt: string;
  updatedAt: string;
  deleted: 0;
  rev: number;
} {
  const t = nowIso();
  return { id: crypto.randomUUID(), createdAt: t, updatedAt: t, deleted: 0, rev: 1 };
}

/** 更新時に updatedAt / rev を進める */
export function touch<T extends { updatedAt: string; rev: number }>(e: T): T {
  return { ...e, updatedAt: nowIso(), rev: e.rev + 1 };
}
