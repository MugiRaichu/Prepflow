import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * 画面が落ちたときに、**白い画面のままにしない。**
 *
 * React は描画の途中で例外が出ると、その枝ごと消す。受け止める場所が
 * 無いと画面全体が消えるので、**何も書かれていない白い紙**だけが残る。
 * 使う側からは「押したら真っ白になった」としか見えず、
 * 直す側も何が起きたのか分からない（本人報告。こちらでは再現しなかった）。
 *
 * ここで受け止めて、
 *   ・何が起きたか（読める言葉で）
 *   ・すぐできること（開き直す／今日へ戻る）
 *   ・伝えるための手がかり（エラーの文言。長押しでコピーできる）
 * を出す。**直せなくても、次の一歩が分かる状態にする。**
 *
 * データは触らない。落ちたのは描画で、端末に貯めたものは無事なことがほとんど。
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 開発中はコンソールに出す。本番では出しても読む人がいない
    if (import.meta.env.DEV) console.error('[Prepflow]', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    /*
      **`.pf-shell` に乗せる。**素の div のままだと、上端が時刻に重なる
      （避けるぶんを持っているのは外枠だけ）
    */
    return (
      <div className="pf-shell overflow-y-auto bg-background text-foreground">
        <div className="mx-auto max-w-md space-y-4 p-6">
          <h1 className="text-xl font-semibold">この画面がうまく開けませんでした</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            記録したものは残っています。開き直すと直ることがほとんどです。
          </p>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => location.reload()}
              className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background"
            >
              開き直す
            </button>
            <button
              onClick={() => {
                // 落ちた画面から抜ける。開き直すより軽い
                this.setState({ error: null });
                location.assign(import.meta.env.BASE_URL);
              }}
              className="min-h-12 w-full rounded-lg border text-sm font-medium"
            >
              今日の画面へ戻る
            </button>
          </div>

          {/* 伝えるための手がかり。読めなくてよい。長押しで選んで送れる */}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              うまくいかないときに伝える文
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
              {String(error.message || error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
