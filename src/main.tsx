import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ensureSeeded } from './db/seed';
import { flushOutbox } from './notify/gasClient';
import { trackViewportHeight } from './lib/viewport';
import './index.css';

// Service Worker 登録（autoUpdate: 新版があればバックグラウンドで差し替え）
registerSW({ immediate: true });

// 見えている高さを測り続ける。描画より先に始めないと初回だけ枠がずれる
trackViewportHeight();

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
const SPLASH_MIN_MS = 980;

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
