import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { db } from './db/db';
import { ensureSeeded } from './db/seed';
import { flushOutbox } from './notify/gasClient';
import './index.css';

// Service Worker 登録（autoUpdate: 新版があればバックグラウンドで差し替え）
registerSW({ immediate: true });

/**
 * ホーム画面から起動したときだけ、拡大を止める。
 *
 * standalone にはアドレスバーが無い。**一度ズームすると戻せない。**
 * 調理中に濡れた手や指の腹で触ると簡単に2本指と判定され、
 * 傾いたまま拡大された画面のまま作業を続けることになる。
 *
 * **ブラウザのタブでは止めない。**そちらはピンチで戻せるし、
 * 読みづらいときに拡大できることのほうが大事（アクセシビリティ）。
 * 文字の大きさは端末の設定に従うので、拡大を止めても小さいままにはならない。
 *
 * iOS は viewport の `user-scalable=no` を無視することがあるので、
 * Safari 独自の gesture イベントも併せて止める。
 *
 * **指のイベント（touchmove / touchend）には触らない。**
 * そこを塞ぐとスクロールごと止まる（下の但し書き）。
 */
function lockZoomInStandalone(): void {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    // iOS の Safari だけが持つ独自プロパティ。標準の display-mode より確実な場面がある
    (navigator as { standalone?: boolean }).standalone === true;
  if (!standalone) return;

  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    const content = meta.getAttribute('content') ?? '';
    if (!content.includes('user-scalable')) {
      meta.setAttribute('content', content + ', maximum-scale=1, user-scalable=no');
    }
  }

  // Safari のピンチ。これを止めないと iOS では meta だけでは効かない
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  /*
   * **指のイベントには触らない。**
   *
   * ここには以前2つ置いていて、どちらもスクロールを殺していた。
   *
   *   touchend の preventDefault … 300ms以内の2回目のタップをダブルタップと
   *     見なして潰していた。ところが**指ではじいて送るスクロールも、
   *     1回ごとに touchend で終わる。**続けて2回はじくと2回目が潰され、
   *     iOS は慣性スクロールを取り消す。画面が固まって動かなくなる（本人報告）。
   *
   *   touchmove の passive:false … 2本指のときだけ止める書き方だが、
   *     document に非パッシブの listener を置いた時点で、iOS は
   *     スクロールを合成側で先に動かせなくなる。
   *
   * どちらも要らない。**拡大は CSS で止まっている**——
   * standalone では `html, body { touch-action: pan-x pan-y }` が効いていて、
   * WebKit は touch-action が auto 以外なら、ピンチもダブルタップ拡大も
   * どちらも受け付けない（index.css）。JS より先に、合成側で決まる。
   *
   * 残す保険は Safari 独自の gesture イベントだけ。
   * これはピンチそのものの通知で、スクロールには一切関わらない。
   */
}

lockZoomInStandalone();

/**
 * **画面の高さを測って外枠に渡し、文書がずれたら戻す。**
 *
 * iPhone は入力欄にキーボードが出ると、欄を見せるために**文書ごと上へ動かす**。
 * 閉じても元に戻らないことがあり、そのあいだ
 *   ・見出しが時刻に潜る
 *   ・タブバーが本文の下端を覆い、最後の行が押せない
 * が同時に起きる（本人「たまに…タッチできなくなる」）。
 *
 * 直し方は2つ。
 *   1. 外枠の高さを `innerHeight` の実測にする（CSS の単位の食い違いを持ち込まない）
 *   2. **入力が終わったら**文書の位置を 0 に戻す
 *
 * 入力中は戻さない。戻すと、打っている欄がキーボードの裏に隠れる。
 * 戻すのは、入力欄から離れた・画面に戻ってきた・向きが変わった、のとき。
 */
