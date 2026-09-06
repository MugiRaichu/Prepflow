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
    <div className="pf-shell flex flex-col bg-background text-foreground">
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </main>

      {/*
        外枠の高さを実測に合わせているので、ここは常に画面の一番下に残る。
        スクロールでもキーボードでも隠れない（D-099）。

        背景を1段明るくしているのは、**バーがどこまであるのかを見せるため**。
        真っ黒のままだと、ホームバーぶんの余白（iPhone で34px）が
        ただの空白に見えて、バーが浮いているように読める。
      */}
      <nav className="pf-safe-bottom grid shrink-0 grid-cols-5 border-t bg-card">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 text-[10px]',
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
