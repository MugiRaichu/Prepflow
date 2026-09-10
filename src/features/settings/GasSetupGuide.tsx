import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import GAS_CODE from '@/notify/gas/Code.gs?raw';
import { getSecret, setSecret } from '@/db/repositories/settings';

/**
 * Google 連携の設置手順。LINE 通知とカレンダーの読み取りは同じスクリプトを通る。
 *
 * 画面から余計な説明は削ったが（D-053）、ここは別。
 * 手順書は「読んでも行動が変わらない文」ではなく、行動そのもの。
 * これが無いと設定できないので、迷う余地が無いところまで具体的に書く。
 *
 * 使うものだけ出す。カレンダーだけの人に LINE のチャネルを作らせない。
 * GAS のコードは `?raw` で読み込んでコピーボタンに載せる。ファイルを探させない。
 */
/**
 * コピーするコードに、その人の値を埋める。
 *
 * **スクリプトプロパティの登録をなくすため。**以前は Google の設定画面で
 * 3つ登録させていた（LINE_TOKEN / LINE_USER_ID / SHARED_TOKEN）。
 * 名前を打ち、値を貼り、保存する——スマホしか使わない人には重すぎた
 * （本人指摘）。アプリに1度貼れば、あとはコードに入って出ていく。
 *
 * プロパティが登録してあればそちらが優先される（前から使っている人はそのまま）。
 */
