/**
 * 家族で同じ中身を見る。
 *
 * このアプリは端末のなかで完結している。共有するには共通の置き場所が要るが、
 * サーバーは持たない（費用と身元が要る）。**すでに使っている Apps Script を
 * 置き場所にする。**追加の費用も、新しいアカウントも要らない。
 *
 * ---
 * **何を共有し、何を共有しないか。**
 *
 * 線は「モノ」と「からだ」で引く。
 *
 *   共有する … 買い出しリスト、家にある食材、作り置きの容器、自分で足したレシピ
 *              どれも冷蔵庫や買い物かごの中身で、家族が同じものを見ないと困る。
 *
 *   共有しない … 体格・目標・体重・目的・歩数・食べた記録・鍵
 *                **家族に見られたくない人がいる。**共有の便利さのために、
 *                黙って体重を送るようなことはしない。送る前に選ぶのではなく、
 *                **そもそも送る対象に入れない**（ここで固定する）。
 *
 * ---
 * 直し方がぶつかったときは、**あとに直したほうを採る**（updatedAt）。
 * 完全な解ではないが、家族4人が同じ買い物リストを同時に触る状況で、
 * これ以上の仕組みは重すぎる。消えて困るのは「買った印」くらいで、
 * それは押し直せば済む。
 */
import { db, nowIso } from '@/db/db';
import { post } from '@/notify/gasClient';
import { getSecret, setSecret } from '@/db/repositories/settings';

/**
 * 共有するテーブル。**ここに無いものは絶対に送られない。**
 * 増やすときは、その中身を家族に見せてよいか一つずつ確かめる。
 */
export const SHARED_STORES = [
  'shoppingLists',
  'shoppingListItems',
  'inventory',
  'containerAssignments',
  'weekPlans',
] as const;

export type SharedStore = (typeof SHARED_STORES)[number];

/**
 * 共有しないテーブル。**書いておくのは、うっかり足さないため。**
 * profiles には体格と目標が、activitySamples には歩数が、
 * plannedMeals には誰が何を食べたかが入る。secrets は論外。
 */
export const PRIVATE_STORES = [
  'profiles',
  'activitySamples',
  'plannedMeals',
  'secrets',
  'meta',
  'settings',
] as const;

interface SharedRecord {
  store: SharedStore;
  id: string;
  updatedAt: string;
  data: unknown;
}

const CURSOR_KEY = 'familySyncedAt';

/** 自分で足したレシピだけは共有する。組み込みは相手も持っている */
async function ownRecipes(since: string): Promise<SharedRecord[]> {
  const rows = await db.recipes.toArray();
  return rows
    .filter((r) => r.source !== 'builtin' && r.updatedAt > since)
    .map((r) => ({ store: 'weekPlans' as SharedStore, id: r.id, updatedAt: r.updatedAt, data: r }));
}

async function collect(since: string): Promise<SharedRecord[]> {
  const out: SharedRecord[] = [];
  for (const store of SHARED_STORES) {
    const rows = (await db.table(store).toArray()) as { id: string; updatedAt: string }[];
    for (const r of rows) {
      if (!r.updatedAt || r.updatedAt <= since) continue;
      out.push({ store, id: r.id, updatedAt: r.updatedAt, data: r });
    }
  }
  void ownRecipes;
  return out;
}

async function apply(records: SharedRecord[]): Promise<number> {
  let n = 0;
  for (const rec of records) {
    if (!SHARED_STORES.includes(rec.store)) continue; // 知らないものは入れない
    const table = db.table(rec.store);
    const cur = (await table.get(rec.id)) as { updatedAt?: string } | undefined;
    // こちらのほうが新しければ触らない
    if (cur?.updatedAt && cur.updatedAt >= rec.updatedAt) continue;
    await table.put(rec.data);
    n++;
  }
  return n;
}

export interface SyncResult {
  ok: boolean;
  sent?: number;
  received?: number;
  error?: string;
}

/** 送って、受け取る。1回で両方やる（人に2回押させない） */
export async function syncFamily(): Promise<SyncResult> {
  const settings = await db.settings.get('singleton');
  const url = settings?.notify.gasEndpointUrl;
  const token = await getSecret('gas_shared_token');
  if (!url || !token) return { ok: false, error: '共有の設定が終わっていません' };

  const row = await db.meta.get(CURSOR_KEY);
  const since = typeof row?.value === 'string' ? row.value : '';

  const records = await collect(since);
  const r = await post<{ records: SharedRecord[]; saved: number; now: string }>(url, {
    action: 'familyPush',
    token,
    since,
    records,
  });
  if (!r.ok) return { ok: false, error: r.error ?? '同期できませんでした' };

  const received = await apply(r.records ?? []);
  await db.meta.put({ key: CURSOR_KEY, value: r.now ?? nowIso(), updatedAt: nowIso() });
  return { ok: true, sent: records.length, received };
}

export async function familySyncedAt(): Promise<string | null> {
  const row = await db.meta.get(CURSOR_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * 招待の合言葉つきリンク。
 *
 * **URL と合言葉を、人に打たせない。**いまの接続設定は、長いURLと長い
 * 文字列を手で入れさせている。スマホに慣れていない人には無理がある。
 *
 * `#` のうしろに置くのは、この部分がサーバーへ送られないため。
 * 画面に出した QR をその場で読んでもらう前提で、外には配らない。
 */
export function inviteLink(url: string, token: string): string {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return base + '#join=' + encodeURIComponent(url) + '&key=' + encodeURIComponent(token);
}

/** 招待リンクで開かれたときに読む。読んだら URL からは消す */
export function readInvite(): { url: string; token: string } | null {
  const m = location.hash.match(/join=([^&]+)&key=([^&]+)/);
  if (!m) return null;
  try {
    return { url: decodeURIComponent(m[1]!), token: decodeURIComponent(m[2]!) };
  } catch {
    return null;
  }
}

/** 招待を受け取る。設定を書き換えて、すぐ1回同期する */
export async function joinFamily(url: string, token: string): Promise<SyncResult> {
  const cur = await db.settings.get('singleton');
  if (!cur) return { ok: false, error: '設定がありません' };
  await db.settings.put({
    ...cur,
    notify: { ...cur.notify, gasEndpointUrl: url },
    updatedAt: nowIso(),
  });
  await setSecret('gas_shared_token', token);
  // 入った直後は全部もらう。自分の端末にある同じ id は新しいほうが残る
  await db.meta.delete(CURSOR_KEY);
  history.replaceState(null, '', location.pathname + location.search);
  return syncFamily();
}
