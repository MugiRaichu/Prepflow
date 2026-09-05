/**
 * GitHub Pages 用の 404 フォールバック。
 *
 * 静的ホスティングは `/plan` のような URL に対応するファイルが無いと 404 を返す。
 * このアプリはクライアント側でルーティングするので、404 のときも index.html を
 * 返してもらう必要がある。GitHub Pages は 404.html を使うので、複製を置く。
 *
 * ハッシュルーティング（/#/plan）にすればこれは要らないが、
 * URL が汚れるうえ PWA の start_url とも噛み合わせづらいので採らない。
 */
import { copyFileSync, existsSync } from 'node:fs';

const src = 'dist/index.html';
if (existsSync(src)) {
  copyFileSync(src, 'dist/404.html');
  console.log('dist/404.html を作成しました');
}
