import { db, nowIso } from '@/db/db';
import type { RecipePhoto, UUID } from '@/db/schema';

/**
 * 料理の写真。
 *
 * **写真は本人が撮ったものだけを持つ。**外から集めた写真は載せない
 * （権利の確認ができないうえ、138品ぶんを同梱するとアプリが数十MBになり、
 *  オフラインで動かすという前提が崩れる。D-073 / D-105 と同じ線）。
 *
 * 作ったときに1枚撮れば、次からはその写真が献立に出る。
 * よその皿より、自分が作った皿のほうが「これを作る」の手がかりになる。
 */

/** 保存する長辺。これ以上大きくても一覧では見分けが付かない */
const MAX_EDGE = 640;

/** JPEG の品質。0.72 で見た目はほぼ変わらず、容量は 1/4 以下になる */
const QUALITY = 0.72;

/**
 * 撮った画像を縮めてから保存する。
 *
 * 元のままだと1枚4〜8MBあり、数十品で端末の割り当てを使い切る。
 * 長辺640pxのJPEGなら1枚おおむね60〜120KB。
 */
async function shrink(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を処理できませんでした');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  if (!blob) throw new Error('画像を保存できませんでした');
  return { blob, width, height };
}

export async function setRecipePhoto(recipeId: UUID, file: Blob): Promise<void> {
  const { blob, width, height } = await shrink(file);
  await db.recipePhotos.put({ recipeId, blob, width, height, updatedAt: nowIso() });
}

export async function getRecipePhoto(recipeId: UUID): Promise<RecipePhoto | undefined> {
  return db.recipePhotos.get(recipeId);
}

export async function removeRecipePhoto(recipeId: UUID): Promise<void> {
  await db.recipePhotos.delete(recipeId);
}

/** 写真を持っているレシピID。一覧で「撮ってある／まだ」を出すのに使う */
export async function photographedRecipeIds(): Promise<Set<UUID>> {
  return new Set(await db.recipePhotos.toCollection().primaryKeys());
}

/** 端末に置いている写真の合計サイズ（バイト）。データの画面で出す */
export async function photoBytes(): Promise<number> {
  let total = 0;
  await db.recipePhotos.each((p) => {
    total += p.blob.size;
  });
  return total;
}
