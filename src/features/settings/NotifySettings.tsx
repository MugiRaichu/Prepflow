import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { Segmented } from '@/components/shared/Segmented';
import { Chips } from '@/components/shared/Chips';
import { getSecret, setSecret, updateSettings } from '@/db/repositories/settings';
import { fetchStatus, ping, pushNow, sendTest, syncSchedule } from '@/notify/gasClient';
import type { GasStatus } from '@/notify/gasClient';
import { clearCalendar, publishMenus, syncCalendar } from '@/calendar/gasCalendar';
import { HealthSection } from './HealthSettings';
import { GasSetupGuide } from './GasSetupGuide';
import type { AppSettings as AppSettingsType } from '@/db/schema';

const TIME_OPTIONS = ['16:00', '17:00', '17:30', '18:00', '19:00', '20:00'].map((t) => ({
  value: t,
  label: t,
}));

/**
 * Google との連携。LINE 通知とカレンダーの読み取り。
 * どちらも同じ GAS を通るので、接続設定は1つ。どちらかをオンにしたときだけ出す。
 */
export function NotifySettings() {
  const s = useLiveQuery(() => db.settings.get('singleton'), []);
  if (!s) return null;

  const needsGas = s.notify.lineEnabled || s.calendar.enabled;

  return (
    <div>
      <PageHeader title="LINE・カレンダー・歩数" backTo="/settings" />
      <div className="space-y-6 p-4">
        <Labeled label="LINE に今日の食事を送る">
          <Segmented
            options={[
              { value: 'off', label: 'オフ' },
              { value: 'on', label: 'オン' },
            ]}
            value={s.notify.lineEnabled ? 'on' : 'off'}
            onChange={(v) => updateSettings({ notify: { ...s.notify, lineEnabled: v === 'on' } })}
          />
        </Labeled>

        {s.notify.lineEnabled && (
          <Labeled label="送る時刻" hint="帰宅前に届く時刻に">
            <Chips
              options={TIME_OPTIONS}
              value={s.notify.dailyPushTime}
              onChange={(v) => updateSettings({ notify: { ...s.notify, dailyPushTime: v } })}
              columns={3}
            />
          </Labeled>
        )}

        <Labeled
          label="Google カレンダーの予定を今日の流れに入れる"
          hint="件名と時刻だけ読みます。書き込みはしません"
        >
          <Segmented
            options={[
              { value: 'off', label: 'オフ' },
              { value: 'on', label: 'オン' },
            ]}
            value={s.calendar.enabled ? 'on' : 'off'}
            onChange={(v) =>
              updateSettings({
                calendar: { ...s.calendar, enabled: v === 'on', provider: v === 'on' ? 'google' : 'none' },
              })
            }
          />
        </Labeled>

        {s.calendar.enabled && <CalendarSync settings={s} />}

        {needsGas && <GasSetup settings={s} />}

        {/*
          ヘルスケアもここに置く。**同じ Apps Script を使う。**
          別の画面にしていたので、接続の設定（URLと合言葉）を2か所で
          持っていた。片方だけ直すと、もう片方が黙って動かなくなる。

          LINE もカレンダーも使わず、歩数だけ取り込みたい人がいるので、
          接続パネルの中には入れない（中に入れていたら、
          両方オフのときにヘルスケアごと消えていた）。
        */}
        <div className="border-t pt-5">
          <HealthSection />
        </div>
      </div>
    </div>
  );
}

/**
 * 予定の取り込みと、献立の書き出し。
 * 取り込みは自動（今日タブで6時間ごと）。書き出しは献立を確定したときに自動。
 * どちらも「いま」やりたいときのボタンを置く。
 */
