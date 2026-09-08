/**
 * Google カレンダーの予定を読む。
 *
 * 経路は LINE と同じ GAS（notify/gas/Code.gs の `events`）。
 * スクリプトが本人のアカウントで動くので、
 *   - Google Cloud のプロジェクトも OAuth の同意画面も要らない
 *   - アプリに秘密を埋め込まない（本人が控える合言葉だけ）
 *   - 「未確認のアプリ」の警告が出ない（本人が本人のスクリプトを許可するだけ）
 * ブラウザから Google の API を直接叩く方式は、匿名運営と相性が悪いので採らない。
 *
 * 受け取るのは件名と時刻だけ。相手先・場所・本文は GAS 側で返していない。
 * 端末の `meta` に置き、6時間より古ければ今日タブを開いたときに取り直す。
 */
import { db, nowIso } from '@/db/db';
import { getSecret } from '@/db/repositories/settings';
import { post } from '@/notify/gasClient';
import { buildTimeline, toMin } from '@/features/rhythm/logic/timeline';
import type { CalendarBlock } from '@/features/rhythm/logic/timeline';
import { modeFor } from '@/features/planner/logic/cadence';
import { perDayMinutes } from '@/features/planner/logic/time';
import { handsOnMinutes } from '@/db/data/build';
import { todayIso } from '@/lib/labels';
import type { AppSettings, ISODate, MealSlot, TimeOfDay, Weekday } from '@/db/schema';

export interface CalendarEvent {
  date: ISODate;
  start: TimeOfDay;
  end: TimeOfDay;
  title: string;
  allDay: boolean;
}

export interface CalendarCache {
  syncedAt: string;
  events: CalendarEvent[];
}

const META_KEY = 'calendarEvents';

/**
 * 取り直す間隔。**場面で変える。**
 *
 * 6時間だけを見ていたので、Google カレンダーを直してアプリに戻っても、
 * 今日の流れは半日前のままだった（本人指摘）。
 *
 * 画面に戻ってきた直後は「たったいま別のアプリで直してきた」可能性が高いので
 * 短くする。開きっぱなしのときは、そこまで急がない。
 */
export const CALENDAR_STALE = {
  /** ふだん（起動時） */
  open: 6 * 60 * 60 * 1000,
  /** 別のアプリから戻ってきたとき。カレンダーを直した直後を拾う */
  foreground: 60 * 1000,
  /** 開いたまま置いているとき */
  polling: 10 * 60 * 1000,
};
const STALE_MS = CALENDAR_STALE.open;

export async function readCache(): Promise<CalendarCache | null> {
  const row = await db.meta.get(META_KEY);
  return (row?.value as CalendarCache | undefined) ?? null;
}

/** 予定を取りに行って端末に置く。設定画面のボタンと、今日タブの自動更新から呼ぶ */
export async function syncCalendar(
  settings: AppSettings,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const url = settings.notify.gasEndpointUrl;
  const token = await getSecret('gas_shared_token');
  if (!url || !token) return { ok: false, error: '接続設定が終わっていません' };

  const r = await post<{ events: CalendarEvent[] }>(url, {
    action: 'events',
    token,
    days: settings.calendar.lookaheadDays || 7,
  });
  if (!r.ok) return { ok: false, error: r.error ?? '取得できませんでした' };

  const events = (r.events ?? []).map((e) => ({
    date: e.date,
    start: e.start,
    end: e.end,
    title: String(e.title ?? '').slice(0, 40),
    allDay: Boolean(e.allDay),
  }));
  const cache: CalendarCache = { syncedAt: nowIso(), events };
  await db.meta.put({ key: META_KEY, value: cache, updatedAt: nowIso() });

  const cur = await db.settings.get('singleton');
  if (cur) {
    await db.settings.put({
      ...cur,
      calendar: { ...cur.calendar, lastSyncedAt: cache.syncedAt },
      updatedAt: nowIso(),
    });
  }
  return { ok: true, count: events.length };
}

/**
 * 古ければ取り直す。失敗しても黙る（今日タブを開くたびに出るエラーは害）。
 * どこまでを「古い」とするかは呼ぶ側が決める（戻ってきた直後は短く見る）。
 */
