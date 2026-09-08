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
 * `touchmove` の2本指も塞ぐが、`passive: false` が要る（既定では止められない）。
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

  // 2本指のドラッグ。1本指のスクロールには触らない
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );

  /*
   * ダブルタップの拡大。`touch-action: manipulation` はボタンとリンクにしか
   * 掛けていないので、余白を素早く2回叩くと拡大していた。
   * 300ms 以内の2回目のタップを潰す
   */
  let lastTap = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTap < 300) e.preventDefault();
      lastTap = now;
    },
    { passive: false },
  );
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
 * 線を引く 0.9秒 → キャッチコピー → 2.12秒から名前 → 2.35秒から花畑。
 *
 * 花が咲きそろうのは4秒あたりだが、**そこまでは待たない。**
 * 消えていく最中も蔓は伸び続けるので、見えているのは「ひらく」動きで、
 * 待たされている感じにはならない。毎日開くものを4秒止めない。
 */
const SPLASH_MIN_MS = 3600;

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
