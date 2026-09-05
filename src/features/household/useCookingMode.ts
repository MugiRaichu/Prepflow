import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { modeFor } from '@/features/planner/logic/cadence';
import type { CookingMode } from '@/db/schema';

/**
 * いまの暮らしの作り方。画面の作りを分けるために使う。
 *
 * まとめて作る人と毎日作る人では、必要な画面がそもそも違う。
 *
 *   まとめて作る → 週に1回、全部まとめて作る。作る日が主役
 *   毎日作る     → 献立は買い物のために要るが、作るのは今日のぶんだけ。今日が主役
 *
 * 同じ画面に両方を詰めると、毎日作る人が「週ぶんの段取り」を毎日見ることになる。
 */
export function useCookingMode(): CookingMode {
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  // 暮らしのプリセットではなく、実際の調理回数から決める。
  // 同じ「育休中」でも、週1回まとめて作る人と毎日作る人がいる
  return modeFor(settings?.cooking.cookSessionsPerWeek ?? 1);
}

/** 毎日その日に作るか（hybrid は作り置き寄りなので false） */
export const isDaily = (mode: CookingMode): boolean => mode === 'daily';
