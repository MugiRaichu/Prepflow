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
      // 共有シートから投げられたものを POST で受け取るため、SW は自前で書く。
      // 生成まかせ（generateSW）では POST の口を足せない → src/sw.ts
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Prepflow',
        short_name: 'Prepflow',
        description: 'ごはんを、その人の暮らしに合わせる。献立・買い出し・作り置きを自動で組む',
        lang: 'ja',
        // base 配下に置かれても正しく起動するよう、配信パスに合わせる
        start_url: base,
        scope: base,
        id: base,
        display: 'standalone',
        orientation: 'portrait',
        /*
         * 共有シートに Prepflow を出す。
         *
         * レシピを見ているアプリ（ブラウザ・SNS・写真）から「共有 → Prepflow」で
         * 材料を投げ込めるようにする。**外からは取りに行かない**（規約・著作権。D-073）。
         * 動くのは本人が共有を押したときだけ。
         *
         * 対応は Android と、デスクトップの Chrome / Edge。
         * iOS は share_target を持たないので、そちらは写真選択と貼り付けで受ける。
         */
        share_target: {
          action: base + 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'image', accept: ['image/*'] }],
          },
        },
        // 地色。黒のままだと起動時の下地と縁が黒くなる（白黒だった頃の名残）
        background_color: '#faf7f2',
        theme_color: '#faf7f2',
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
      injectManifest: {
        // アプリ本体（JS/CSS/HTML/アイコン）はすべて precache してオフライン起動を保証する。
        // 文字認識のモデル（数MB）は初回に取りに行くので、ここには含めない
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
