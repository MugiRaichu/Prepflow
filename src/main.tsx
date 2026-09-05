import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ensureSeeded } from './db/seed';
import { flushOutbox } from './notify/gasClient';
import './index.css';

// Service Worker 登録（autoUpdate: 新版があればバックグラウンドで差し替え）
registerSW({ immediate: true });

// 圏外で溜まった送信を、起動時とオンライン復帰時に流す
const flush = () => void flushOutbox().catch(() => {});
window.addEventListener('online', flush);

// 初回起動時のみ既定設定と食材マスタを投入してから描画する
ensureSeeded().finally(() => {
  if (navigator.onLine) flush();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
