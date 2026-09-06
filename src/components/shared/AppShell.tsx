import { NavLink, Outlet } from 'react-router-dom';
import { LayoutGrid, CalendarDays, ShoppingCart, Flame, Settings } from 'lucide-react';
import { useCookingMode } from '@/features/household/useCookingMode';
import { cn } from '@/lib/utils';

/**
 * タブの名前は暮らしに合わせて変える。
 *
 * まとめて作る人にとって /cook は「週に1回の作り置き」だが、
 * 毎日作る人にとっては「今日の料理」で、意味も頻度も違う。
 * 中身が違うものに同じ名前を付けない。
 */
const navFor = (daily: boolean) =>
  [
    { to: '/dashboard', label: '今日', icon: LayoutGrid },
    { to: '/plan', label: daily ? '献立' : '週', icon: CalendarDays },
    { to: '/shopping', label: '買い出し', icon: ShoppingCart },
    { to: '/cook', label: daily ? '今日作る' : '作り置き', icon: Flame },
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
  const daily = useCookingMode() === 'daily';
  const nav = navFor(daily);

  return (
    <div className="pf-shell relative flex flex-col bg-background text-foreground">
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
                'flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px]',
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