function fill(code: string, v: { shared?: string; lineToken?: string; lineUser?: string }): string {
  const q = (x: string) => x.replace(/'/g, "");
  return code
    .replace("var TOKEN_IN_CODE = '';", "var TOKEN_IN_CODE = '" + q(v.shared ?? '') + "';")
    .replace(
      "var LINE_TOKEN_IN_CODE = '';",
      "var LINE_TOKEN_IN_CODE = '" + q(v.lineToken ?? '') + "';",
    )
    .replace(
      "var LINE_USER_ID_IN_CODE = '';",
      "var LINE_USER_ID_IN_CODE = '" + q(v.lineUser ?? '') + "';",
    );
}

export function GasSetupGuide({
  needLine = true,
  needCalendar = false,
}: {
  needLine?: boolean;
  needCalendar?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState('');
  const [lineToken, setLineToken] = useState('');
  const [lineUser, setLineUser] = useState('');

  useEffect(() => {
    void getSecret('gas_shared_token').then(async (t) => {
      if (t) return setShared(t);
      // 合言葉は人に考えさせない。ここで作って持っておく
      const a = new Uint8Array(24);
      crypto.getRandomValues(a);
      const made = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
      await setSecret('gas_shared_token', made);
      setShared(made);
    });
    void getSecret('line_token').then((v) => setLineToken(v ?? ''));
    void getSecret('line_user_id').then((v) => setLineUser(v ?? ''));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fill(GAS_CODE, { shared, lineToken, lineUser }));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  // 出す手順だけ番号を振る
  let k = 0;
  const n = () => ++k;

  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-xs font-medium">設定のしかた</summary>

      <div className="space-y-5 pt-4 text-xs leading-relaxed">
        {needLine && (
          <>
            <Step n={n()} title="LINE の窓口を作る">
              <a
                href="https://developers.line.biz/console/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                LINE Developers
              </a>
              を開き、LINE アカウントでログインします。
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                <li>・「新規プロバイダー作成」→ 名前は自分が分かるものでかまいません</li>
                <li>・「Messaging API」チャネルを作ります</li>
                <li>
                  ・作ったチャネルの
                  <span className="text-foreground">「Messaging API設定」</span>タブを開きます
                </li>
              </ul>
            </Step>

            {/*
              **タブが違う。**「両方この画面にあります」と書いていたが、
              ユーザーIDは別のタブにある。探し回った末に、
              同じ画面にあるチャネルシークレットを拾ってしまう（本人報告）。
              どのタブの、どこにあるかまで書く。
            */}
            <Step n={n()} title="2つの値を、ここに貼る（タブが違います）">
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                <li>
                  ・<span className="text-foreground">チャネルアクセストークン（長期）</span>
                  <br />
                  「Messaging API設定」タブの<span className="text-foreground">一番下</span>。
                  「発行」を押すと出ます。とても長い文字列です
                </li>
                <li>
                  ・<span className="text-foreground">あなたのユーザーID</span>
                  <br />
                  <span className="text-foreground">「チャネル基本設定」タブ</span>に切り替えて、
                  その一番下。U から始まる33文字です
                </li>
              </ul>
              {/*
                この3つは同じ画面に並んでいて、名前も似ている。
                どれを入れても保存はできてしまうので、先に否定しておく
              */}
              <p className="mt-1.5 rounded border p-2 text-muted-foreground">
                <span className="text-foreground">チャネルシークレット</span>と
                <span className="text-foreground">チャネルID</span>は使いません。
                これらを入れると LINE に拒否されます（設定は保存できてしまいます）。
                トークンは数百文字、シークレットは32文字なので、長さで見分けられます。
              </p>
              {/*
                **Google の設定画面で登録させない。**ここに貼れば、
                次の手順でコピーするコードに入って出ていく。
                名前を打って値を貼って保存する作業が3回ぶん消える
              */}
              <div className="mt-2 space-y-2">
                <input
                  value={lineToken}
                  onChange={(e) => {
                    setLineToken(e.target.value);
                    void setSecret('line_token', e.target.value.trim());
                  }}
                  type="password"
                  placeholder="チャネルアクセストークン（長期）"
                  className="h-12 w-full rounded-md border border-input bg-transparent px-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <input
                  value={lineUser}
                  onChange={(e) => {
                    setLineUser(e.target.value);
                    void setSecret('line_user_id', e.target.value.trim());
                  }}
                  placeholder="あなたのユーザーID（U で始まる）"
                  className="h-12 w-full rounded-md border border-input bg-transparent px-3 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <p className="mt-1.5 text-muted-foreground">
                「Messaging API設定」タブの QR コードから、自分のチャネルを友だち追加しておきます。
                していないと通知が届きません。
              </p>
            </Step>
          </>
        )}

        <Step n={n()} title="スクリプトを置く">
          {/*
            **script.new を使う。**プロジェクトを作って、コードを貼る画面まで
            一気に開く Google の近道（docs.new と同じ仕組み）。

            以前は /home/projects/create を開いていたが、ログイン状態や
            利用状況によって Apps Script ではない画面へ飛ばされた。
            入口を開いて「新しいプロジェクト」を押させる回り道も、これで要らない。
          */}
          <a
            href="https://script.new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-md border px-4 underline-offset-2"
          >
            コードを貼る画面をひらく
          </a>
          <p className="mt-1.5">
            開いた画面の文字（<span className="font-mono">function myFunction</span> だけ）を
            全部消して、下のコードを貼ります。
            Google にログインしていないときは、先にログインの画面が出ます。
          </p>
          {needCalendar && (
            <span className="text-muted-foreground">
              {' '}
              読みたいカレンダーと同じ Google アカウントでログインしてください。
            </span>
          )}
          <button
            onClick={copy}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border text-xs active:bg-accent"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'コピーしました' : 'コードをコピー（合言葉もLINEの値も入っています）'}
          </button>
          <p className="mt-1.5 text-muted-foreground">
            すでに置いてある場合は、中身を全部消してから貼り直します。
          </p>
          <p className="mt-1.5 text-muted-foreground">
            <span className="text-foreground">「アクセス権がありません」と出たら</span>
            、会社や学校のアカウントで開いているか、Google アカウントの生年月日が未設定です。
            右上のアイコンで個人の Gmail に切り替え、それでも出るなら
            myaccount.google.com → 個人情報 → 生年月日 を設定してください。
            会社のアカウントには置かないでください。
          </p>
        </Step>

        <Step n={n()} title="許可を出す">
          エディタ上部の関数名のところで
          <span className="font-medium"> authorize </span>
          を選び、<span className="font-medium">▶ 実行</span> を押します。
          <ul className="mt-1.5 space-y-1 text-muted-foreground">
            <li>・「承認が必要です」→「権限を確認」</li>
            <li>・自分のアカウントを選ぶ</li>
            <li>・「詳細」→「（プロジェクト名）に移動」→「許可」</li>
          </ul>
          <p className="mt-1.5 text-muted-foreground">
            自分が置いたコードに、自分のアカウントの使用を許すだけです。
            {needCalendar && ' カレンダーは読むだけで、書き込みはしません。'}
            実行ログに ok と出れば完了です。
          </p>
        </Step>

        <Step n={n()} title="公開する">
          右上の<span className="font-medium">「デプロイ」→「新しいデプロイ」</span>。
          <ul className="mt-1.5 space-y-1 text-muted-foreground">
            <li>・種類は歯車から「ウェブアプリ」を選ぶ</li>
            <li>
              ・<span className="text-foreground">次のユーザーとして実行 → 自分</span>
            </li>
            <li>
              ・<span className="text-foreground">アクセスできるユーザー → 全員</span>
            </li>
          </ul>
          <p className="mt-1.5">
            出てきた<span className="font-medium">ウェブアプリの URL</span>を控えます。
          </p>
          <p className="mt-1.5 text-muted-foreground">
            すでに公開してあってコードを貼り直しただけなら、「デプロイ」→「デプロイを管理」→
            鉛筆 → バージョン「新バージョン」→「デプロイ」。URL は変わりません。
          </p>
        </Step>

        <Step n={n()} title="つなぐ">
          下の欄に、URL と SHARED_TOKEN を貼って
          <span className="font-medium">「疎通を確認」</span>を押します。
          {needLine && (
            <> 成功したら<span className="font-medium">「テスト送信」</span>で LINE に届くか確かめます。</>
          )}
          {needCalendar && (
            <> 成功したら上の<span className="font-medium">「いま取り込む」</span>で予定が入るか確かめます。</>
          )}
        </Step>

        <p className="text-foreground">
          {needLine && 'LINE に送るのは日付と食べるものだけです。'}
          {needCalendar &&
            'カレンダーから受け取るのは件名と時刻だけです。書く場合は「プレノラ」という別のカレンダーにだけ書き、ほかのカレンダーには触れません。'}
        </p>
      </div>
    </details>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-medium">{title}</div>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
