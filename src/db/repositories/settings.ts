/**
 * 設定・秘密情報の読み書き。UI は db を直接触らず、ここを通す。
 */
import { db, nowIso } from '../db';
import type { AppSettings, Secret } from '../schema';
import { DEFAULT_SETTINGS } from '../seed';

export async function getSettings(): Promise<AppSettings> {
  return (await db.settings.get('singleton')) ?? DEFAULT_SETTINGS;
}

/** 部分更新。ネストしたセクションは呼び出し側で丸ごと渡す */
export async function updateSettings(
  patch: Partial<Omit<AppSettings, 'id' | 'updatedAt' | 'schemaVersion'>>,
): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = { ...current, ...patch, updatedAt: nowIso() };
  await db.settings.put(next);
  return next;
}

/**
 * 現在値を読んでから差分を作る更新。
 * チップを続けて2回押すと、2回目が1回目の描画前の値を元にパッチを作り、
 * 1回目の変更が消える。トランザクションの中で読み直して防ぐ。
 */
export async function updateCooking(
  fn: (c: AppSettings['cooking']) => Partial<AppSettings['cooking']>,
): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const cur = (await db.settings.get('singleton')) ?? DEFAULT_SETTINGS;
    await db.settings.put({
      ...cur,
      cooking: { ...cur.cooking, ...fn(cur.cooking) },
      updatedAt: nowIso(),
    });
  });
}

export async function updateShopping(
  fn: (c: AppSettings['shopping']) => Partial<AppSettings['shopping']>,
): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const cur = (await db.settings.get('singleton')) ?? DEFAULT_SETTINGS;
    await db.settings.put({
      ...cur,
      shopping: { ...cur.shopping, ...fn(cur.shopping) },
      updatedAt: nowIso(),
    });
  });
}

export async function getSecret(key: Secret['key']): Promise<string | undefined> {
  return (await db.secrets.get(key))?.value;
}

export async function setSecret(key: Secret['key'], value: string): Promise<void> {
  if (value === '') {
    await db.secrets.delete(key);
    return;
  }
  await db.secrets.put({ key, value, updatedAt: nowIso() });
}
