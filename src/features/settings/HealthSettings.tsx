import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Copy } from 'lucide-react';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { getSecret } from '@/db/repositories/settings';
import { healthPulledAt, pullHealth, recentSamples } from '@/health/gasHealth';
import { formatDateJa } from '@/lib/labels';
import type { ActivitySample } from '@/db/schema';

/**
 * iPhone のヘルスケアから歩数と消費カロリーを取り込む。
 *
 * **Web アプリから HealthKit は読めない。**Apple が web に API を出していない
 * ためで、実装の工夫で越えられる壁ではない。ここは正直に書く。
 *
 * 代わりに iPhone のショートカットに読ませて、GAS へ送ってもらう。
 * ショートカットの「URLの内容を取得」は**画面を開かずに**通信するので、
 * オートメーションに載せれば設定は最初の1回で済む。
 *
 * 手順書は画面に置く。外部のページに逃がすと、オフラインで詰まる。
 */
export function HealthSettings() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  const [token, setToken] = useState<string | null>(null);
  const [samples, setSamples] = useState<ActivitySample[]>([]);
  const [pulledAt, setPulledAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = () => {
    void recentSamples().then(setSamples);
    void healthPulledAt().then(setPulledAt);
  };
  useEffect(() => {
    void getSecret('gas_shared_token').then((t) => setToken(t ?? null));
    reload();
  }, []);

  const url = settings?.notify.gasEndpointUrl ?? '';
  const ready = Boolean(url && token);

  /** ショートカットに貼る JSON。トークンが入るので、画面から出さない */
  const bodyJson = ready
    ? '{"action":"health","token":"' + token + '","date":"（日付）","steps":（歩数）,"activeKcal":（消費）}'
    : '';

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg('コピーできませんでした。長押しで選んでください。');
    }
  };

  return (
    <div className="pb-8">
      <PageHeader title="ヘルスケア連携" backTo="/settings" />

      <div className="space-y-5 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          歩数とワークアウトの消費カロリーを取り込み、その日の目標に反映します。
          設定は最初の1回だけで、以降は毎晩自動で届きます。
        </p>

        {!ready && (
          <div className="rounded-lg border border-foreground/40 p-3 text-xs leading-relaxed">
            先に「LINE・カレンダー」の設定を済ませてください。
            そこで作った Apps Script を、この連携でもそのまま使います。
          </div>
        )}

        {ready && (
          <>
            <Step n={1} title="ショートカットを新規作成">
              iPhone の「ショートカット」App を開き、右上の ＋ を押します。
              名前は「Prepflow 健康」など分かるものに。
            </Step>

            <Step n={2} title="ヘルスケアから数値を取る">
              アクションを2つ足します。どちらも「ヘルスケアのサンプルを取得」です。
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>1つ目: 種類「歩数」・期間「今日」・「合計」</li>
                <li>2つ目: 種類「アクティブエネルギー」・期間「今日」・「合計」</li>
              </ul>
            </Step>

            <Step n={3} title="送り先を貼る">
              「URLの内容を取得」を足し、URL に下を貼ります。
              <CopyRow value={url} onCopy={copy} copied={copied} />
              <span className="mt-1 block">
                方法を <b>POST</b>、本文を <b>JSON</b> にして、次の3項目を入れます。
              </span>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  <b>action</b>（テキスト）… <code>health</code>
                </li>
                <li>
                  <b>token</b>（テキスト）… 下のトークン
                </li>
                <li>
                  <b>date</b>（テキスト）… 「現在の日付」を <code>yyyy-MM-dd</code> で書式設定
                </li>
                <li>
                  <b>steps</b>（数字）… 手順2の1つ目の結果
                </li>
                <li>
                  <b>activeKcal</b>（数字）… 手順2の2つ目の結果
                </li>
              </ul>
              <CopyRow value={token ?? ''} onCopy={copy} copied={copied} label="トークン" />
            </Step>

            <Step n={4} title="毎晩ひとりでに動かす">
              ショートカットApp の「オートメーション」タブ → ＋ →「時刻」→ 22:00 →
              作ったショートカットを選びます。
              <b>「実行前に尋ねる」をオフ</b>にすると、画面を開かずに動きます。
            </Step>

            <Step n={5} title="1回試す">
              ショートカットを手で1回実行してから、下を押してください。
            </Step>

            <button
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                try {
                  const n = await pullHealth();
                  setMsg(n > 0 ? n + ' 日ぶん取り込みました。' : 'まだ届いていません。');
                  reload();
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : '取り込めませんでした');
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background disabled:opacity-50"
            >
              {busy ? '取り込み中…' : 'いま取り込む'}
            </button>

            {msg && <div className="rounded-md border p-3 text-xs">{msg}</div>}

            <div className="space-y-2">
              <div className="text-sm font-medium">届いている記録</div>
              {samples.length === 0 ? (
                <p className="text-xs text-muted-foreground">まだありません。</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {samples.map((s) => (
                    <div key={s.id} className="flex items-baseline gap-3 px-3 py-2 text-xs">
                      <span className="w-20 shrink-0 text-muted-foreground">
                        {formatDateJa(s.date)}
                      </span>
                      <span className="flex-1 tabular-nums">
                        {s.steps != null ? s.steps.toLocaleString() + ' 歩' : '—'}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {s.activeKcal != null ? Math.round(s.activeKcal) + ' kcal' : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {pulledAt && (
                <div className="text-[10px] text-muted-foreground">
                  最後に取り込んだのは {new Date(pulledAt).toLocaleString('ja-JP')}
                </div>
              )}
            </div>

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              通るのは日付・歩数・消費カロリーだけです。名前も位置も通しません。
              経由するのは麦さん自身の Apps Script なので、第三者には渡りません。
              オートメーションは端末の状態によって数時間ずれることがありますが、
              翌日にまとめて取り込まれます。
            </p>
            {bodyJson && (
              <details className="text-[10px] text-muted-foreground">
                <summary className="cursor-pointer">送られる中身（確認用）</summary>
                <code className="mt-1 block break-all">{bodyJson}</code>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

/** 長い文字列は指で選べない。押してコピーさせる */
function CopyRow({
  value,
  onCopy,
  copied,
  label,
}: {
  value: string;
  onCopy: (v: string) => void;
  copied: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={() => onCopy(value)}
      className="mt-1.5 flex min-h-10 w-full items-center gap-2 rounded-md border px-2.5 text-left active:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{label ?? value}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0" />
      ) : (
        <Copy className="size-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
