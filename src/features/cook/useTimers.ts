import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowIso } from '@/db/db';

/**
 * 調理中のタイマー。
 *
 * **複数同時に動かせることが要件。**並行調理を組んでいるので、
 * 煮込みながら次の食材を切る。タイマーが1つしか持てないと段取りが崩れる。
 *
 * 残り時間は「終了時刻」から毎秒計算する。残り秒数を減らしていく持ち方だと、
 * タブを離れている間に止まる。端末に置くのも同じ理由（D-086）。
 * 画面を閉じても、戻ったときに正しい残りが出る。
 */
export interface RunningTimer {
  taskId: string;
  label: string;
  endsAt: number;
  /** 残り秒。0 なら鳴っている */
  remainSec: number;
}

type Stored = Record<string, { label: string; endsAt: number }>;

const keyFor = (planId: string) => 'cookTimers:' + planId;

export function useCookTimers(planId: string | undefined) {
  const row = useLiveQuery(
    async () => (planId ? await db.meta.get(keyFor(planId)) : undefined),
    [planId],
  );
  const stored = (row?.value as Stored | undefined) ?? {};

  // 1秒ごとに描き直すためだけの state。時刻そのものは stored から計算する
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const timers: RunningTimer[] = Object.entries(stored)
    .map(([taskId, t]) => ({
      taskId,
      label: t.label,
      endsAt: t.endsAt,
      remainSec: Math.max(0, Math.round((t.endsAt - now) / 1000)),
    }))
    .sort((a, b) => a.endsAt - b.endsAt);

  const write = async (next: Stored) => {
    if (!planId) return;
    await db.meta.put({ key: keyFor(planId), value: next, updatedAt: nowIso() });
  };

  return {
    timers,
    /** 鳴っているもの（0秒になったが、まだ止めていない） */
    ringing: timers.filter((t) => t.remainSec === 0),
    start: async (taskId: string, label: string, seconds: number) => {
      await write({ ...stored, [taskId]: { label, endsAt: Date.now() + seconds * 1000 } });
    },
    stop: async (taskId: string) => {
      const next = { ...stored };
      delete next[taskId];
      await write(next);
    },
    has: (taskId: string) => Boolean(stored[taskId]),
  };
}

/**
 * 鳴ったことを体で分かるようにする。
 *
 * 手が濡れていて画面を見ていない前提なので、振動を主にする。
 * 通知は許可が要るうえ、許可を求める操作自体が邪魔なので、
 * **こちらからは求めない**。すでに許可されている場合だけ使う。
 */
export function alertTimerDone(label: string): void {
  try {
    navigator.vibrate?.([400, 200, 400, 200, 400]);
  } catch {
    // 対応していない端末では何もしない
  }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('できあがりました', { body: label, tag: 'prepflow-timer' });
    }
  } catch {
    // 通知が使えなくても、画面には出ているので困らない
  }
}
