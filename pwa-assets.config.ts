/**
 * `npm run icons` で public/icons/icon.svg から PNG 一式を生成する。
 * 生成物: pwa-64x64 / pwa-192x192 / pwa-512x512 / maskable-icon-512x512 / apple-touch-icon-180x180 / favicon.ico
 * **余白の塗りは、アイコン自身の地色（生成り）にそろえる。**
 *
 * ここが黒のままだったせいで、ホーム画面のアイコンに黒い四角の縁が出ていた
 * （本人「アイコンの周りが四角になってしまっています」）。
 * iOS は外側を丸めるが、丸めた内側に残る黒は消せない。
 *
 * 絵は前の版に戻したが（本人指定）、**この黒だけは戻さない。**
 * 黒は白黒だった頃の名残で、絵とは関係のない不具合だった。
 */
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: { background: '#faf7f2' },
    },
    /*
     * ホーム画面のアイコンは余白をほとんど取らない。
     * プリセットは 30% 空けるが、**絵の側にもすでに余白がある**ので、
     * 二重にかかって印が豆粒になる（実測）。
     */
    apple: {
      ...minimal2023Preset.apple,
      padding: 0.06,
      resizeOptions: { background: '#faf7f2' },
    },
  },
  images: ['public/icons/icon.svg'],
});
