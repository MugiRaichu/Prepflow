/**
 * バックアップと保存領域の管理。
 *
 * ブラウザでは**データの置き場所をユーザーが選べない**。
 * IndexedDB も Cache API もブラウザのプロファイル配下に自動で置かれ、
 * パスを指定する API は存在しない（File System Access API は
 * デスクトップ Chrome 限定で、iOS には無い）。
 *
 * しかし消えるリスクは実在する。ブラウザは容量が逼迫すると退避（eviction）し、
 * とくに iOS Safari は一定期間使わないと消すことがある。
 * できるのは次の3つで、3つ目が実質的な「自分のフォルダに置く」に当たる。
 *
 *   1. 永続化を要求する（navigator.storage.persist）
 *   2. 使用量を見せる（navigator.storage.estimate）
 *   3. ファイルとして書き出す ← 唯一ユーザーが持てる形
 *
 * 書き出しには秘密情報を含めない（D-004）。
 */
import { db, nowIso } from '@/db/db';
import { SCHEMA_VERSION } from '@/db/db';

export interface StorageStatus {
  /** 退避されにくい状態か */
  persisted: boolean;
  /** 要求できる環境か */
  canRequest: boolean;
  usedBytes: number | null;
  quotaBytes: number | null;
}

export async function storageStatus(): Promise<StorageStatus> {
  const canRequest = typeof navigator !== 'undefined' && 'storage' in navigator;
  if (!canRequest) return { persisted: false, canRequest: false, usedBytes: null, quotaBytes: null };

  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  let usedBytes: number | null = null;
  let quotaBytes: number | null = null;
  if (navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    usedBytes = e.usage ?? null;
    quotaBytes = e.quota ?? null;
  }
  return { persisted, canRequest: true, usedBytes, quotaBytes };
}

/**
 * 永続化を要求する。
 * ブラウザによっては無言で拒否される（利用実績が浅いなど）。
 * 拒否されても動作に支障はないので、失敗しても静かに続ける。
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** 書き出しに含めるテーブル。secrets は意図的に除く */
const EXPORT_TABLES = [
  'settings',
  'profiles',
  'households',
  'habits',
  'equipment',
  'containers',
  'ingredients',
  'inventory',
  'stapleStatus',
  'stores',
  'recipes',
  'weekPlans',
  'plannedMeals',
  'containerAssignments',
  'shoppingLists',
  'shoppingListItems',
  'activitySamples',
  'daySchedules',
  'meta',
] as const;

export interface BackupFile {
  app: 'prepflow';
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const name of EXPORT_TABLES) {
    const table = (db as unknown as Record<string, { toArray?: () => Promise<unknown[]> }>)[name];
    if (table?.toArray) tables[name] = await table.toArray();
  }
  return {
    app: 'prepflow',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/** ブラウザからファイルとして保存させる */
export async function downloadBackup(): Promise<string> {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const name = 'prepflow-' + data.exportedAt.slice(0, 10) + '.json';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐに revoke するとダウンロードが始まらない環境があるので少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

export interface ImportResult {
  ok: boolean;
  restored: number;
  error?: string;
}

/**
 * 書き出したファイルから戻す。既存のデータは全部置き換える。
 * 部分的に混ぜると id の重複や不整合が起きるため、丸ごと入れ替えにする。
 */
export async function importAll(file: File): Promise<ImportResult> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(await file.text()) as BackupFile;
  } catch {
    return { ok: false, restored: 0, error: 'ファイルを読めませんでした' };
  }

  if (parsed?.app !== 'prepflow' || !parsed.tables) {
    return { ok: false, restored: 0, error: 'オヒツ の書き出しファイルではありません' };
  }
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      restored: 0,
      error: '新しいバージョンで書き出されています。アプリを更新してください',
    };
  }

  let restored = 0;
  const names = Object.keys(parsed.tables);
  const tables = names
    .map((n) => (db as unknown as Record<string, unknown>)[n])
    .filter(Boolean) as Parameters<typeof db.transaction>[1][];

  await db.transaction('rw', tables, async () => {
    for (const name of names) {
      const table = (db as unknown as Record<string, { clear?: () => Promise<void>; bulkPut?: (r: unknown[]) => Promise<unknown> }>)[name];
      if (!table?.clear || !table.bulkPut) continue;
      const rows = parsed.tables[name] ?? [];
      await table.clear();
      if (rows.length > 0) await table.bulkPut(rows);
      restored += rows.length;
    }
  });

  return { ok: true, restored };
}

