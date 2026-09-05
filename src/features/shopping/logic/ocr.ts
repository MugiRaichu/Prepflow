/**
 * レシートの文字認識。
 *
 * ブラウザ内蔵の TextDetector（Shape Detection API）は 2026-09 時点でも
 * 実験フラグ必須（Chrome Canary / Edge）で、一般利用者には配れない。
 * したがって Tesseract.js を使う。
 *
 * 本体（WASM 約3.3MB）と日本語データ（約1.9MB）は CDN から実行時に取得する。
 * アプリ本体のバンドルには入れない。使う人だけが1回落とし、以後は
 * Tesseract.js 自身が IndexedDB にキャッシュする。
 * 初回だけ通信が要ることは UI に明記する。
 */

export interface OcrProgress {
  /** 0〜1 */
  ratio: number;
  label: string;
}

const LABELS: Record<string, string> = {
  loading_tesseract_core: '読み取りエンジンを準備しています',
  initializing_tesseract: '読み取りエンジンを準備しています',
  loading_lang_traineddata: '日本語データを取得しています',
  initializing_api: '準備しています',
  recognizing_text: '画像を読んでいます',
};

/**
 * 画像から文字を読む。レシートにもレシピにも使う。
 *
 * tesseract.js は動的に読み込む。静的に import すると
 * 使わない人のバンドルにも入ってしまう。
 *
 * **読み取ったあと画像は保存しない。**
 * スクリーンショット1枚が 0.5〜2MB あり、レシピ本文（1件 約1.7KB）の
 * 300〜1000件ぶんに相当する。溜まって困るのは文字ではなく画像のほう。
 */
export async function readImageText(
  file: File | Blob,
  onProgress?: (p: OcrProgress) => void,
): Promise<string> {
  const { createWorker } = await import('tesseract.js');

  const worker = await createWorker('jpn', 1, {
    logger: (m: { status: string; progress: number }) => {
      onProgress?.({
        ratio: typeof m.progress === 'number' ? m.progress : 0,
        label: LABELS[m.status] ?? '処理しています',
      });
    },
  });

  try {
    const { data } = await worker.recognize(file);
    return data.text ?? '';
  } finally {
    // 使い終わったら必ず落とす。放置するとワーカーが残る
    await worker.terminate();
  }
}

/** 旧名。レシート読み取りから使われている */
export const readReceipt = readImageText;

/** この端末で読み取りが使えるか。File API とワーカーがあれば動く */
export function ocrSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined';
}
