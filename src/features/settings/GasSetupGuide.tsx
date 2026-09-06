import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import GAS_CODE from '@/notify/gas/Code.gs?raw';

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
export function GasSetupGuide({
  needLine = true,
  needCalendar = false,
}: {
  needLine?: boolean;
  needCalendar?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(GAS_CODE);
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

      <div className="space-y-5 pt-4 text-[11px] leading-relaxed">
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

            <Step n={n()} title="2つの値を控える">
              同じ「Messaging API設定」の画面に両方あります。
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                <li>
                  ・<span className="text-foreground">チャネルアクセストークン（長期）</span>
                  — 一番下。「発行」を押すと出ます
                </li>
                <li>
                  ・<span className="text-foreground">あなたのユーザーID</span>
                  — 上のほう。U から始まる文字列です
                </li>
              </ul>
              <p className="mt-1.5 text-muted-foreground">
                同じ画面の QR コードから、自分のチャネルを友だち追加しておきます。
                していないと通知が届きません。
              </p>
            </Step>
          </>
        )}

        <Step n={n()} title="スクリプトを置く">
          {/*
            /home/projects/create は、ログイン状態や利用状況によって
            Apps Script ではない画面（Drive の案内など）に飛ばされる。
            入口そのものを開いて、新規作成は本人に押してもらう
          */}
          <a
            href="https://script.google.com/"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Google Apps Script
          </a>
          を開き、左上の「新しいプロジェクト」を押します。最初から入っているコードを消して、
          下のコードを貼ります。
          {needCalendar && (
            <span className="text-muted-foreground">
              {' '}
              読みたいカレンダーと同じ Google アカウントでログインしてください。
            </span>
          )}
          <button
            onClick={copy}
            className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-md border text-[11px] active:bg-accent"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'コピーしました' : 'コードをコピー'}
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

        <Step n={n()} title={needLine ? '3つの値を登録する' : '合言葉を決める'}>
          左の歯車（プロジェクトの設定）→ 一番下の
          <span className="font-medium">「スクリプト プロパティ」</span>
          →「スクリプト プロパティを追加」。左の「プロパティ」に名前、右の「値」に中身を入れます。
          <div className="mt-1.5 overflow-hidden rounded border text-[10px]">
            <div className="grid grid-cols-[1fr_1.6fr] border-b bg-secondary/50 px-2 py-1 text-muted-foreground">
              <span>プロパティ</span>
              <span>値</span>
            </div>
            {needLine && (
              <div className="grid grid-cols-[1fr_1.6fr] border-b px-2 py-1">
                <span className="font-mono">LINE_TOKEN</span>
                <span className="text-muted-foreground">手順2のアクセストークン</span>
              </div>
            )}
            {needLine && (
              <div className="grid grid-cols-[1fr_1.6fr] border-b px-2 py-1">
                <span className="font-mono">LINE_USER_ID</span>
                <span className="text-muted-foreground">手順2のユーザーID</span>
              </div>
            )}
            <div className="grid grid-cols-[1fr_1.6fr] px-2 py-1">
              <span className="font-mono">SHARED_TOKEN</span>
              <span className="text-muted-foreground">自分で決めた長い文字列（合言葉）</span>
            </div>
          </div>
          <p className="mt-1.5 text-muted-foreground">
            SHARED_TOKEN の「値」に入れた文字列を、このあと下の「合言葉」欄にも貼ります。控えておいてください。
            最後に「スクリプト プロパティを保存」を押します。
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
            'カレンダーから受け取るのは件名と時刻だけです。書く場合は「Prepflow」という別のカレンダーにだけ書き、ほかのカレンダーには触れません。'}
        </p>
      </div>
    </details>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-medium">{title}</div>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
