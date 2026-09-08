import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ensureSeeded } from './db/seed';
import { flushOutbox } from './notify/gasClient';
import './index.css';

// Service Worker 登録（autoUpdate: 新版があればバックグラウンドで差し替え）
registerSW({ immediate: true });

/**
 * ホーム画面から起動したときだけ、拡大を止める。
 *
 * standalone にはアドレスバーが無い。**一度ズームすると戻せない。**
 * 調理中に濡れた手や指の腹で触ると簡単に2本指と判定され、
 * 傾いたまま拡大された画面のまま作業を続けることになる。
 *
 * **ブラウザのタブでは止めない。**そちらはピンチで戻せるし、
 * 読みづらいときに拡大できることのほうが大事（アクセシビリティ）。
 * 文字の大きさは端末の設定に従うので、拡大を止めても小さいままにはならない。
 *
 * iOS は viewport の `user-scalable=no` を無視することがあるので、
 * Safari 独自の gesture イベントも併せて止める。
 *
 * **指のイベント（touchmove / touchend）には触らない。**
 * そこを塞ぐとスクロールごと止まる（下の但し書き）。
 */
function lockZoomInStandalone(): void {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    // iOS の Safari だけが持つ独自プロパティ。標準の display-mode より確実な場面がある
    (navigator as { standalone?: boolean }).standalone === true;
  if (!standalone) return;

  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    const content = meta.getAttribute('content') ?? '';
    if (!content.includes('user-scalable')) {
      meta.setAttribute('content', content + ', maximum-scale=1, user-scalable=no');
    }
  }

  // Safari のピンチ。これを止めないと iOS では meta だけでは効かない
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  /*
   * **指のイベントには触らない。**
   *
   * ここには以前2つ置いていて、どちらもスクロールを殺していた。
   *
   *   touchend の preventDefault … 300ms以内の2回目のタップをダブルタップと
   *     見なして潰していた。ところが**指ではじいて送るスクロールも、
   *     1回ごとに touchend で終わる。**続けて2回はじくと2回目が潰され、
   *     iOS は慣性スクロールを取り消す。画面が固まって動かなくなる（本人報告）。
   *
   *   touchmove の passive:false … 2本指のときだけ止める書き方だが、
   *     document に非パッシブの listener を置いた時点で、iOS は
   *     スクロールを合成側で先に動かせなくなる。
   *
   * どちらも要らない。**拡大は CSS で止まっている**——
   * standalone では `html, body { touch-action: pan-x pan-y }` が効いていて、
   * WebKit は touch-action が auto 以外なら、ピンチもダブルタップ拡大も
   * どちらも受け付けない（index.css）。JS より先に、合成側で決まる。
   *
   * 残す保険は Safari 独自の gesture イベントだけ。
   * これはピンチそのものの通知で、スクロールには一切関わらない。
   */
}

lockZoomInStandalone();

// iPhone のショートカットが GAS へ送った歩数・消費カロリーを取り込む。
// 未設定・圏外なら何もしない
void import('./health/gasHealth').then((m) => m.pullHealthIfStale());

// 圏外で溜まった送信を、起動時とオンライン復帰時に流す
const flush = () => void flushOutbox().catch(() => {});
window.addEventListener('online', flush);

/**
 * 起動画面を引く。
 *
 * 線を引き終わる前に消えると、何が出たのか分からないまま画面が変わる。
 * かといって毎回きっちり待たせると、2回目以降は邪魔なだけ。
 * 「演出が終わるまで」と「読み込みが終わるまで」の遅いほうに合わせる。
 */
/*
 * 線を引く 0.9秒（0.7秒から絵の下地が立ち上がる）→ キャッチコピー →
 * 1.5秒から絵の主役 → 2.12秒で名前 → 3.7秒で本体へ渡す。
 *
 * **全体を0.7秒短くした**（本人指定）。出す時刻も前へずらしてあるので、
 * 絵が見えている幅は 2.2秒ぶん残る。毎日開くものなので、
 * 演出のために待たせる時間は短いほどよい。
 */
const SPLASH_MIN_MS = 3700;

function dismissSplash(): void {
  const el = document.getElementById('pf-splash');
  if (!el) return;
  // performance.now() はページを開いた瞬間からの経過時間
  const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
  window.setTimeout(() => {
    el.classList.add('is-gone');
    window.setTimeout(() => el.remove(), 420);
  }, wait);
}

// 初回起動時のみ既定設定と食材マスタを投入してから描画する
ensureSeeded().finally(() => {
  if (navigator.onLine) flush();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  dismissSplash();
});
