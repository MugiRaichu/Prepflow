import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 公開先のパス。
 *
 * GitHub Pages は `https://<ユーザー>.github.io/<リポジトリ>/` に置かれるので、
 * ルート直下を前提にすると JS も画像も 404 になる。
 * 配信元に合わせて VITE_BASE で渡す（例: `/prepflow/`）。
 * 自分のドメインやローカルではそのまま `/`。
 */
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  // スマホから同じ Wi-Fi で開けるようにする（http なので確認用。常用は公開先で）
  server: { host: true },
  preview: { host: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Prepflow',
        short_name: 'Prepflow',
        description: '週末に作り置きして、平日の食事を無思考にする',
        lang: 'ja',
        // base 配下に置かれても正しく起動するよう、配信パスに合わせる
        start_url: base,
        scope: base,
        id: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // アプリ本体（JS/CSS/HTML/アイコン）はすべて precache してオフライン起動を保証する
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: base + 'index.html',
        // WebLLM のモデル重み（数百MB〜）は Workbox に触らせない。
        // WebLLM 自身が Cache API に格納するので、ここは NetworkOnly で素通しにする。
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(huggingface\.co|raw\.githubusercontent\.com)\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        // 開発中に SW を有効にするとキャッシュで混乱するので既定は無効。
        // PWA の挙動を確認したいときだけ true にして `npm run build && npm run preview`。
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // dexie-react-hooks が別の React 実体を掴むと
    // "Invalid hook call" になるので、必ず1つに解決させる
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'dexie', 'dexie-react-hooks'],
  },
  worker: {
    // WebLLM Worker を ESM で出す（Vite 既定は iife）
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
