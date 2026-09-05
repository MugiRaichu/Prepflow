/**
 * 「何分かかるか」の計算。ソルバーと画面で必ず同じ式を使う。
 *
 * まとめて作る場合は、手を動かす時間の合計がそのまま1回ぶんの時間になる。
 *
 * 毎日作る場合はそう単純ではない。総量は変わらないので合計時間を調理日数で
 * 割るのが出発点だが、それだけだと嘘になる。理由は2つ。
 *
 *   1. まとめて作れば1回で済む段取りが、毎日発生する。
 *      フライパンを出す・熱する・盛る・洗う。作る量に関係なくかかる
 *   2. 600gを一度に切るのは、120gを5回切るより速い。
 *      分けて作ると1回あたりの効率は落ちる
 *
 * ここを無視すると「毎日5分」のような、実際には成立しない数字を出してしまう。
 * 時短を売りにするアプリが時短の数字で嘘をつくのが、いちばんまずい。
 *
 * 係数に厳密な出典は無い（家庭の調理時間を分解した公開データが無い）。
 * 実測が溜まったら PrepSession の実績で置き換える。
 */
import type { CookingMode } from '@/db/schema';

/** 作る量に関係なく毎回かかる段取り（分） */
export const DAILY_OVERHEAD_MIN = 5;

/** 小分けにすると1回あたりの効率が落ちる分の割増し */
export const DAILY_INEFFICIENCY = 1.3;

/** 毎日作る場合の、1日あたり手を動かす時間（分） */
export function perDayMinutes(handsMin: number, cookDays: number): number {
  return (handsMin / Math.max(cookDays, 1)) * DAILY_INEFFICIENCY + DAILY_OVERHEAD_MIN;
}

/**
 * 上限と突き合わせる時間。作り方によって意味が変わる。
 *   まとめて作る → 1回ぶんの合計
 *   毎日作る     → 1日あたり
 */
export function timeMetric(mode: CookingMode, handsMin: number, cookDays: number): number {
  return mode === 'daily' ? perDayMinutes(handsMin, cookDays) : handsMin;
}
