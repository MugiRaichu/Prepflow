/**
 * 外枠の下端を、実際に見えている下端に合わせ続ける。
 *
 * 下端を隠しうるものは3つある。
 *
 * 1. **ブラウザのバー。** iOS のバーは画面の下にある。`position: fixed` の
 *    `bottom: 0` はレイアウトの下端に付くが、レイアウトはバーの裏まで伸びて
 *    いるので、そのままではタブバーがバーの下に潜る
 * 2. **ソフトキーボード。** 画面に重なるだけでレイアウトの高さを変えない
 * 3. **ホームバー・ノッチ。** これは CSS の `env(safe-area-inset-*)` の担当で、
 *    JS からは見えない
 *
 * 1と2は「レイアウトの高さのうち、下から何 px が見えていないか」という
 * 同じ1つの数字になる。それを測って `--app-bottom` に入れる。
 *
 * 3と足し算にならないよう、CSS 側では
 * `max(0px, calc(env(safe-area-inset-bottom) - var(--app-bottom)))` を使う。
 * ブラウザのバーが出ている間はホームバーもそのバーの裏なので、
 * 両方引くと二重になる。
 */
export function trackViewportInsets(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;

  const set = () => {
    // ピンチで拡大している間は visualViewport が縮む。ここで追従すると
    // 拡大するたびに画面が作り直されるので、拡大中は触らない
    if (vv && vv.scale > 1.01) return;

    const hidden = vv ? window.innerHeight - vv.height - vv.offsetTop : 0;
    root.style.setProperty('--app-bottom', Math.max(0, Math.round(hidden)) + 'px');
  };

  set();
  vv?.addEventListener('resize', set);
  vv?.addEventListener('scroll', set);
  window.addEventListener('resize', set);
  // 回転は描画が落ち着いてからでないと古い値を拾う
  window.addEventListener('orientationchange', () => window.setTimeout(set, 250));
}
