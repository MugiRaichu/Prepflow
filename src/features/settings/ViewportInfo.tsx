import { useEffect, useState } from 'react';

/**
 * この端末で、画面のどこまでがアプリの領域になっているか。
 *
 * タブバーが下端に合わない、という不具合の原因は端末とブラウザで違う。
 * レイアウトの高さ・見えている高さ・セーフエリア・表示モードの4つが分かれば、
 * どれがずれているのかが一意に決まる。推測で直すより速い。
 *
 * サポート用だが、置きっぱなしにして困るものでもない（数字を出すだけ）。
 */
interface Info {
  screen: string;
  layout: string;
  visual: string;
  safeTop: number;
  safeBottom: number;
  mode: string;
  navGap: number;
  dpr: number;
}

/** env(safe-area-inset-*) の実効値を測る。CSS からは読めないので要素を置いて測る */
function measureInset(side: 'top' | 'bottom'): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;width:1px;pointer-events:none;visibility:hidden;' +
    (side === 'bottom' ? 'bottom:0;height:env(safe-area-inset-bottom);' : 'top:0;height:env(safe-area-inset-top);');
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(h);
}

function read(): Info {
  const vv = window.visualViewport;
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'browser'];
  const mode = modes.find((m) => window.matchMedia('(display-mode: ' + m + ')').matches) ?? '不明';
  const nav = document.querySelector('nav');
  const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
  return {
    screen: window.screen.width + '×' + window.screen.height,
    layout: window.innerWidth + '×' + window.innerHeight,
    visual: vv ? Math.round(vv.width) + '×' + Math.round(vv.height) : '—',
    safeTop: measureInset('top'),
    safeBottom: measureInset('bottom'),
    mode,
    navGap: nav ? Math.round(window.innerHeight - navBottom) : -1,
    dpr: window.devicePixelRatio,
  };
}

export function ViewportInfo() {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    setInfo(read());
    const update = () => setInfo(read());
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  if (!info) return null;

  const rows: [string, string][] = [
    ['表示モード', info.mode],
    ['画面', info.screen + '（×' + info.dpr + '）'],
    ['アプリの領域', info.layout],
    ['見えている範囲', info.visual],
    ['セーフエリア 上/下', info.safeTop + ' / ' + info.safeBottom],
    ['タブバーの下の余り', info.navGap + 'px'],
  ];

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">表示領域</div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        タブバーの位置がずれるときに、原因を切り分けるための数字です。
      </p>
      <div className="divide-y rounded-lg border text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-muted-foreground">{k}</span>
            <span className="tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
