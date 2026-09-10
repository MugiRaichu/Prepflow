import { db, newEntity, nowIso } from '@/db/db';
import { todayIso } from '@/lib/labels';
import type { ISODate, MealLog, MealSlot, UUID } from '@/db/schema';

/**
 * 食事の記録（写真とメモ）。
 *
 * **一度やめて、もう一度入れた。**前は「作ったものを撮って一覧に出す」機能で、
 * 作り置きの皿は映えないからと外した（D-125）。今回は目的が違う——
 * **飾るためではなく、あとで見返すため。**
 * 見返す相手は自分だけなので、映えるかどうかは関係がない。
 *
 * ---
 * **写真とメモを同じものとして持つ。**撮り忘れた日も、撮る場面ではなかった日も、
 * 味の覚書だけ残したい日もある。別々に持つと、見返すときに2つ並べて
 * 時系列を頭で合わせることになる。
 *
 * **置き場所はレシピではなく、食べた1回に紐づける。**
 * 同じ料理でも、作った日ごとに記録は別物になる。
 * 献立に無いもの（間食）も同じ形で持てるように、
 * 献立の食事（`plannedMealId`）は**任意**にしてある。
 */

/** 長辺の上限。これ以上大きくしても、画面で見るぶんには変わらない */
const MAX_EDGE = 1280;
/** JPEG の品質。0.82 は、見た目が落ちる手前でいちばん軽くなるあたり */
const QUALITY = 0.82;

/**
 * 端末で撮った写真は 3〜8MB ある。**そのまま貯めると数十枚で端末が悲鳴を上げる。**
 * 長辺 1280px の JPEG に落とすと 1枚 100〜250KB になり、
 * 画面で見るぶんには元と区別が付かない。
 *
 * 落とすのは**保存する前**。大きいまま入れてから縮めても、
 * 一度は書き込んでいるので意味がない。
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
  if (!ctx) {
    bitmap.close();
    // 描けない端末では、そのまま入れる。撮れないより重いほうがまし
    return { blob: file, width: bitmap.width, height: bitmap.height };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  return { blob: blob ?? file, width, height };
}

export interface LogWhere {
  date?: ISODate;
  slot: MealSlot;
  /** 献立の食事に紐づくなら。間食など、献立に無いものは持たない */
  plannedMealId?: UUID;
  profileId?: UUID;
}

function base(where: LogWhere): MealLog {
  return {
    ...newEntity(),
    date: where.date ?? todayIso(),
    slot: where.slot,
    takenAt: nowIso(),
    ...(where.plannedMealId ? { plannedMealId: where.plannedMealId } : {}),
    ...(where.profileId ? { profileId: where.profileId } : {}),
  };
}

export async function addPhoto(input: LogWhere & { file: Blob }): Promise<MealLog> {
  const { blob, width, height } = await shrink(input.file);
  const log: MealLog = { ...base(input), image: blob, width, height };
  await db.mealPhotos.add(log);
  return log;
}

/** 文だけの記録。写真が無くても、その日の並びに置ける */
export async function addNote(input: LogWhere & { note: string }): Promise<MealLog | null> {
  const note = input.note.trim();
  if (!note) return null;
  const log: MealLog = { ...base(input), note };
  await db.mealPhotos.add(log);
  return log;
}

/** その日の記録。並びは書いた順 */
export async function logsOn(date: ISODate): Promise<MealLog[]> {
  const rows = await db.mealPhotos.where('date').equals(date).toArray();
  return rows.filter((p) => p.deleted === 0).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

/** 見返す画面のための、日ごとのまとまり。新しい日から */
export async function logsByDay(limitDays = 60): Promise<{ date: ISODate; logs: MealLog[] }[]> {
  const all = (await db.mealPhotos.toArray()).filter((p) => p.deleted === 0);
  const byDate = new Map<ISODate, MealLog[]>();
  for (const p of all) {
    const list = byDate.get(p.date);
    if (list) list.push(p);
    else byDate.set(p.date, [p]);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limitDays)
    .map(([date, logs]) => ({
      date,
      logs: logs.sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    }));
}

export async function logCount(): Promise<number> {
  return (await db.mealPhotos.toArray()).filter((p) => p.deleted === 0).length;
}

/**
 * 消す。**本当に消す**（ソフト削除にしない）。
 * 写真は重いので、消したつもりのものが端末に残り続けるのは困る。
 */
export async function removeLog(id: UUID): Promise<void> {
  await db.mealPhotos.delete(id);
}
