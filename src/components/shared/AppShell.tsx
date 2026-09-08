import { NavLink, Outlet } from 'react-router-dom';
import { LayoutGrid, CalendarDays, ShoppingCart, Flame, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 下のタブ。
 *
 * 名前は**一通りにしか読めない言葉**にする。
 * 「週」は週の何なのか分からず、「作り置き」は作る行為とできた品の
 * どちらにも取れた（実際そこに一覧を入れたので、なおさら）。
 *
 * **作り方で名前を変えるのもやめた。**まとめて作る人には「作り置き」、
 * 毎日作る人には「今日作る」と出し分けていたが、同じ場所が呼び名を
 * 変えると、覚えたことが崩れる。中身の違いは画面の中で言えば足りる。
 */
const NAV = [
  { to: '/dashboard', label: '今日', icon: LayoutGrid },
  { to: '/plan', label: 'こんだて', icon: CalendarDays },
  { to: '/shopping', label: '買い出し', icon: ShoppingCart },
  { to: '/cook', label: 'つくる', icon: Flame },
  { to: '/settings', label: '設定', icon: Settings },
] as const;

/**
 * モバイル前提の外枠。下にタブバー、中身は Outlet。
 *
 * **上のロゴ帯は置かない。**どの画面にも自分の見出し（PageHeader）があり、
 * その上にロゴを重ねても、いま何の画面かは1文字も増えない。
 * 縦48pxはスマホでは大きく、献立や手順がそのぶん削られていた。
 * ロゴは起動画面で見せている。
 */
export function AppShell() {
  const nav = NAV;

  return (
    /* 地色は body が持つ。**ここで塗ると背景の透かしを覆ってしまう** */
    <div className="pf-shell relative flex flex-col text-foreground">
      {/* タブバーが本文の上に浮くので、最後の行が隠れないぶんだけ下を空ける */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
        <Outlet />
      </main>

      {/*
        画面の下端に貼り付けた帯ではなく、少し浮かせた角丸のバーにする。
        背景は半透明＋ぼかしで、下を通っていく本文がうっすら見える。
        位置と質感の指定は .pf-tabbar（src/index.css）。
      */}
      <nav className="pf-tabbar grid grid-cols-5">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              )
            }
          >
            <Icon className="size-5" strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
