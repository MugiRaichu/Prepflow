import { useCallback, useEffect, useRef, useState } from 'react';
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

/** これより前に鳴り終わったものは、前回の調理の残骸とみなして捨てる */
const STALE_MS = 6 * 60 * 60 * 1000;

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

  // アプリに戻ってきた瞬間に描き直す。裏に回っている間は端末が
  // setInterval を間引くので、戻ったとき古い残り時間が出たままになる
  useEffect(() => {
    const wake = () => tick((n) => n + 1);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);

  const now = Date.now();
  const timers: RunningTimer[] = Object.entries(stored)
    .filter(([, t]) => t.endsAt > now - STALE_MS)
    .map(([taskId, t]) => ({
      taskId,
      label: t.label,
      endsAt: t.endsAt,
      remainSec: Math.max(0, Math.round((t.endsAt - now) / 1000)),
    }))
    .sort((a, b) => a.endsAt - b.endsAt);

  const write = useCallback(
    async (next: Stored) => {
      if (!planId) return;
      await db.meta.put({ key: keyFor(planId), value: next, updatedAt: nowIso() });
    },
    [planId],
  );

  /*
   * 鳴らす担当。描画の間引きに巻き込まれないよう、1秒ごとの再描画とは別に
   * 「終了時刻ちょうど」の setTimeout を1本ずつ張る。
   * 同じタイマーで二度鳴らさないよう、鳴らした鍵（id + 終了時刻）を覚えておく。
   */
  const firedRef = useRef<Set<string>>(new Set());
  const sig = Object.entries(stored)
    .map(([id, t]) => id + '@' + t.endsAt)
    .join('|');

  useEffect(() => {
    const handles: number[] = [];
    for (const part of sig ? sig.split('|') : []) {
      const at = Number(part.slice(part.lastIndexOf('@') + 1));
      if (!Number.isFinite(at)) continue;
      const label = stored[part.slice(0, part.lastIndexOf('@'))]?.label ?? '';
      const fire = () => {
        if (firedRef.current.has(part)) return;
        firedRef.current.add(part);
        void alertTimerDone(label);
        tick((n) => n + 1);
      };
      if (firedRef.current.has(part)) continue;
      const wait = at - Date.now();
      // 起動時にすでに過ぎているものは、前回の調理の残骸なので鳴らさない
      if (wait <= -STALE_MS) firedRef.current.add(part);
      else if (wait <= 0) fire();
      else handles.push(window.setTimeout(fire, wait));
    }
    return () => handles.forEach((h) => clearTimeout(h));
    // stored は毎回作り直されるので、中身を表す sig を鍵にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return {
    timers,
    /** 鳴っているもの（0秒になったが、まだ止めていない） */
    ringing: timers.filter((t) => t.remainSec === 0),
    start: async (taskId: string, label: string, seconds: number) => {
      // 掛ける操作そのものが「鳴ったら知らせてほしい」という意思表示なので、
      // 許可を求めるならこの瞬間しかない（設定画面に置いても意味が伝わらない）
      void requestTimerNotice();
      await write({ ...stored, [taskId]: { label, endsAt: Date.now() + seconds * 1000 } });
    },
    stop: async (taskId: string) => {
      const next = { ...stored };
      delete next[taskId];
      await write(next);
    },
    // 古すぎて一覧から外したものは「動いていない」。ここが stored 直読みだと、
    // 画面に出ていないタイマーのせいでボタンが消えたままになる
    has: (taskId: string) => timers.some((t) => t.taskId === taskId),
    /** 通知が使えるか。使えないときだけ画面で断りを入れる */
    noticeBlocked:
      typeof Notification !== 'undefined' && Notification.permission === 'denied',
  };
}

/**
 * 通知の許可。**タップの中からしか呼ばない**（ブラウザが黙って拒否するため）。
 * すでに許可・拒否が決まっているときは何もしない。
 */
export async function requestTimerNotice(): Promise<void> {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    await Notification.requestPermission();
  } catch {
    // 対応していない端末では何もしない
  }
}

/**
 * 鳴ったことを体で分かるようにする。
 *
 * 手が濡れていて画面を見ていない前提なので、振動と通知の両方を出す。
 *
 * 通知は **Service Worker 経由**で出す。Android の Chrome では
 * `new Notification()` が例外になり、これまで通知が一切出ていなかった。
 * ホーム画面に追加した iOS でも、出せるのはこの経路だけ。
 */
export async function alertTimerDone(label: string): Promise<void> {
  const pattern = [400, 200, 400, 200, 400];
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // 対応していない端末では何もしない
  }

  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // 型定義が vibrate / renotify を知らないので、ここだけ緩める
    const options = {
      body: label,
      tag: 'prepflow-timer',
      renotify: true,
      // 手が離せないことがあるので、触るまで消さない
      requireInteraction: true,
      vibrate: pattern,
      icon: import.meta.env.BASE_URL + 'icons/pwa-192x192.png',
      badge: import.meta.env.BASE_URL + 'icons/pwa-64x64.png',
    } as NotificationOptions;

    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification('できあがりました', options);
      return;
    }
    new Notification('できあがりました', options);
  } catch {
    // 通知が使えなくても、画面には出ているので困らない
  }
}
