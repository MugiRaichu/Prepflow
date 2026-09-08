import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Copy, Share2, RefreshCw } from 'lucide-react';
import { db, nowIso } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { getSecret, setSecret } from '@/db/repositories/settings';
import { familySyncedAt, inviteLink, syncFamily } from '@/family/share';
import GAS_CODE from '@/notify/gas/Code.gs?raw';

/**
 * 家族で同じ中身を見る。
 *
 * **難しい作業は1人だけがやる。**
 *
 *   最初の1人 … Google の画面でコードを貼ってデプロイする（1回きり、5分ほど）
 *   ほかの人  … 送られてきたリンクを開いて「入る」を押す（2タップ、入力なし）
 *
 * ボタンだけで完結させることはできない。Apps Script を人の代わりに作るには
 * Google の API と OAuth と Cloud のプロジェクトが要り、それは
 * 「サーバーを持たない・身元を出さない」という前提を壊す。
 * 代わりに**手で入れるものを1つに減らした**——
 * 合言葉はアプリが作ってコードに埋め込むので、打つのはURLの貼り付けだけ。
 */
function newToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function FamilyScreen() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  const [token, setToken] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    void getSecret('gas_shared_token').then(async (t) => {
      if (t) return setToken(t);
      // まだ無ければここで作る。人に考えさせない
      const made = newToken();
      await setSecret('gas_shared_token', made);
      setToken(made);
    });
    void familySyncedAt().then(setSyncedAt);
  }, []);

  useEffect(() => {
    if (settings?.notify.gasEndpointUrl) setUrl(settings.notify.gasEndpointUrl);
  }, [settings?.notify.gasEndpointUrl]);

  const ready = Boolean(url && token);

  const copy = async (text: string, what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setMsg('コピーできませんでした。長押しで選んでください。');
    }
  };

  /** 合言葉を埋めたコード。これを貼れば、プロパティの登録が要らない */
  const codeWithToken = GAS_CODE.replace("var TOKEN_IN_CODE = '';", "var TOKEN_IN_CODE = '" + token + "';");

  const invite = ready ? inviteLink(url.trim(), token) : '';

  const send = async () => {
    if (!invite) return;
    // 端末の共有シートが出る。LINE でもメールでも、その人が使うもので送れる
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Prepflow の共有', text: 'これを開くと同じ献立が見られます', url: invite });
        return;
      } catch {
        // 送るのをやめただけ。コピーに落とす
      }
    }
    await copy(invite, 'link');
  };

  const sync = async () => {
    setBusy(true);
    setMsg(null);
    const cur = await db.settings.get('singleton');
    if (cur && url.trim() !== cur.notify.gasEndpointUrl) {
      await db.settings.put({
        ...cur,
        notify: { ...cur.notify, gasEndpointUrl: url.trim() },
        updatedAt: nowIso(),
      });
    }
    const r = await syncFamily();
    setMsg(r.ok ? '送った ' + r.sent + '件 / 受け取った ' + r.received + '件' : '失敗: ' + r.error);
    void familySyncedAt().then(setSyncedAt);
    setBusy(false);
  };

  return (
    <div className="pb-8">
      <PageHeader title="家族と共有" backTo="/settings" />

      <div className="space-y-5 p-4">
        {/*
          **何が共有され、何が共有されないかを最初に書く。**
          あとから「体重も送られていた」と気づく作りにはしない
        */}
        <div className="space-y-2 rounded-lg border p-3 text-sm leading-relaxed">
          <div className="font-medium">共有されるもの</div>
          <p className="text-muted-foreground">
            買い出しリスト・家にある食材・作り置きの容器・週の献立。
            どれも冷蔵庫と買い物かごの中身です。
          </p>
          <div className="pt-1 font-medium">共有されないもの</div>
          <p className="text-muted-foreground">
            体格・目標・体重・目的・歩数・食べた記録。
            これらは<b className="text-foreground">送る対象にそもそも入っていません</b>。
            設定で切り替えるのではなく、仕組みとして送られません。
          </p>
        </div>

        {/*
          役割で分ける。**ほとんどの人は下の「入る側」だけを読めばよい。**
          全員が上の手順を読むと、5分の作業を人数ぶん繰り返すことになる
        */}
        <div className="space-y-3 rounded-lg border p-4">
          <div className="text-base font-medium">1人目の人がすること</div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            置き場所を1つ作ります。
            <b className="text-foreground">この作業をするのは1人だけ</b>で、1回きりです。
            ほかの家族は、送られてきたリンクを開くだけで入れます。
          </p>

          <Step n={1} title="Google の画面を開く">
            {/*
              **script.new を使う。**プロジェクトを作って、コードを貼る画面まで
              一気に開く Google の近道（docs.new と同じ仕組み）。

              /home/projects/create は、ログイン状態や利用状況によって
              Apps Script ではない画面へ飛ばされることがある（本人報告）。
              入口を開いて「新しいプロジェクト」を押させる回り道も要らなくなる。
            */}
            <a
              href="https://script.new"
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-11 items-center rounded-md border px-4 text-sm"
            >
              コードを貼る画面をひらく
            </a>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Google にログインしていないときは、先にログインの画面が出ます。
            </p>
          </Step>

          <Step n={2} title="コードを貼り付ける">
            <p className="text-sm text-muted-foreground">
              下のボタンでコピーしたら、開いた画面の文字を全部消して貼ります
              （その画面には <span className="font-mono">function myFunction</span> だけが
              入っています）。
              <b className="text-foreground">合言葉は入れてあるので、打つものはありません。</b>
            </p>
            <button
              onClick={() => void copy(codeWithToken, 'code')}
              className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border text-sm active:bg-accent"
            >
              {copied === 'code' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied === 'code' ? 'コピーしました' : 'コードをコピー'}
            </button>
          </Step>

          <Step n={3} title="公開して、出てきたURLを貼る">
            <p className="text-sm leading-relaxed text-muted-foreground">
              右上の「デプロイ」→「新しいデプロイ」→ 種類は「ウェブアプリ」。
              次のユーザーとして実行=自分、アクセスできるユーザー=全員。
              出てきたURLをここに貼ります。
            </p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="mt-2 h-12 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Step>

          <button
            onClick={() => void sync()}
            disabled={busy || !ready}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-semibold text-background disabled:opacity-40"
          >
            <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
            つながるか試す
          </button>
        </div>

        {/* 家族に渡すのはこれだけ。URLも合言葉も打たせない */}
        <div className="space-y-3 rounded-lg border p-4">
          <div className="text-base font-medium">家族を招く</div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            リンクを送るだけです。受け取った人は開いて「入る」を押すだけで、
            <b className="text-foreground">入力するものはありません</b>。
          </p>
          <button
            onClick={() => void send()}
            disabled={!ready}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border text-sm font-medium active:bg-accent disabled:opacity-40"
          >
            <Share2 className="size-4" />
            {copied === 'link' ? 'リンクをコピーしました' : '招待リンクを送る'}
          </button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            このリンクには合言葉が入っています。家族以外には送らないでください。
          </p>
        </div>

        {ready && (
          <button
            onClick={() => void sync()}
            disabled={busy}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border text-sm active:bg-accent disabled:opacity-40"
          >
            <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
            いま同期する
          </button>
        )}

        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
        {syncedAt && (
          <div className="text-xs text-muted-foreground">
            最後に同期 {new Date(syncedAt).toLocaleString('ja-JP')}
          </div>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t pt-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
          {n}
        </span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="pl-8">{children}</div>
    </div>
  );
}
