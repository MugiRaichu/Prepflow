/**
 * 献立の期間。**いつから何日ぶんを作るか。**
 *
 * これまでは設定の「週の始まり」に合わせて、今日以降で最も近いその曜日から
 * 始めていた。だから**日曜に作れなくて月曜に立て直すと、次の日曜からの献立**
 * になり、月曜から土曜までが空いた（本人報告）。
 *
 * 予定どおりに作れない日はある。作る日がずれたら、献立もずれるべきだった。
 * 決め打ちをやめて、開始日と日数をその場で選べるようにする。
 *
 * 上限は7日。作り置きは7日を超えて持たないし、
 * 8日ぶんの買い物は1回で運べない。
 */
import { addDaysIso, todayIso } from '@/lib/labels';
import type { CookingSettings, Weekday } from '@/db/schema';

/** 献立の最大日数。作り置きが持つ長さと、1回で運べる買い物の量の両方から */
export const MAX_PLAN_DAYS = 7;

/**
 * 作り置きをする曜日。
 * 複数版が無い古い設定は、単数の `prepDay` から作る。
 */
export function prepDaysOf(cooking: Pick<CookingSettings, 'prepDay' | 'prepDays'>): Weekday[] {
  const days = cooking.prepDays;
  if (days && days.length > 0) return [...days].sort();
  return [cooking.prepDay];
}

export interface PlanWindow {
  startDate: string;
  days: number;
}

/**
 * 既定の期間。
 *
 * **今日から**にする。人は作れるときに立てるので、
 * 今日を飛ばす理由がない。作り置きの曜日は「印」として使うだけで、
 * そこまで待たせるのには使わない（待たせていたのが元のバグ）。
 */
export function defaultWindow(cooking: CookingSettings): PlanWindow {
  return {
    startDate: todayIso(),
    days: Math.min(Math.max(cooking.coverDays, 1), MAX_PLAN_DAYS),
  };
}

/** 開始日の候補。今日から1週間ぶん出す。それ以上先は選ぶ意味がない */
export function startOptions(
  cooking: Pick<CookingSettings, 'prepDay' | 'prepDays'>,
  from = todayIso(),
): { date: string; isPrepDay: boolean }[] {
  const prep = new Set(prepDaysOf(cooking));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(from, i);
    return { date, isPrepDay: prep.has(new Date(date + 'T00:00:00').getDay() as Weekday) };
  });
}
