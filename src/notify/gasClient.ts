/**
 * GAS へのスケジュール送信。
 *
 * 送るのは「日付・食事枠・その日食べるもの」だけ。
 * 体重・栄養・買い物の中身は送らない。端末から出す情報は最小にする。
 *
 * 圏外で設定を変えても取りこぼさないよう、送信は outbox 経由にする。
 * オンライン復帰時か次回起動時に掃き出す。
 */
import { db, newEntity, nowIso } from '@/db/db';
import { getSecret } from '@/db/repositories/settings';
import { MEAL_SLOT_LABELS } from '@/lib/labels';
import type { AppSettings } from '@/db/schema';

export interface SchedulePayload {
  token: string;
  pushTime: string;
  schedule: { date: string; slot: string; text: string }[];
}

/** 送る中身を組み立てる。個人を特定できる情報は入れない */
export async function buildPayload(settings: AppSettings): Promise<SchedulePayload | null> {
  const token = await getSecret('gas_shared_token');
  if (!token) return null;

  const plan = (await db.weekPlans.where('deleted').equals(0).reverse().sortBy('weekStart'))[0];
  if (!plan) return null;

  const assignments = await db.containerAssignments
    .where('weekPlanId')
    .equals(plan.id)
    .toArray();

  // 同じ日・同じ枠に複数人ぶんが並ぶので、容器ラベルでまとめる
  const schedule = assignments
    .filter((a) => a.deleted === 0)
    .sort((a, b) => a.intendedDate.localeCompare(b.intendedDate))
    .map((a) => ({
      date: a.intendedDate,
      slot: MEAL_SLOT_LABELS[a.intendedSlot],
      text: a.containerLabel + ' ' + a.recipeTitle + ' ' + Math.round(a.grams) + 'g',
    }));

  return { token, pushTime: settings.notify.dailyPushTime, schedule };
}

export type PostResult<T extends object> = { ok: boolean; error?: string } & Partial<T>;

/** GAS を呼ぶ。カレンダー側（calendar/gasCalendar.ts）も同じ入口を使う */
export async function post<T extends object = Record<string, never>>(
  url: string,
  body: unknown,
): Promise<PostResult<T>> {
  const fail = (error: string) => ({ ok: false, error }) as PostResult<T>;
  try {
    const res = await fetch(url, {
      method: 'POST',
      // GAS の doPost は text/plain でも postData.contents で受け取れる。
      // application/json にすると CORS のプリフライトで弾かれるため避ける
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    if (!res.ok) return fail('HTTP ' + res.status);
    const json = (await res.json()) as { ok?: boolean; error?: string } & Partial<T>;
    return json.ok ? ({ ...json, ok: true } as PostResult<T>) : fail(json.error ?? '不明なエラー');
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** 疎通確認。設定画面のボタンから呼ぶ */
export async function ping(url: string, token: string) {
  return post(url, { action: 'ping', token });
}

/** テスト通知を1通送る */
export async function sendTest(url: string, token: string) {
  return post(url, { action: 'test', token });
}

/**
 * スケジュールを同期する。
 * 中身が前回と同じなら送らない（GAS の実行回数を無駄にしない）。
 */
export async function syncSchedule(settings: AppSettings): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
}> {
  const url = settings.notify.gasEndpointUrl;
  if (!url) return { ok: false, error: '送信先が未設定です' };

  const payload = await buildPayload(settings);
  if (!payload) return { ok: false, error: '共有トークンか週のプランがありません' };

  const hash = await hashOf(payload.schedule);
  if (hash === settings.notify.lastSyncedHash) return { ok: true, skipped: true };

  const r = await post(url, { ...payload, action: 'schedule' });
  if (!r.ok) {
    // 失敗したら送信箱に積む。オンライン復帰時に再送する
    await db.outbox.add({
      ...newEntity(),
      target: 'gas_schedule',
      payload: { url, body: payload },
      attempts: 1,
      lastAttemptAt: nowIso(),
      ...(r.error ? { lastError: r.error } : {}),
      status: 'pending',
    });
    return r;
  }

  const cur = await db.settings.get('singleton');
  if (cur) {
    await db.settings.put({
      ...cur,
      notify: { ...cur.notify, lastSyncedAt: nowIso(), lastSyncedHash: hash },
      updatedAt: nowIso(),
    });
  }
  return { ok: true };
}

/** 溜まった送信をまとめて流す。起動時とオンライン復帰時に呼ぶ */
export async function flushOutbox(): Promise<number> {
  const pending = await db.outbox.where('status').equals('pending').toArray();
  let sent = 0;
  for (const entry of pending) {
    const p = entry.payload as { url: string; body: SchedulePayload } | undefined;
    if (!p?.url) continue;
    const r = await post(p.url, { ...p.body, action: 'schedule' });
    await db.outbox.put({
      ...entry,
      attempts: entry.attempts + 1,
      lastAttemptAt: nowIso(),
      ...(r.error ? { lastError: r.error } : {}),
      // 何度も失敗するものは諦める。無限に再送し続けない
      status: r.ok ? 'sent' : entry.attempts >= 4 ? 'failed' : 'pending',
      updatedAt: nowIso(),
    });
    if (r.ok) sent++;
  }
  return sent;
}

async function hashOf(v: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(v));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
