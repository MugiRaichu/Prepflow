/**
 * 共有シートから投げられたものを受け取る。
 *
 * 置いたのは Service Worker（src/sw.ts）。共有は POST で来るので、
 * 画面側では受け取れない。SW がいったん Cache に置き、
 * 取り込み画面が開いたときにここで引き取る。
 *
 * 一度読んだら消す。次に取り込み画面を開いたとき、前回の内容が出てくると
 * 何を取り込んでいるのか分からなくなる。
 */
const SHARE_CACHE = 'prepflow-share';
const BASE = import.meta.env.BASE_URL;
const FILE_KEY = BASE + '__shared-image';
const TEXT_KEY = BASE + '__shared-text';

export interface SharedPayload {
  file?: File;
  text?: string;
}

export async function takeShared(): Promise<SharedPayload> {
  const out: SharedPayload = {};
  try {
    if (!('caches' in globalThis)) return out;
    const cache = await caches.open(SHARE_CACHE);

    const img = await cache.match(FILE_KEY);
    if (img) {
      const blob = await img.blob();
      if (blob.size > 0) {
        out.file = new File([blob], 'shared', { type: blob.type || 'image/png' });
      }
      await cache.delete(FILE_KEY);
    }

    const txt = await cache.match(TEXT_KEY);
    if (txt) {
      const t = (await txt.text()).trim();
      if (t) out.text = t;
      await cache.delete(TEXT_KEY);
    }
  } catch {
    // 受け取れなければ、いつも通りの空の取り込み画面になる
  }
  return out;
}

/**
 * 共有されたのが「ページの題と URL だけ」か。
 *
 * ブラウザからページを共有すると、多くの場合これしか来ない。
 * 中身を取りに行くことはしない（規約・著作権。D-073）ので、
 * その場合は何を追加でしてもらうかを画面で言う必要がある。
 */
export function isLinkOnly(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 3) return false;
  // 数字と単位（材料らしさ）が1行も無く、URL が混ざっている
  const hasUrl = lines.some((l) => /^https?:\/\//.test(l));
  const hasAmount = lines.some((l) => /\d/.test(l.replace(/^https?:\/\/\S+$/, '')));
  return hasUrl && !hasAmount;
}
