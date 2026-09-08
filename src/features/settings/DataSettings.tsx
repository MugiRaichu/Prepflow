import { useEffect, useRef, useState } from 'react';
import { Download, Upload, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { resetEverything } from '@/db/repositories/backup';
import { ViewportInfo } from './ViewportInfo';
import {
  autoBackupSupported,
  backupInfo,
  downloadBackup,
  formatBytes,
  importAll,
  noteManualBackup,
  pickBackupFile,
  reauthorizeBackup,
  requestPersistence,
  storageStatus,
} from '@/db/repositories/backup';
import type { StorageStatus } from '@/db/repositories/backup';

/**
 * データの保存場所と持ち出し。
 *
 * ブラウザではデータの置き場所をユーザーが選べない。IndexedDB も
 * 端末内AIのモデルもブラウザのプロファイル配下に自動で置かれ、
 * パスを指定する API が無い（File System Access API はデスクトップ Chrome 限定）。
 *
 * そのぶん「消えうる」ことは隠さずに書き、対策を2つ出す。
 * 永続化の要求と、ファイルへの書き出し。後者だけがユーザーの手元に残る。
 */
export function DataSettings() {
  const [st, setSt] = useState<StorageStatus | null>(null);
  const [bk, setBk] = useState<Awaited<ReturnType<typeof backupInfo>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    void storageStatus().then(setSt);
    void backupInfo().then(setBk);
  };
  useEffect(reload, []);

  const usedPct =
    st?.usedBytes != null && st.quotaBytes ? (st.usedBytes / st.quotaBytes) * 100 : null;

  return (
    <div>
      <PageHeader title="書き出し・元に戻す" backTo="/settings" />

      <div className="space-y-6 p-4">
        <ViewportInfo />

        <div className="space-y-2 rounded-lg border p-4">
          <div className="text-sm font-medium">いまの状態</div>

          <div className="space-y-1 text-xs tabular-nums text-muted-foreground">
            <div>使用量 {formatBytes(st?.usedBytes ?? null)} / {formatBytes(st?.quotaBytes ?? null)}</div>
            {usedPct != null && (
              <div className="h-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: Math.max(Math.min(usedPct, 100), 1) + '%' }}
                />
              </div>
            )}
          </div>

          {st?.persisted ? (
            <div className="flex items-center gap-1.5 text-xs">
              <ShieldCheck className="size-3.5" />
              保護されています
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                空き容量が減ったときに、ブラウザに消される可能性があります。
              </p>
              <button
                onClick={async () => {
                  const ok = await requestPersistence();
                  setMsg(
                    ok
                      ? '保護しました'
                      : 'ホーム画面に追加すると保護されます。ブラウザは「アプリとして使われているか」で判断していて、いまはその条件を満たしていません',
                  );
                  reload();
                }}
                className="min-h-11 w-full rounded-md border text-xs active:bg-accent"
              >
                データを保護する
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-lg border p-4">
          <div className="text-sm font-medium">消えてしまう操作</div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>
              ・Chrome の
              <span className="text-foreground">「Cookie と他のサイトデータを削除」</span>
            </li>
            <li>
              ・iPhone の
              <span className="text-foreground">「履歴と Web サイトデータを消去」</span>
            </li>
            <li>
              ・<span className="text-foreground">ホーム画面のアイコンを削除</span>する
            </li>
          </ul>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="text-foreground">「閲覧履歴」だけの削除では消えません。</span>
            履歴とサイトデータは別の区分です。
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            上の操作は保護していても効きません。備えはファイルへの書き出しだけです。
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="text-sm font-medium">書き出しと読み込み</div>

          <button
            onClick={async () => {
              setBusy(true);
              try {
                const name = await downloadBackup();
                await noteManualBackup();
                setMsg(name + ' を書き出しました');
                reload();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-foreground text-sm font-medium text-background disabled:opacity-50"
          >
            <Download className="size-4" />
            ファイルに書き出す
          </button>

          {autoBackupSupported() && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">自動で書き出す</div>
              {bk?.hasTarget ? (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {bk.fileName} に自動で上書きしています。
                    {bk.daysSince != null && bk.daysSince > 0 && ' 前回は' + bk.daysSince + '日前です。'}
                  </p>
                  <button
                    onClick={async () => {
                      const ok = await reauthorizeBackup();
                      setMsg(ok ? '書き出しました' : '書き込みを許可してください');
                      reload();
                    }}
                    className="min-h-11 w-full rounded-md border text-xs active:bg-accent"
                  >
                    いま書き出す / 許可を取り直す
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    一度選んでおくと、献立を決めたときと買い物を終えたときに自動で上書きします。
                  </p>
                  <button
                    onClick={async () => {
                      const ok = await pickBackupFile();
                      setMsg(ok ? '書き出し先を設定しました' : '設定しませんでした');
                      reload();
                    }}
                    className="min-h-11 w-full rounded-md border text-xs active:bg-accent"
                  >
                    書き出し先を選ぶ
                  </button>
                </>
              )}
            </div>
          )}

          {!autoBackupSupported() && bk?.daysSince != null && bk.daysSince >= 14 && (
            <div className="rounded-md border border-foreground/40 p-3 text-xs leading-relaxed">
              前回の書き出しから {bk.daysSince} 日たっています。
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try {
                const r = await importAll(f);
                setMsg(r.ok ? r.restored + ' 件を戻しました' : '失敗: ' + r.error);
                reload();
              } finally {
                setBusy(false);
                e.target.value = '';
              }
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border text-sm active:bg-accent disabled:opacity-50"
          >
            <Upload className="size-4" />
            ファイルから戻す
          </button>

          <p className="text-xs text-muted-foreground">
            戻すと、いまのデータはすべて置き換わります。
          </p>
        </div>

        {msg && <div className="text-xs text-muted-foreground">{msg}</div>}

        {/*
          最初からやり直す。**2回押させる。**1回で消えると、押し間違いで全部が消える。
          取り消しの効かない操作はここだけなので、ここだけ確認を挟む。

          ブラウザの設定から消すのと同じことだが、ホーム画面から起動している人は
          「Cookieと他のサイトデータ」に辿り着けない。だからアプリの中に置く。
        */}
        <div className="space-y-2 border-t pt-6">
          <div className="text-sm font-medium">最初から始める</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            端末に貯めたものを全部消して、初期設定からやり直します。
            献立・自作レシピ・撮った写真・買い出しの実績は戻りません。
            {!bk?.lastAt && ' 先に上の「ファイルに書き出す」をしておくと、あとで戻せます。'}
          </p>
          {confirmReset ? (
            <div className="space-y-2">
              <button
                onClick={() => void resetEverything()}
                className="min-h-12 w-full rounded-lg bg-destructive text-sm font-semibold text-destructive-foreground"
              >
                本当に全部消す
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="min-h-11 w-full text-xs text-muted-foreground"
              >
                やめる
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="min-h-11 w-full rounded-md border text-xs active:bg-accent"
            >
              全部消して最初から始める
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
