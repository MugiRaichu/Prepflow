/**
 * GAS へ行くのは、1回にまとめる。
 *
 * カレンダーの予定と、ショートカットが送った歩数は、**同じスクリプトの中に
 * 並んで置いてある。**それを別々に取りに行っていたので、起動のたびに
 * 往復が2回起きていた（本人「同期をもっと高速化できませんか」）。
 *
 * 1往復の中身はだいたいこう決まっている。
 *
 *   スクリプトの起動（コールドスタート）  1〜3秒 … 縮められない
 *   302 で別ドメインへ回される往復        0.3〜1秒 … GAS の仕組み。避けられない
 *   カレンダーを読む                      0.5〜3秒 … ここは減らせる（Code.gs 側）
 *
 * **縮められない部分が大きいほど、回数を減らすのが効く。**
 * 2回を1回にすれば、起動時の待ちはおおよそ半分になる。
 *
 * ---
 * 同時に呼ばれても往復は1回にする。起動直後は main.tsx（歩数）と
 * 今日タブ（カレンダー）がほぼ同時に走るので、**先に走っているものがあれば
 * その結果を待つ**。片方が終わってからもう片方が「まだ古い」と判断して
 * もう一度行く、という取りこぼしも起きない。
 */
import { db } from '@/db/db';
import { getSecret } from '@/db/repositories/settings';
import { post } from './gasClient';
import { applyCalendar, readCache, CALENDAR_STALE } from '@/calendar/gasCalendar';
import type { CalendarEvent } from '@/calendar/gasCalendar';
import { applyHealth, healthPulledAt, HEALTH_STALE } from '@/health/gasHealth';
import type { HealthSample } from '@/health/gasHealth';
import type { AppSettings } from '@/db/schema';

export interface SyncAges {
  /** カレンダーをこれより古いときだけ取り直す */
  calendarMaxAgeMs?: number;
  /** 歩数をこれより古いときだけ取り直す */
  healthMaxAgeMs?: number;
}

let inFlight: Promise<void> | null = null;

const ageOf = (iso: string | null | undefined): number =>
  iso ? Date.now() - new Date(iso).getTime() : Infinity;

/**
 * 期限が来ているものだけを、1往復でまとめて取る。
 * どちらも新しければ通信しない。失敗しても投げない（黙って次の機会に回す）。
 */
export async function syncFromGas(settings: AppSettings, ages: SyncAges = {}): Promise<void> {
  if (inFlight) return inFlight;

  const run = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const url = settings.notify.gasEndpointUrl;
    const token = await getSecret('gas_shared_token');
    if (!url || !token) return;

    const calMax = ages.calendarMaxAgeMs ?? CALENDAR_STALE.open;
    const healthMax = ages.healthMaxAgeMs ?? HEALTH_STALE;

    const wantEvents =
      settings.calendar.enabled && ageOf((await readCache())?.syncedAt) >= calMax;
    const wantHealth = ageOf(await healthPulledAt()) >= healthMax;
    if (!wantEvents && !wantHealth) return;

    /*
     * 片方だけ要るときも、同じ入口で聞く。
     * 要らないほうは GAS 側で読みにいかないので、そのぶんは速い。
     */
    const r = await post<{ events: CalendarEvent[]; samples: HealthSample[] }>(url, {
      action: 'sync',
      token,
      events: wantEvents,
      health: wantHealth,
      days: settings.calendar.lookaheadDays || 7,
    });
    if (!r.ok) return;

    if (wantEvents) await applyCalendar(r.events ?? []);
    if (wantHealth) await applyHealth(r.samples ?? []);
  };

  inFlight = run()
    .catch(() => {
      // 圏外・未設定・GAS 側のエラー。次に開いたときにまた来る
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** 設定がまだ読めていない場面から呼ぶ（起動直後の main.tsx など） */
export async function syncFromGasIfConfigured(ages: SyncAges = {}): Promise<void> {
  const settings = await db.settings.get('singleton');
  if (!settings) return;
  await syncFromGas(settings, ages);
}
