/**
 * 作る頻度から、画面と計算の振る舞いを決める。
 *
 * これまでは「暮らしのプリセット」（一人暮らし・育休中…）に作り方が紐づいていた。
 * だが**同じ暮らしでも人による**。育休中でも週1回まとめて作る人はいるし、
 * 共働きでも毎日作る人はいる。プリセットは初期値を入れるだけにして、
 * 実際の頻度から作り方を導く。
 *
 * ここを1か所にまとめているのは、以前 cookDays に「カバーする日数」を
 * 渡していて、週2回しか作らない人の調理時間が7で割られていたため。
 */
import type { CookingMode } from '@/db/schema';

/** 週の調理回数から作り方を決める */
export function modeFor(cookSessionsPerWeek: number): CookingMode {
  if (cookSessionsPerWeek >= 5) return 'daily';
  if (cookSessionsPerWeek <= 1) return 'batch';
  return 'hybrid';
}

/** 1回で何日ぶんを作ることになるか */
export function daysPerSession(coverDays: number, cookSessionsPerWeek: number): number {
  return coverDays / Math.max(cookSessionsPerWeek, 1);
}

/**
 * 画面に出す説明。回数を変えたときに何が変わるかを1行で示す。
 * 「週2回」だけでは、それが何を意味するのか分からない。
 */
export function cadenceLabel(cookSessionsPerWeek: number, coverDays: number): string {
  const n = Math.max(cookSessionsPerWeek, 1);
  if (n === 1) return 'まとめて1回で ' + coverDays + '日ぶん作ります';
  if (n >= 7) return '毎日その日のぶんを作ります';
  const per = Math.round(daysPerSession(coverDays, n) * 10) / 10;
  return '1回あたり ' + per + '日ぶん、週' + n + '回作ります';
}

/**
 * 保存日数の上限。作る間隔より長く持たないものは献立に出せない。
 *
 * 週1回で7日ぶんなら7日持つ必要があるが、週3回なら2〜3日で足りる。
 * 頻度を上げるほど、日持ちしないものが選べるようになる。
 * 冷凍を許す場合はこの制約を超えられるので、別に扱う。
 */
export function requiredKeepDays(coverDays: number, cookSessionsPerWeek: number): number {
  return Math.max(1, Math.ceil(daysPerSession(coverDays, cookSessionsPerWeek)));
}
