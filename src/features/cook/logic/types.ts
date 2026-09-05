import type { EquipmentKind, Recipe, Seconds, UUID } from '@/db/schema';

/** 並べ替える前の1タスク。レシピの1手順 × バッチ番号 */
export interface CookTask {
  id: string;
  recipeId: UUID;
  recipeTitle: string;
  /** 同じレシピを2回作るときの何回目か（0始まり） */
  batchIndex: number;
  stepIndex: number;
  label: string;
  /** 機器を占有する時間 */
  durationSec: Seconds;
  /** うち人が張り付く時間。先頭に来るものとして扱う */
  handsOnSec: Seconds;
  equipmentKind?: EquipmentKind;
  /** 同じレシピ・同じバッチ内の先行タスクID */
  dependsOn: string[];
}

/** 割り当て済みのタスク */
export interface ScheduledTask extends CookTask {
  startSec: Seconds;
  endSec: Seconds;
  /** 割り当てた実機。器具が要らない手順は undefined */
  equipmentId?: UUID;
  equipmentName?: string;
  /** 何番目のスロット（コンロの何口目か） */
  slot?: number;
  /** 描画用のレーン */
  lane: number;
  /** クリティカルパス上にあるか。ここを縮めないと全体は縮まない */
  critical: boolean;
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  /** 全体の所要時間（秒） */
  makespanSec: Seconds;
  /** 人が手を動かす合計（秒）。これ以下には絶対に縮まない */
  handsOnSec: Seconds;
  /** 何もしていない待ち時間（秒） */
  idleSec: Seconds;
  /** 順番に作った場合の所要時間。並行化でどれだけ縮んだかの比較用 */
  sequentialSec: Seconds;
  /** レーン数（同時に動いているものの最大） */
  lanes: number;
  /** 機器が足りずに待たされた回数。ボトルネックの説明に使う */
  bottlenecks: { equipmentName: string; waitedSec: Seconds }[];
}

export interface SchedulerInput {
  /** レシピとバッチ数 */
  items: { recipe: Recipe; batches: number }[];
  /** 使える機器 */
  equipment: {
    id: UUID;
    name: string;
    kind: EquipmentKind;
    slots: number;
    preheatSec?: Seconds;
  }[];
}