function CalendarSync({ settings }: { settings: AppSettingsType }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const lastIn = settings.calendar.lastSyncedAt;
  const lastOut = settings.calendar.lastPublishedAt;
  const publish = Boolean(settings.calendar.publishEnabled);

  const run = async (fn: () => Promise<{ ok: boolean; count?: number; skipped?: boolean; error?: string }>, done: (n: number) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(r.ok ? (r.skipped ? '変わっていないので書きませんでした' : done(r.count ?? 0)) : '失敗: ' + r.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-2">
        <button
          onClick={() => run(() => syncCalendar(settings), (n) => n + ' 件の予定を取り込みました')}
          disabled={busy}
          className="min-h-11 w-full rounded-md border text-xs active:bg-accent disabled:opacity-40"
        >
          予定をいま取り込む
        </button>
        <div className="text-xs text-muted-foreground">
          {lastIn
            ? '最終取り込み ' + new Date(lastIn).toLocaleString('ja-JP')
            : 'まだ取り込んでいません。下の接続設定を済ませてから押してください'}
        </div>
      </div>

      <div className="space-y-2 border-t pt-4">
        <Labeled
          label="献立を Google カレンダーに書く"
          hint="「Prepflow」というカレンダーを作り、そこだけに書きます。日付・時刻・料理名だけ"
        >
          <Segmented
            options={[
              { value: 'off', label: 'オフ' },
              { value: 'on', label: 'オン' },
            ]}
            value={publish ? 'on' : 'off'}
            onChange={(v) =>
              updateSettings({ calendar: { ...settings.calendar, publishEnabled: v === 'on' } })
            }
          />
        </Labeled>
        {publish && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => run(() => publishMenus(settings), (n) => n + ' 件を書きました')}
                disabled={busy}
                className="min-h-11 rounded-md border text-xs active:bg-accent disabled:opacity-40"
              >
                献立をいま書く
              </button>
              {/*
                **書き直さずに消せなかった。**publish は「消してから書く」ので
                入れ替えはできるが、やめたいときは手で消すしかなかった。
                消すのは Prepflow カレンダーの中だけ
              */}
              <button
                onClick={() =>
                  run(() => clearCalendar(settings), (n) =>
                    n ? n + ' 件を消しました' : '消すものがありませんでした',
                  )
                }
                disabled={busy}
                className="min-h-11 rounded-md border text-xs active:bg-accent disabled:opacity-40"
              >
                カレンダーから消す
              </button>
            </div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              {lastOut
                ? '最終書き出し ' + new Date(lastOut).toLocaleString('ja-JP') + '。'
                : ''}
              献立を確定すると自動で書きます。書くたびに、その期間の「Prepflow」
              カレンダーを入れ替えます（ほかのカレンダーには触れません。過去の日も残します）。
            </div>
          </>
        )}
      </div>

      {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
    </div>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * GAS の接続設定。
 * 貼り付ける箇所は**URLの1つだけ**。合言葉はアプリが作ってコードに埋め込み、
 * LINE の2つの値もこの画面に貼れば同じくコードに入る。
 * Google の設定画面でプロパティを登録する作業は、もう無い。
 */
function GasSetup({ settings }: { settings: AppSettingsType }) {
  const [url, setUrl] = useState(settings.notify.gasEndpointUrl ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<GasStatus | null>(null);

  useEffect(() => {
    void getSecret('gas_shared_token').then((v) => setToken(v ?? ''));
  }, []);

  const save = async () => {
    await updateSettings({ notify: { ...settings.notify, gasEndpointUrl: url.trim() } });
    await setSecret('gas_shared_token', token.trim());
  };

  /*
   * 押した結果を、**何が起きたかまで**書く。
   *
   * 「成功しました」とだけ出していたので、LINE に届かなくても成功に見えた。
   * 「今週を送る」は GAS に預けるだけで LINE には流れないのに、
   * 同じ文言だったのが混乱のもと（本人報告）。
   */
  const run = async (
    fn: () => Promise<{ ok: boolean; error?: string; skipped?: boolean; count?: number }>,
    done?: (r: { count?: number }) => string,
  ) => {
    setBusy(true);
    setMsg(null);
    try {
      await save();
      const r = await fn();
      if (!r.ok) setMsg('失敗: ' + r.error);
      else if (r.skipped) setMsg('変更がないので送りませんでした');
      else setMsg(done ? done(r) : '成功しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="text-sm font-medium">接続設定</div>

      <GasSetupGuide needLine={settings.notify.lineEnabled} needCalendar={settings.calendar.enabled} />

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">ウェブアプリのURL</div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://script.google.com/macros/s/.../exec"
          className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/*
        **合言葉はもう打たせない。**アプリが作って、コピーするコードに
        埋め込む（GasSetupGuide）。前から使っている人が自分の値を入れ直せる
        ように口だけ残し、ふだんは畳んでおく
      */}
      <details>
        <summary className="min-h-11 cursor-pointer text-xs text-muted-foreground">
          合言葉を自分で決める（ふつうは不要）
        </summary>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder="アプリが作った合言葉を使っています"
          className="mt-1 h-11 w-full rounded-md border border-input bg-transparent px-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </details>

      {/* LINE を使わない人に「テスト送信」「今週を送る」は関係ない。出さない */}
      <div className={settings.notify.lineEnabled ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
        <button
          onClick={() =>
            run(
              () => ping(url.trim(), token.trim()),
              // 疎通は LINE を通らない。ここが通っても届くとは限らない
              () => 'つながりました（LINE に届くかはテスト送信で確かめてください）',
            )
          }
          disabled={busy || !url || !token}
          className="min-h-11 rounded-md border text-xs active:bg-accent disabled:opacity-40"
        >
          疎通を確認
        </button>
        {settings.notify.lineEnabled && (
          <>
            <button
              onClick={() =>
                run(() => sendTest(url.trim(), token.trim()), () => 'LINE に1通送りました')
              }
              disabled={busy || !url || !token}
              className="min-h-11 rounded-md border text-xs active:bg-accent disabled:opacity-40"
            >
              テスト送信
            </button>
            <button
              onClick={() =>
                run(
                  () =>
                    syncSchedule({
                      ...settings,
                      notify: { ...settings.notify, gasEndpointUrl: url.trim() },
                    }),
                  // 預けただけ。いつ届くのかをここで言う
                  () =>
                    '預けました。LINE には毎日 ' +
                    settings.notify.dailyPushTime +
                    ' ごろ、その日のぶんが届きます',
                )
              }
              disabled={busy || !url || !token}
              className="min-h-11 rounded-md bg-foreground text-xs font-medium text-background disabled:opacity-40"
            >
              今週を送る
            </button>
            <button
              onClick={() =>
                run(() => pushNow(url.trim(), token.trim()), (r) =>
                  r.count ? '今日のぶんを送りました' : '今日のぶんの献立がありません（届きません）',
                )
              }
              disabled={busy || !url || !token}
              className="min-h-11 rounded-md border text-xs active:bg-accent disabled:opacity-40"
            >
              今日のぶんをいますぐ送る
            </button>
            {/*
              **推測で直させない。**「毎日の通知が来ない」の原因は
              「献立を預けていない」「今日のぶんが無い」「予約が無い」
              「タイムゾーンがずれている」のどれかで、外からは全部同じに見える
            */}
            <button
              onClick={() => {
                setBusy(true);
                setMsg(null);
                void save()
                  .then(() => fetchStatus(url.trim(), token.trim()))
                  .then((r) => {
                    if (r.ok) setStatus(r as GasStatus);
                    else setMsg('失敗: ' + r.error);
                  })
                  .finally(() => setBusy(false));
              }}
              disabled={busy || !url || !token}
              className="min-h-11 rounded-md border text-xs active:bg-accent disabled:opacity-40"
            >
              いまの状態を見る
            </button>
          </>
        )}
      </div>

      {msg && <div className="text-xs text-muted-foreground">{msg}</div>}

      {status && (
        <div className="space-y-1 rounded-md border p-3 text-xs leading-relaxed">
          {/* 分かったことではなく、**次にすること**を先に書く */}
          {status.count === 0 ? (
            <p className="font-medium">献立を預けていません。「今週を送る」を押してください。</p>
          ) : status.todayCount === 0 ? (
            <p className="font-medium">
              預けてあるのは {status.from} 〜 {status.to} のぶんで、今日（{status.today}
              ）の献立がありません。この期間に入れば毎日届きます。
            </p>
          ) : !status.hasTrigger ? (
            <p className="font-medium">
              毎日の予約がありません。GAS で setupTrigger を1回実行してください。
            </p>
          ) : status.timeZone !== 'Asia/Tokyo' ? (
            <p className="font-medium">
              スクリプトのタイムゾーンが {status.timeZone} です。GAS のプロジェクト設定で
              Asia/Tokyo にしてください。送信時刻がずれます。
            </p>
          ) : (
            <p className="font-medium">問題は見つかりませんでした。</p>
          )}
          <div className="text-muted-foreground">
            預けた献立 {status.count} 件（{status.from ?? '—'} 〜 {status.to ?? '—'}）／ 今日のぶん{' '}
            {status.todayCount} 件 ／ 送信時刻 {status.pushTime ?? '—'} ／ 毎日の予約{' '}
            {status.hasTrigger ? 'あり' : 'なし'} ／ タイムゾーン {status.timeZone}
          </div>
        </div>
      )}
      {settings.notify.lastSyncedAt && (
        <div className="text-xs text-muted-foreground">
          最終送信 {new Date(settings.notify.lastSyncedAt).toLocaleString('ja-JP')}
        </div>
      )}
    </div>
  );
}
