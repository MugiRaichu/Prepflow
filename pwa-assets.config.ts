/**
 * `npm run icons` で public/icons/icon.svg から PNG 一式を生成する。
 * 生成物: pwa-64x64 / pwa-192x192 / pwa-512x512 / maskable-icon-512x512 / apple-touch-icon-180x180 / favicon.ico
 * 余白の塗りつぶしは黒（#000000）に固定。モノクロのブランド要件のため。
 */
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { background: '#000000' },
    },
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: { background: '#000000' },
    },
  },
  images: ['public/icons/icon.svg'],
});
