/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

/**
 * Service Worker。
 *
 * 自前で書いているのは**共有シートから受け取るため**だけ。
 * 「レシピを見ているアプリの共有メニューから Prepflow に投げる」を成立させるには、
 * 共有された画像を POST で受け取る口が要る。POST を受けられるのは SW だけなので、
 * 生成まかせ（generateSW）ではここが作れない。
 *
 * それ以外の役割はこれまで通り、アプリ本体の precache と SPA のフォールバック。
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

/** 配信パス。`/` のことも `/Prepflow/` のこともある。SW の置き場所から割り出す */
const BASE = new URL('./', self.location.href).pathname;

/** 共有シートの投げ先。manifest の share_target.action と一致させる */
const SHARE_PATH = BASE + 'share-target';

/** 受け取ったものの置き場。次に開いた画面が取りに来るまでの一時保管 */
const SHARE_CACHE = 'prepflow-share';
const SHARE_FILE = BASE + '__shared-image';
const SHARE_TEXT = BASE + '__shared-text';

/*
 * 共有の受け口。
 *
 * workbox の登録より**先**に置く。fetch は先に respondWith したものが勝つので、
 * 順番が逆だとナビゲーションとして扱われて素通りする。
 * （workbox 側は GET しか拾わないので実害は出ないが、順番に依存させない）
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== SHARE_PATH) return;

  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const cache = await caches.open(SHARE_CACHE);

        const file = form.get('image');
        if (file instanceof File && file.size > 0) {
          await cache.put(
            SHARE_FILE,
            new Response(file, {
              headers: { 'content-type': file.type || 'image/png' },
            }),
          );
        } else {
          await cache.delete(SHARE_FILE);
        }

        // ページを共有すると題と URL だけが来る。材料を選択して共有すると本文が来る。
        // どちらも同じ欄に入れて、取り込み画面に判断させる
        const text = ['title', 'text', 'url']
          .map((k) => form.get(k))
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .join('\n');
        if (text) await cache.put(SHARE_TEXT, new Response(text));
        else await cache.delete(SHARE_TEXT);
      } catch {
        // 受け取れなくても、空の取り込み画面を開く。落とさない
      }
      // 303 にしないと、開いた画面を再読み込みするたびに POST が飛ぶ
      return Response.redirect(BASE + 'recipes/new?shared=1', 303);
    })(),
  );
});

// アプリ本体（JS/CSS/HTML/アイコン）を precache してオフライン起動を保証する
precacheAndRoute(self.__WB_MANIFEST);

// 静的ホスティングに /plan のようなファイルは無いので、index.html を返す
registerRoute(new NavigationRoute(createHandlerBoundToURL(BASE + 'index.html')));

// 新しい版をすぐ有効にする（registerType: 'autoUpdate' と同じ挙動）
self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());
