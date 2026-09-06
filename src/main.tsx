import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ensureSeeded } from './db/seed';
import { flushOutbox } from './notify/gasClient';
import './index.css';

// Service Worker 登録（autoUpdate: 新版があればバックグラウンドで差し替え）
registerSW({ immediate: true });

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
// 線を引く 0.9秒 → キャッチコピー → 2.12秒から名前。名前が出きるまで消さない
const SPLASH_MIN_MS = 2900;

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
