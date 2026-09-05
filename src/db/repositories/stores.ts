/**
 * よく行く店の価格水準。
 *
 * 店ごとの実売価格を取ってくることはできないので、
 * 「マスタの想定より何割高い店か」という係数1つを、本人のレシート合計から学ぶ。
 *
 * 食材どうしの相対価格（鶏むねと豚こまの比）は店が変わってもあまり変わらない。
 * 変わるのは全体の水準なので、係数1つで足りる。
 */
import { db, newEntity, nowIso } from '@/db/db';
import { PRICE_BAND_FACTOR } from '@/db/schema';
import type { PriceBand, Store } from '@/db/schema';

/** 既定の店。無ければ「ふつう」の水準で作る */
export async function getDefaultStore(): Promise<Store> {
  const found = (await db.stores.where('deleted').equals(0).toArray()).find(
    (s) => s.isDefault === 1,
  );
  if (found) return found;

  const created: Store = {
    ...newEntity(),
    name: 'よく行く店',
    priceFactor: 1,
    sampleCount: 0,
    observedFactors: [],
    isDefault: 1,
  };
  await db.stores.add(created);
  return created;
}

export async function renameStore(id: string, name: string): Promise<void> {
  const s = await db.stores.get(id);
  if (!s) return;
  await db.stores.put({ ...s, name, updatedAt: nowIso() });
}

/**
 * 価格帯を選び直す。実績が入る前の出発点をずらすだけなので、
 * すでに実績が溜まっている店では控えめに反映する。
 */
export async function setPriceBand(id: string, band: PriceBand): Promise<void> {
  const s = await db.stores.get(id);
  if (!s) return;
  const target = PRICE_BAND_FACTOR[band];
  // 実績があるほど、手で選んだ帯より実測を優先する
  const weight = s.sampleCount >= 3 ? 0.3 : 1;
  await db.stores.put({
    ...s,
    priceFactor: Math.round((s.priceFactor * (1 - weight) + target * weight) * 100) / 100,
    updatedAt: nowIso(),
  });
}

/**
 * レシートの合計から係数を学ぶ。
 *
 * 平均ではなく中央値を採る。1週間の買い物には特売やついで買い（お菓子・飲料）が
 * 混ざるので、平均だと1回の大きな買い物に引っ張られて見込みが跳ねる。
 * 中央値なら、そういう回が1つ入っても動かない。
 */
export async function learnFromReceipt(
  storeId: string,
  actualTotal: number,
  estimatedTotal: number,
): Promise<{ before: number; after: number } | null> {
  const s = await db.stores.get(storeId);
  if (!s || estimatedTotal <= 0 || actualTotal <= 0) return null;

  // 見込みは既に係数を掛けた値なので、掛け直して「素の想定に対する倍率」に戻す
  const implied = s.priceFactor * (actualTotal / estimatedTotal);
  // 極端な値は入力ミスか、その週が特殊だったとみなして捨てる
  if (implied < 0.4 || implied > 2.5) return null;

  const observedFactors = [...s.observedFactors, implied].slice(-8);
  const sorted = [...observedFactors].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  const clamped = Math.round(Math.min(Math.max(median, 0.5), 2) * 100) / 100;

  await db.stores.put({
    ...s,
    priceFactor: clamped,
    sampleCount: s.sampleCount + 1,
    observedFactors,
    updatedAt: nowIso(),
  });

  return { before: s.priceFactor, after: clamped };
}

/** 見込み金額がどれくらい信用できるか。UI の但し書きに使う */
export function reliabilityOf(store: Store): 'unknown' | 'rough' | 'calibrated' {
  if (store.sampleCount === 0) return 'unknown';
  if (store.sampleCount < 3) return 'rough';
  return 'calibrated';
}
