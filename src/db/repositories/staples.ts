/**
 * 常備品（調味料など）の切れ時を当てる。
 *
 * 消費量を積み上げても当たらない。理由は3つ。
 *   - 目分量で入れるので、レシピの分量どおりには減らない
 *   - 献立に無い食事（卵かけご飯、朝の一杯）でも減る。これが最大の誤差源
 *   - 数ヶ月ぶんの誤差が積み上がり、残量より誤差のほうが大きくなる
 *
 * 代わりに「買った日」と「切れた日」だけを記録する。
 * 切れた瞬間は本人が必ず気づき、1タップで取れて、
 * しかも把握できない消費もすべて含んだ実測値になる。
 */
import { db, newEntity, nowIso } from '@/db/db';
import { todayIso } from '@/lib/labels';
import type { Ingredient, StapleStatus, UUID } from '@/db/schema';

const daysBetween = (a: string, b: string): number =>
  Math.round(
    (new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000,
  );

const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function statusOf(ingredientId: UUID): Promise<StapleStatus> {
  const found = await db.stapleStatus.where('ingredientId').equals(ingredientId).first();
  if (found) return found;
  const created: StapleStatus = { ...newEntity(), ingredientId, depletedAt: [] };
  await db.stapleStatus.add(created);
  return created;
}

/** 買ったことを記録する。買い出しを終えたときに呼ぶ */
export async function markPurchased(ingredientIds: UUID[]): Promise<void> {
  const today = todayIso();
  for (const id of ingredientIds) {
    const st = await statusOf(id);
    await db.stapleStatus.put({ ...st, lastPurchasedAt: today, updatedAt: nowIso() });
  }
}

/**
 * 切れたことを記録する。
 * ここで初めて「この家では何日もつか」が実測として入る。
 */
export async function markDepleted(ingredientId: UUID): Promise<void> {
  const today = todayIso();
  const st = await statusOf(ingredientId);

  const depletedAt = [...st.depletedAt, today].slice(-4);
  let observedIntervalDays = st.observedIntervalDays;

  if (st.lastPurchasedAt) {
    const interval = daysBetween(st.lastPurchasedAt, today);
    // 極端な値は誤タップとみなす
    if (interval >= 3 && interval <= 400) {
      // 1回目はそのまま採用し、以後は half-life 的に寄せる。
      // 特売でまとめ買いした回などに引っ張られすぎないため
      observedIntervalDays = observedIntervalDays
        ? Math.round(observedIntervalDays * 0.5 + interval * 0.5)
        : interval;
    }
  }

  await db.stapleStatus.put({
    ...st,
    depletedAt,
    ...(observedIntervalDays ? { observedIntervalDays } : {}),
    updatedAt: nowIso(),
  });

  // 在庫は0にする。切れたと言っているので残量の記録は当てにならない
  const rows = await db.inventory.where('ingredientId').equals(ingredientId).toArray();
  for (const r of rows) {
    if (r.deleted === 0) await db.inventory.put({ ...r, quantity: 0, deleted: 1, updatedAt: nowIso() });
  }
}

/**
 * 「まだある」と答えてもらう。
 * 切れた記録と同じくらい役に立つ。予測より長くもっていることが分かるので、
 * 次に聞くタイミングを後ろへずらせる。
 */
export async function markStillHave(ingredientId: UUID): Promise<void> {
  const st = await statusOf(ingredientId);
  await db.stapleStatus.put({ ...st, lastConfirmedAt: todayIso(), updatedAt: nowIso() });
}

export interface StaplePrediction {
  ingredient: Ingredient;
  /** 切れると見込む日。予測できないときは null */
  runsOutOn: string | null;
  /** 今日から何日後か */
  daysLeft: number | null;
  /** 実測にもとづくか、献立からの推定か */
  basis: 'observed' | 'estimated' | 'unknown';
  /** 直近で「まだある」と答えた日 */
  confirmedAt?: string;
}

/**
 * 切れ時の見込み。
 * 実測があればそれを使う。無ければ献立での使用量から推定し、
 * アプリが把握しない消費のぶんだけ短く見る。
 */
export async function predictStaples(
  weeklyUsageGrams: Map<UUID, number>,
  outsideUseRatio: number,
): Promise<StaplePrediction[]> {
  const staples = (await db.ingredients.where('deleted').equals(0).toArray()).filter(
    (i) => i.isStaple === 1,
  );
  const statuses = await db.stapleStatus.toArray();
  const byIngredient = new Map(statuses.map((s) => [s.ingredientId, s]));
  const today = todayIso();

  return staples.map((ingredient) => {
    const st = byIngredient.get(ingredient.id);
    const from = st?.lastPurchasedAt;

    // 「まだある」と答えた日より前に切れることはない。
    // その日から最低1週間は持つものとして予測を後ろへずらす
    const floor = st?.lastConfirmedAt ? addDays(st.lastConfirmedAt, 7) : null;
    const applyFloor = (d: string) => (floor && d < floor ? floor : d);

    if (st?.observedIntervalDays && from) {
      const runsOutOn = applyFloor(addDays(from, st.observedIntervalDays));
      return {
        ingredient,
        runsOutOn,
        daysLeft: daysBetween(today, runsOutOn),
        basis: 'observed' as const,
        ...(st.lastConfirmedAt ? { confirmedAt: st.lastConfirmedAt } : {}),
      };
    }

    const perWeek = weeklyUsageGrams.get(ingredient.id) ?? 0;
    if (perWeek <= 0 || !from) {
      return { ingredient, runsOutOn: null, daysLeft: null, basis: 'unknown' as const };
    }

    // 献立ぶんだけでは足りない。把握できない消費のぶんを上乗せして短く見る
    const effectivePerWeek = perWeek / Math.max(1 - outsideUseRatio, 0.2);
    const weeks = ingredient.purchase.gramsPerUnit / effectivePerWeek;
    const runsOutOn = applyFloor(addDays(from, Math.round(weeks * 7)));

    return {
      ingredient,
      runsOutOn,
      daysLeft: daysBetween(today, runsOutOn),
      basis: 'estimated' as const,
      ...(st?.lastConfirmedAt ? { confirmedAt: st.lastConfirmedAt } : {}),
    };
  });
}

/** 買い出しリストに載せるべき常備品。切れる1週間前から出す */
export function dueSoon(predictions: StaplePrediction[]): StaplePrediction[] {
  return predictions
    .filter((p) => p.daysLeft != null && p.daysLeft <= 7)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
}

/**
 * 「残りを見てほしい」と頼む対象。
 *
 * 全部の調味料を並べて「切れたものを選んで」と聞くのは、
 * 台所を思い出させる作業を押しつけることになる（D-015 違反）。
 * 予測を持っているのはアプリなので、**アプリから名指しで聞く**。
 * 多くても3つに絞る。数が増えた時点で「一覧から探す」に戻ってしまう。
 */
export function needsCheck(
  predictions: StaplePrediction[],
  weeklyUsageGrams: Map<UUID, number>,
  limit = 3,
): StaplePrediction[] {
  const today = todayIso();

  const scored = predictions
    // 今週の献立で使うものだけ。使わない調味料の残量を聞いても意味がない
    .filter((p) => (weeklyUsageGrams.get(p.ingredient.id) ?? 0) > 0)
    // 今週すでに「まだある」と答えたものは聞き直さない
    .filter((p) => p.confirmedAt !== today)
    // 既に買い出しに載る（7日以内）ものは聞くまでもない
    .filter((p) => p.daysLeft == null || p.daysLeft > 7);

  const withDays = scored
    .filter((p) => p.daysLeft != null && p.daysLeft <= 21)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  // 予測できないもの（買った記録が無い等）は、使用量の多い順に聞く
  const unknown = scored
    .filter((p) => p.daysLeft == null)
    .sort(
      (a, b) =>
        (weeklyUsageGrams.get(b.ingredient.id) ?? 0) - (weeklyUsageGrams.get(a.ingredient.id) ?? 0),
    );

  return [...withDays, ...unknown].slice(0, limit);
}
