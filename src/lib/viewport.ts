/**
 * 画面の「実際に見えている高さ」を CSS 変数 `--app-h` に流し込む。
 *
 * スマホでタブバーが消える原因は2つあって、どちらも `100dvh` では防げない。
 *
 * 1. アドレスバーの出し入れ。`dvh` は畳んだ状態の高さなので、
 *    バーが出ている間は画面からはみ出し、下端のタブが隠れる。
 * 2. ソフトキーボード。Android の既定ではキーボードは画面に**重なる**だけで
 *    `dvh` は変わらない。レシピ名を打った瞬間にタブがキーボードの下に潜る。
 *
 * visualViewport は「いま実際に見えている領域」を返すので、両方まとめて解ける。
 * 外枠を `position: fixed` にして高さをこれに合わせると、タブは常に見える位置に残る。
 */
export function trackViewportHeight(): void {
  const vv = window.visualViewport;

  const set = () => {
    // ピンチで拡大している間は visualViewport が縮む。ここで追従すると
    // 拡大するたびに画面が作り直されるので、拡大中は触らない
    if (vv && vv.scale > 1.01) return;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  };

  set();
  vv?.addEventListener('resize', set);
  vv?.addEventListener('scroll', set);
  window.addEventListener('resize', set);
  // 回転は描画が落ち着いてからでないと古い値を拾う
  window.addEventListener('orientationchange', () => window.setTimeout(set, 250));
}
