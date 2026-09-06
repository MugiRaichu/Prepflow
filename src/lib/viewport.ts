/**
 * 外枠を「いま実際に見えている範囲」に合わせる。
 *
 * スマホでタブバーが下端に合わない原因は3つあって、どれも CSS だけでは解けない。
 *
 * 1. ブラウザのバー。iOS Safari のバーは**下**にあり、`position: fixed` の
 *    `bottom: 0` はその裏に潜る。Android は上なので事情が逆になる
 * 2. ソフトキーボード。Android の既定ではキーボードは画面に**重なる**だけで
 *    レイアウトの高さは変わらない。何もしなければタブはキーボードの下に潜る
 * 3. ホームバー・ジェスチャーバー。これは `env(safe-area-inset-bottom)` の担当で、
 *    JS からは見えない。CSS 側で余白として足す
 *
 * 1と2は「レイアウトの高さのうち、下から何 px が見えていないか」という
 * 同じ1つの数字に還元できる。それを測って `--app-bottom` に入れる。
 *
 * 高さそのもの（`--app-h`）ではなく上下の位置で持つのは、高さで持つと
 * `env(safe-area-inset-bottom)` と二重に引かれて、タブの下に空きができるため。
 */
export function trackViewportInsets(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;

  const set = () => {
    // ピンチで拡大している間は visualViewport が縮む。ここで追従すると
    // 拡大するたびに画面が作り直されるので、拡大中は触らない
    if (vv && vv.scale > 1.01) return;

    const top = vv ? Math.max(0, vv.offsetTop) : 0;
    // レイアウトの高さから、見えている範囲を引く。
    // ブラウザのバーもキーボードも、この1つの数字に化ける
    const bottom = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;

    root.style.setProperty('--app-top', Math.round(top) + 'px');
    root.style.setProperty('--app-bottom', Math.round(bottom) + 'px');
  };

  set();
  vv?.addEventListener('resize', set);
  vv?.addEventListener('scroll', set);
  window.addEventListener('resize', set);
  // 回転は描画が落ち着いてからでないと古い値を拾う
  window.addEventListener('orientationchange', () => window.setTimeout(set, 250));
}