export async function syncCalendarIfStale(
  settings: AppSettings,
  maxAgeMs: number = STALE_MS,
): Promise<void> {
  if (!settings.calendar.enabled) return;
  const cache = await readCache();
  const age = cache ? Date.now() - new Date(cache.syncedAt).getTime() : Infinity;
  if (age < maxAgeMs) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  await syncCalendar(settings);
}

/** 今日の流れに載せる形にする。終日の予定は時間を持たないので外す */
export function blocksFor(cache: CalendarCache | null, date: ISODate): CalendarBlock[] {
  if (!cache) return [];
  return cache.events
    .filter((e) => e.date === date && !e.allDay && e.start !== e.end)
    .sort((a, b) => toMin(a.start) - toMin(b.start))
    .map((e) => ({ title: e.title, start: e.start, end: e.end }));
}

// ---------------------------------------------------------------------------
// 書き出し（Prepflow カレンダー）
// ---------------------------------------------------------------------------

export interface PublishItem {
  date: ISODate;
  start?: TimeOfDay;
  minutes?: number;
  title: string;
  description?: string;
  allDay?: boolean;
}

const PUBLISH_HASH_KEY = 'calendarPublishedHash';

const SLOT_KEY: Record<MealSlot, string> = {
  breakfast: '朝食',
  lunch: '昼食',
  dinner: '夕食',
  snack: '間食',
};

/**
 * 献立を Google カレンダーに書く中身を組む。
 *
 * 時刻は「今日の流れ」と同じ計算で出す。その日の予定（読み込んだもの）を入れて
 * 食事と調理の時刻を決めるので、カレンダー上で予定と食事が食い違わない。
 * **過ぎた日は入れない。**書く先の期間も今日以降だけにし、過去は消しも書きもしない。
 */
