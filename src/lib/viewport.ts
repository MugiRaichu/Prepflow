/**
 * 外枠を、実際に見えている範囲に合わせ続ける。
 *
 * 下端・上端を隠しうるものは3つある。
 *
 * 1. **ブラウザのバー。** iOS のバーは画面の下にある。`position: fixed` の
 *    `bottom: 0` はレイアウトの下端に付くが、レイアウトはバーの裏まで伸びて
 *    いるので、そのままではタブバーがバーの下に潜る
 * 2. **ソフトキーボード。** 画面に重なるだけでレイアウトの高さを変えない
 * 3. **ノッチ・Dynamic Island・ホームバー。** `env(safe-area-inset-*)` の担当
 *
 * ここで測るのは1と2、そして**3が二重になっていないか**。
 *
 * iPhone 17（ホーム画面から起動）で実測すると、
 *   画面 874 / アプリの領域 812 / セーフエリア上 62
 * つまり **アプリの領域はすでに Dynamic Island の下から始まっている**のに、
 * `env(safe-area-inset-top)` は 62 を返す。そのまま余白にすると、
 * 使えるはずの 62px を二重に空けることになる。
 *
 * 画面とアプリの領域の差（＝すでに避けられている量）を測って、
 * セーフエリアから差し引く。
 */

/** env(safe-area-inset-*) の実効値。CSS からは読めないので要素を置いて測る */
function measureInset(side: 'top' | 'bottom'): number {
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;width:1px;pointer-events:none;visibility:hidden;' +
      (side === 'bottom'
        ? 'bottom:0;height:env(safe-area-inset-bottom);'
        : 'top:0;height:env(safe-area-inset-top);');
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return Math.round(h);
  } catch {
    return 0;
  }
}

export function trackViewportInsets(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;

  const set = () => {
    // ピンチで拡大している間は visualViewport が縮む。ここで追従すると
    // 拡大するたびに画面が作り直されるので、拡大中は触らない
    if (vv && vv.scale > 1.01) return;

    // ブラウザのバーとキーボード。この2つは同じ1つの数字になる
    const hidden = vv ? window.innerHeight - vv.height - vv.offsetTop : 0;
    const bottom = Math.max(0, Math.round(hidden));
    root.style.setProperty('--app-bottom', bottom + 'px');

    /*
     * 画面のうち、アプリの領域になっていない量。
     * ホーム画面から起動した iPhone では、ここに Dynamic Island ぶんが入る。
     * すでに避けられているので、セーフエリアの余白から差し引く。
     *
     * 縦向き固定なので screen.height と比べてよい。
     * 想定外の値（横向き・分割表示）は無視する
     */
    const screenH = window.screen?.height ?? 0;
    const offscreen = screenH > 0 ? screenH - window.innerHeight - bottom : 0;
    const already = offscreen > 0 && offscreen < 200 ? Math.round(offscreen) : 0;

    const padTop = Math.max(0, measureInset('top') - already);
    root.style.setProperty('--app-pad-top', padTop + 'px');
  };

  set();
  vv?.addEventListener('resize', set);
  vv?.addEventListener('scroll', set);
  window.addEventListener('resize', set);
  // 回転は描画が落ち着いてからでないと古い値を拾う
  window.addEventListener('orientationchange', () => window.setTimeout(set, 250));
}