// ---------------------------------------------------------------------------
// 自動書き出し
//
// 「ブラウザを閉じるとき」に書き出すことはできない。理由は2つ。
//   - ダウンロードは利用者の操作が要る。unload では出せない
//   - unload 中の非同期処理はブラウザに打ち切られる。バックグラウンドのタブが
//     殺されたときは beforeunload 自体が発火しない（とくにモバイル）
//
// そもそも保存は常に済んでいる（IndexedDB は即時書き込み）。
// 守りたいのは「退避されたとき」と「端末を失ったとき」で、
// どちらも**節目**で外に写しを取れば足りる。閉じるときである必要がない。
//
// 書き出し先を1回選んでおければ、以後は確認なしで上書きできる
// （File System Access API。デスクトップの Chrome / Edge のみ）。
// 対応しない環境では、前回からの経過を出して手動を促す。
// ---------------------------------------------------------------------------

const HANDLE_KEY = 'backupFileHandle';
const LAST_KEY = 'lastBackupAt';

type Handle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export const autoBackupSupported = (): boolean =>
  typeof window !== 'undefined' && 'showSaveFilePicker' in window;

async function storedHandle(): Promise<Handle | null> {
  const row = await db.meta.get(HANDLE_KEY);
  return (row?.value as Handle | undefined) ?? null;
}

/** 書き出し先を選ぶ。利用者の操作の中から呼ぶこと（ピッカーは操作が要る） */
export async function pickBackupFile(): Promise<boolean> {
  if (!autoBackupSupported()) return false;
  try {
    const handle = (await (
      window as unknown as {
        showSaveFilePicker: (o: unknown) => Promise<Handle>;
      }
    ).showSaveFilePicker({
      suggestedName: 'prepflow-backup.json',
      types: [{ description: 'オヒツ のバックアップ', accept: { 'application/json': ['.json'] } }],
    })) as Handle;
    await db.meta.put({ key: HANDLE_KEY, value: handle, updatedAt: nowIso() });
    await writeToHandle(handle);
    return true;
  } catch {
    // 利用者が取り消した場合もここに来る。失敗として扱わない
    return false;
  }
}

async function writeToHandle(handle: Handle): Promise<void> {
  const data = await exportAll();
  const w = await handle.createWritable();
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
  await db.meta.put({ key: LAST_KEY, value: data.exportedAt, updatedAt: nowIso() });
}

export type AutoBackupResult = 'written' | 'no-target' | 'needs-permission' | 'failed';

/**
 * 節目で自動的に書き出す。週プランの確定後と買い物の完了後に呼ぶ。
 *
 * 新しいセッションでは書き込み許可を取り直す必要があり、それには
 * 利用者の操作が要る。ここでは黙って諦め、設定画面で押してもらう。
 */
export async function autoBackup(): Promise<AutoBackupResult> {
  const handle = await storedHandle();
  if (!handle) return 'no-target';
  try {
    const state = handle.queryPermission
      ? await handle.queryPermission({ mode: 'readwrite' })
      : 'granted';
    if (state !== 'granted') return 'needs-permission';
    await writeToHandle(handle);
    return 'written';
  } catch {
    return 'failed';
  }
}

/** 許可を取り直す。利用者の操作の中から呼ぶこと */
export async function reauthorizeBackup(): Promise<boolean> {
  const handle = await storedHandle();
  if (!handle?.requestPermission) return false;
  try {
    const state = await handle.requestPermission({ mode: 'readwrite' });
    if (state !== 'granted') return false;
    await writeToHandle(handle);
    return true;
  } catch {
    return false;
  }
}

export async function backupInfo(): Promise<{
  hasTarget: boolean;
  fileName: string | null;
  lastAt: string | null;
  daysSince: number | null;
}> {
  const handle = await storedHandle();
  const last = (await db.meta.get(LAST_KEY))?.value as string | undefined;
  const daysSince = last
    ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000)
    : null;
  return {
    hasTarget: Boolean(handle),
    fileName: handle?.name ?? null,
    lastAt: last ?? null,
    daysSince,
  };
}

/** 手で書き出したときも記録しておく */
export async function noteManualBackup(): Promise<void> {
  await db.meta.put({ key: LAST_KEY, value: nowIso(), updatedAt: nowIso() });
}

export const formatBytes = (n: number | null): string => {
  if (n == null) return '—';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
};

/**
 * 最初からやり直す。
 *
 * **端末に貯めたものを全部消す。**献立も、自作レシピも、撮った写真も、
 * 買い出しの実績も戻らない。
 *
 * ブラウザの設定から消すのと同じことを、アプリの中でできるようにしただけ。
 * あちらは「Cookieと他のサイトデータ」を探し当てる必要があり、
 * ホーム画面から起動している人には辿り着けない。
 *
 * 消す前に書き出しを勧めるのは画面側の仕事。ここは頼まれたら消す。
 */
export async function resetEverything(): Promise<void> {
  db.close();
  await db.delete();
  // 開き直すと ensureSeeded が走り、初期設定からやり直しになる
  location.reload();
}
