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
 *   1. **閉じたあと、次に開いたとき** — 閉じているあいだに直している。ここが本命
 *   2. アプリが前面に戻ったとき — 別アプリで直してきた直後を拾う
 *   3. 通信が戻ったとき — 圏外で開いていた場合
 *   4. 開いたまま置いているとき — 10分ごと
 *
 * 1 は古さを見ずに必ず取り直す（本人「アプリを閉じる度に行って下さい」）。
 * 2 は 1分以内に取っていれば見送る——前面に戻るたびに毎回叩くと、
 * GAS の実行回数を無駄にするため。
 */
import { useEffect } from 'react';
import { CALENDAR_STALE } from './gasCalendar';
import { syncFromGas } from '@/notify/gasSync';
import type { AppSettings } from '@/db/schema';

export function useCalendarSync(settings: AppSettings | undefined): void {
  const enabled = settings?.calendar.enabled ?? false;

  useEffect(() => {
    if (!settings || !enabled) return;

    /*
     * 失敗しても黙る。今日タブを開くたびに出るエラーは害でしかない。
     *
     * 歩数も同じ往復で受け取る。**別々に行くと、起動のたびに
     * コールドスタートを2回ぶん待つことになる**（notify/gasSync.ts）。
     */
    const pull = (maxAge: number) =>
      void syncFromGas(settings, { calendarMaxAgeMs: maxAge }).catch(() => {});

    /*
     * 閉じたら、次は必ず取り直す。
     *
     * 本人「アプリを閉じる度に行って下さい」。
     * ただし**閉じる瞬間に取りに行っても、返事は間に合わないことが多い**——
     * ホーム画面のアプリを閉じると、iOS はその場で JavaScript を止める。
     * 送っただけで終わり、受け取る前に眠る。
     *
     * だから2段構えにする。
     *   1. 閉じるときに「次は取り直す」と書き置きする（localStorage は同期なので、
     *      止められる前に必ず書き終わる）
     *   2. ついでに取りにも行く。間に合えばそこで済む
     *
     * 次に開いたときは書き置きを読んで、**古さを見ずに取り直す**。
     * これで「閉じるたびに同期」が、実際に効く形になる。
     */
    const DUE_KEY = 'pf-calendar-due';
    const markDue = () => {
      try {
        localStorage.setItem(DUE_KEY, '1');
      } catch {
        // 書けない端末では、ふだんの古さの判定に任せる
      }
    };
    const takeDue = (): boolean => {
      try {
        if (localStorage.getItem(DUE_KEY) !== '1') return false;
        localStorage.removeItem(DUE_KEY);
        return true;
      } catch {
        return false;
      }
    };

    // 開いたとき。前回閉じているなら、古さを見ずに取り直す
    pull(takeDue() ? 0 : CALENDAR_STALE.open);

    const onHide = () => {
      markDue();
      // 間に合えばここで済む。眠らされても、書き置きが残る
      pull(0);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') pull(takeDue() ? 0 : CALENDAR_STALE.foreground);
      else onHide();
    };
    const onOnline = () => pull(CALENDAR_STALE.foreground);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);
    // 閉じる直前。iOS ではこちらのほうが確実に来る
    window.addEventListener('pagehide', onHide);

    // 開いたまま置いている場合。画面が隠れているあいだは叩かない
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') pull(CALENDAR_STALE.polling);
    }, CALENDAR_STALE.polling);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onHide);
      window.clearInterval(timer);
    };
  }, [settings, enabled]);
}
