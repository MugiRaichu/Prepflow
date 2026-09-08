/**
 * Google カレンダーの予定を追いかける。
 *
 * **押させない。**カレンダーを直したあとにアプリで更新ボタンを探すのは、
 * 二度手間を通り越して、たいてい忘れる。
 *
 * これまでは今日タブを開いたときに「6時間より古ければ取り直す」だけだった。
 * 別のアプリで予定を直してすぐ戻ってきても、今日の流れは半日前のまま
 * だった（本人指摘）。
 *
 * ---
 * **できないこと**も書いておく。
 * Google カレンダーの変更をその場で受け取るには、変更通知を受ける
 * サーバーが要る。このアプリはサーバーを持たない（持つと費用と身元が要る）。
 * だから「変わった瞬間に届く」ことはない。**こちらから見に行く**しかない。
 *
 * 見に行く場面を、人がカレンダーを直しそうな順に置く。
 *   1. アプリが前面に戻ったとき — 別アプリで直してきた直後を拾う。ここが本命
 *   2. 通信が戻ったとき — 圏外で開いていた場合
 *   3. 開いたまま置いているとき — 10分ごと
 * 前面に戻るたびに毎回叩くと GAS の実行回数を無駄にするので、
 * 1分以内に取っていれば見送る。
 */
import { useEffect } from 'react';
import { CALENDAR_STALE, syncCalendarIfStale } from './gasCalendar';
import type { AppSettings } from '@/db/schema';

export function useCalendarSync(settings: AppSettings | undefined): void {
  const enabled = settings?.calendar.enabled ?? false;

  useEffect(() => {
    if (!settings || !enabled) return;

    // 失敗しても黙る。今日タブを開くたびに出るエラーは害でしかない
    const pull = (maxAge: number) => void syncCalendarIfStale(settings, maxAge).catch(() => {});

    pull(CALENDAR_STALE.open);

    const onVisible = () => {
      if (document.visibilityState === 'visible') pull(CALENDAR_STALE.foreground);
    };
    const onOnline = () => pull(CALENDAR_STALE.foreground);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);

    // 開いたまま置いている場合。画面が隠れているあいだは叩かない
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') pull(CALENDAR_STALE.polling);
    }, CALENDAR_STALE.polling);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [settings, enabled]);
}