function keepViewportSteady(): void {
  const root = document.documentElement;

  const editing = () => {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  };

  const settle = () => {
    root.style.setProperty('--pf-app-h', window.innerHeight + 'px');
    if (editing()) return;
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    // 文書の上に余計な押し上げが残っていたら消す（iOS は body 側に残すことがある）
    if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
    if (root.scrollTop !== 0) root.scrollTop = 0;
  };

  // キーボードは閉じる動きに時間がかかる。閉じ終わったころにもう一度見る
  const settleSoon = () => {
    settle();
    window.setTimeout(settle, 120);
    window.setTimeout(settle, 400);
  };

  settle();
  window.addEventListener('resize', settle);
  window.addEventListener('orientationchange', settleSoon);
  window.addEventListener('pageshow', settleSoon);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settleSoon();
  });
  // 入力欄から離れた＝キーボードが閉じる
  document.addEventListener('focusout', settleSoon);
  // キーボードの出し入れで見えている枠が変わる
  window.visualViewport?.addEventListener('resize', settle);
  // 何かの拍子に文書がスクロールされたら、入力中でなければその場で戻す
  window.addEventListener('scroll', () => {
    if (!editing() && window.scrollY !== 0) window.scrollTo(0, 0);
  });
}

keepViewportSteady();

/*
 * GAS に貯まっているもの（カレンダーの予定・ショートカットが送った歩数）を
 * **1往復でまとめて**取り込む。未設定・圏外なら何もしない。
 * 期限が来ていないほうは、そもそも読みにいかない
 */
void import('./notify/gasSync').then((m) => m.syncFromGasIfConfigured());

// 圏外で溜まった送信を、起動時とオンライン復帰時に流す
const flush = () => void flushOutbox().catch(() => {});
window.addEventListener('online', flush);

/**
 * 起動画面を引く。
 *
 * 線を引き終わる前に消えると、何が出たのか分からないまま画面が変わる。
 * かといって毎回きっちり待たせると、2回目以降は邪魔なだけ。
 * 「演出が終わるまで」と「読み込みが終わるまで」の遅いほうに合わせる。
 */
/*
 * 線を引く 0.9秒（0.7秒から絵の下地が立ち上がる）→ キャッチコピー →
 * 1.5秒から絵の主役 → 2.12秒で名前 → 3.7秒で本体へ渡す。
 *
 * **全体を0.7秒短くした**（本人指定）。出す時刻も前へずらしてあるので、
 * 絵が見えている幅は 2.2秒ぶん残る。毎日開くものなので、
 * 演出のために待たせる時間は短いほどよい。
 */
const SPLASH_MIN_MS = 3700;

function dismissSplash(): void {
  const el = document.getElementById('pf-splash');
  if (!el) return;
  // performance.now() はページを開いた瞬間からの経過時間
  const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
  window.setTimeout(() => {
    el.classList.add('is-gone');
    window.setTimeout(() => el.remove(), 420);
  }, wait);
}

/**
 * **起動画面は、何があっても消す。**
 *
 * 消すのは初期化が終わったあと（`ensureSeeded().finally`）。
 * ところが初期化が**終わらない**ことがある——別のタブが古い版のまま開いていて、
 * スキーマの入れ替えを待っている、など。そのとき絵は出たまま止まり、
 * その裏に「開けません」と出しても**誰にも見えない**。
 *
 * 絵が消えれば、下にある案内（index.html の番人・App の待ちの画面）が見える。
 * 15秒は、演出（3.7秒）と初期化がどれだけ遅くても足りる長さ。
 */
window.setTimeout(dismissSplash, 15000);

/**
 * **別のタブが邪魔をしているときは、そう言う。**
 *
 * IndexedDB は、古い版を開いたままのタブがあるとスキーマを入れ替えられない。
 * Dexie は待ち続けるので、こちらからは「いつまでも終わらない」ようにしか見えない。
 * 待っている理由が分かれば、閉じるという手が打てる。
 */
db.on('blocked', () => {
  document.documentElement.dataset['pfBlocked'] = '1';
  dismissSplash();
});

// 初回起動時のみ既定設定と食材マスタを投入してから描画する
ensureSeeded().finally(() => {
  if (navigator.onLine) flush();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  dismissSplash();
});
