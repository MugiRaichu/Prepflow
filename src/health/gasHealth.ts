import { db, newEntity, nowIso } from '@/db/db';
import { post } from '@/notify/gasClient';
import { getSecret } from '@/db/repositories/settings';
import type { ActivitySample } from '@/db/schema';

/**
 * iPhone のヘルスケアから、歩数と消費カロリーを取り込む。
 *
 * **Web アプリから HealthKit は読めない。**Apple が web に API を出していない
 * ためで、実装の工夫で越えられる壁ではない。
 *
 * 代わりに iPhone のショートカットに読ませて、GAS へ送ってもらう。
 * ショートカット側は「URLの内容を取得」で POST するので**画面は開かない**。
 * オートメーションに載せれば、設定は最初の1回で済む。
 *
 *   毎晩22:00（オートメーション）
 *     ショートカット → ヘルスケアを読む → GAS へ POST（画面は開かない）
 *       ↓
 *     GAS が日付ごとに貯める
 *       ↓
 *     オヒツ を開いたときにまとめて取り込む（カレンダーと同じ経路）
 *
 * GAS はすでにカレンダー連携で使っている。新しい仕組みは要らない。
 * 通るのは日付・歩数・kcal だけで、名前も位置も通さない。
 */

export interface HealthSample {
  date: string;
  steps: number;
  activeKcal: number;
}

/** 取り込みの間隔。1日に何度も開くので、そのたびに取りに行かない */
export const HEALTH_STALE = 6 * 60 * 60 * 1000;
const LAST_KEY = 'healthPulledAt';

/**
 * GAS に貯まっているぶんを取り込む。
 * 同じ日のデータは上書きする（ショートカットが日中に何度動いても増えない）。
 */
/**
 * 受け取ったぶんを端末に置く。
 *
 * 取りに行く部分と分けてあるのは、**1往復でカレンダーと歩数をまとめて
 * 受け取る経路**（notify/gasSync.ts）からも、同じ置き方を使うため。
 */
export async function applyHealth(samples: HealthSample[]): Promise<number> {
  const profile = (await db.profiles.where('isActive').equals(1).toArray())[0];
  // 取り込む先が無くても、来たことは覚えておく（次に開くたびに叩き直さない）
  await db.meta.put({ key: LAST_KEY, value: nowIso(), updatedAt: nowIso() });
  if (!profile || samples.length === 0) return 0;

  let saved = 0;
  await db.transaction('rw', db.activitySamples, async () => {
    const mine = await db.activitySamples.where('profileId').equals(profile.id).toArray();
    const byDate = new Map(mine.map((s) => [s.date, s]));

    for (const s of samples) {
      if (!s.date) continue;
      const cur = byDate.get(s.date);
      const next: ActivitySample = {
        ...(cur ?? newEntity()),
        ...(cur ?? {}),
        profileId: profile.id,
        date: s.date,
        steps: s.steps,
        activeKcal: s.activeKcal,
        source: 'healthkit_export',
        updatedAt: nowIso(),
      } as ActivitySample;
      await db.activitySamples.put(next);
      saved += 1;
    }
  });

  return saved;
}

/** 歩数だけを取りに行く。設定画面の「いま取り込む」から呼ぶ */
export async function pullHealth(): Promise<number> {
  const settings = await db.settings.get('singleton');
  const url = settings?.notify.gasEndpointUrl;
  const token = await getSecret('gas_shared_token');
  if (!url || !token) return 0;

  const res = await post<{ samples: HealthSample[] }>(url, { action: 'healthPull', token });
  if (!res.ok) return 0;
  return applyHealth(res.samples ?? []);
}

/** 最後に取り込んだ日時。設定画面に出す */
export async function healthPulledAt(): Promise<string | null> {
  const row = await db.meta.get(LAST_KEY);
  return typeof row?.value === 'string' ? row.value : null;
}

/** 直近の記録。設定画面で「届いているか」を見せる */
export async function recentSamples(days = 7): Promise<ActivitySample[]> {
  const all = await db.activitySamples.toArray();
  return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, days);
}
