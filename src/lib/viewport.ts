/**
 * 外枠の下端を、画面の下端に合わせ続ける。
 *
 * 素の `position: fixed; bottom: 0` で正しく下端に付く。**ずれる原因は1つだけ**で、
 * ソフトキーボードが画面に重なったときに、タブバーがその下に潜ることだった。
 * Android の既定ではキーボードはレイアウトの高さを変えずに重なるだけなので、
 * CSS からはキーボードの存在が見えない。
 *
 * 以前はここで「レイアウトの高さ − 見えている高さ」を常に下端の余白にしていた。
 * だが、この差は端末やブラウザによって、キーボードが出ていないときでも
 * 数十 px ずれて報告される（システムバーの扱いや丸めの差）。
 * その差をそのまま余白にすると、**タブバーが画面の下端から浮く**。
 *
 * なので、持ち上げるのはキーボードが出ているときだけにする。
 * それ以外は 0 にして、素直に下端へ付ける。
 */

/**
 * これを超える隠れ方をしていたらキーボードとみなす。
 * ブラウザのバーやシステムバーはこれより小さく、キーボードはこれより大きい。
 */
const KEYBOARD_MIN_PX = 150;

export function trackViewportInsets(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;

  const set = () => {
    // ピンチで拡大している間は visualViewport が縮む。ここで追従すると
    // 拡大するたびに画面が作り直されるので、拡大中は触らない
    if (vv && vv.scale > 1.01) return;

    const hidden = vv ? window.innerHeight - vv.height - vv.offsetTop : 0;
    const bottom = hidden > KEYBOARD_MIN_PX ? Math.round(hidden) : 0;

    root.style.setProperty('--app-bottom', bottom + 'px');
  };

  set();
  vv?.addEventListener('resize', set);
  vv?.addEventListener('scroll', set);
  window.addEventListener('resize', set);
  // 回転は描画が落ち着いてからでないと古い値を拾う
  window.addEventListener('orientationchange', () => window.setTimeout(set, 250));
}