export async function buildPublishItems(settings: AppSettings): Promise<{
  items: PublishItem[];
  from: ISODate;
  to: ISODate;
} | null> {
  const plan = (await db.weekPlans.where('deleted').equals(0).reverse().sortBy('weekStart'))[0];
  if (!plan) return null;

  const today = todayIso();
  const meals = (await db.plannedMeals.where('weekPlanId').equals(plan.id).toArray())
    .filter((m) => m.deleted === 0 && m.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (meals.length === 0) return null;

  const habits = await db.habits.where('deleted').equals(0).toArray();
  const recipes = await db.recipes.toArray();
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const cache = await readCache();
  const daily = modeFor(settings.cooking.cookSessionsPerWeek ?? 1) === 'daily';

  const items: PublishItem[] = [];
  const dates = [...new Set(meals.map((m) => m.date))];

  for (const date of dates) {
    const todays = meals.filter((m) => m.date === date);
    const weekday = new Date(date + 'T00:00:00').getDay() as Weekday;

    // 毎日作る人は「作る」の枠も書く。手を動かす時間はその日の料理から
    let cookMinutes = 0;
    if (daily) {
      const ids = new Set(todays.flatMap((m) => m.items.map((i) => i.recipeId)));
      const hands = [...ids].reduce((n, id) => {
        const r = byId.get(id);
        return n + (r ? handsOnMinutes(r) : 0);
      }, 0);
      cookMinutes = hands > 0 ? Math.round(perDayMinutes(hands, 1)) : 0;
    }

    const tl = buildTimeline({
      rhythm: settings.rhythm,
      habits,
      weekday,
      coverSlots: settings.cooking.coverSlots,
      events: blocksFor(cache, date),
      ...(cookMinutes > 0 ? { cookMinutes } : {}),
    });
    const timeOf = (label: string) => tl.find((e) => e.kind === 'meal' && e.label === label)?.time;

    // 同じ日・同じ枠に複数人ぶんが並ぶので、枠ごとに1件にまとめる
    const bySlot = new Map<MealSlot, typeof todays>();
    for (const m of todays) bySlot.set(m.slot, [...(bySlot.get(m.slot) ?? []), m]);

    for (const [slot, list] of bySlot) {
      const titles = [...new Set(list.flatMap((m) => m.items.map((i) => i.recipeTitle)))];
      const kcal = list.reduce((n, m) => n + m.nutrition.kcal, 0) / list.length;
      const protein = list.reduce((n, m) => n + m.nutrition.proteinG, 0) / list.length;
      const start = timeOf(SLOT_KEY[slot]) ?? (slot === 'snack' ? '15:00' : '19:00');
      items.push({
        date,
        start,
        minutes: 30,
        title: SLOT_KEY[slot] + ' ' + titles.join('・'),
        description: Math.round(kcal) + ' kcal ・ P ' + Math.round(protein) + 'g',
      });
    }

    const cook = tl.find((e) => e.kind === 'cook');
    if (cook && cook.endTime) {
      items.push({
        date,
        start: cook.time,
        minutes: Math.max(5, toMin(cook.endTime) - toMin(cook.time)),
        title: '今日のぶんを作る',
        description: 'Prepflow',
      });
    }
  }

  // 買い出しの日。今日以降なら終日で入れる
  const list = (await db.shoppingLists.where('weekPlanId').equals(plan.id).toArray())[0];
  if (list && list.shoppingDate >= today && list.status !== 'done') {
    items.push({ date: list.shoppingDate, title: '買い出し', allDay: true, description: 'Prepflow' });
  }

  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const range = [from, to, ...(list ? [list.shoppingDate] : [])].sort();
  return { items, from: range[0]!, to: range[range.length - 1]! };
}

/**
 * 書いた献立をカレンダーから消す。
 *
 * `publish` は「消してから書く」ので入れ替えはできるが、
 * **書き直さずに消す**ことができなかった。手で消すしかない状態だった。
 *
 * 消したあとは書き出しの控え（ハッシュ）も捨てる。
 * 残しておくと、同じ献立を書き直すときに「中身が同じ」と判定されて
 * 書き込みが飛ばされ、カレンダーが空のままになる。
 */
export async function clearCalendar(
  settings: AppSettings,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const url = settings.notify.gasEndpointUrl;
  const token = await getSecret('gas_shared_token');
  if (!url || !token) return { ok: false, error: '接続設定が終わっていません' };

  const built = await buildPublishItems(settings);
  if (!built) return { ok: false, error: '消す範囲が分かりません（献立がありません）' };

  const r = await post<{ count: number }>(url, {
    action: 'clear',
    token,
    from: built.from,
    to: built.to,
  });
  if (!r.ok) return { ok: false, error: r.error ?? '消せませんでした' };

  await db.meta.delete(PUBLISH_HASH_KEY);
  return { ok: true, count: r.count ?? 0 };
}

/** 献立を書き出す。中身が前回と同じなら書かない（GAS の実行回数を無駄にしない） */
export async function publishMenus(
  settings: AppSettings,
): Promise<{ ok: boolean; count?: number; skipped?: boolean; error?: string }> {
  const url = settings.notify.gasEndpointUrl;
  const token = await getSecret('gas_shared_token');
  if (!url || !token) return { ok: false, error: '接続設定が終わっていません' };

  const built = await buildPublishItems(settings);
  if (!built) return { ok: false, error: '今日以降の献立がありません' };

  const hash = await hashOf(built);
  const prev = (await db.meta.get(PUBLISH_HASH_KEY))?.value as string | undefined;
  if (prev === hash) return { ok: true, skipped: true, count: built.items.length };

  const r = await post<{ count: number }>(url, {
    action: 'publish',
    token,
    from: built.from,
    to: built.to,
    items: built.items,
  });
  if (!r.ok) return { ok: false, error: r.error ?? '書き出せませんでした' };

  await db.meta.put({ key: PUBLISH_HASH_KEY, value: hash, updatedAt: nowIso() });
  const cur = await db.settings.get('singleton');
  if (cur) {
    await db.settings.put({
      ...cur,
      calendar: { ...cur.calendar, lastPublishedAt: nowIso() },
      updatedAt: nowIso(),
    });
  }
  return { ok: true, count: r.count ?? built.items.length };
}

/** 献立を確定したときに呼ぶ。オフなら何もしない。失敗しても黙る（確定の流れを止めない） */
export async function publishIfEnabled(): Promise<void> {
  const s = await db.settings.get('singleton');
  if (!s?.calendar.enabled || !s.calendar.publishEnabled) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  await publishMenus(s).catch(() => undefined);
}

async function hashOf(v: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(v));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
