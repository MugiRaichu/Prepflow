import { NavLink, Outlet } from 'react-router-dom';
import { LayoutGrid, CalendarDays, ShoppingCart, Flame, Settings } from 'lucide-react';
import { Logo } from './Logo';
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

/** モバイル前提の外枠。上にロゴ、下にタブバー。中身は Outlet */
export function AppShell() {
  const daily = useCookingMode() === 'daily';
  const nav = navFor(daily);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <Logo />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <nav className="grid shrink-0 grid-cols-5 border-t">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px]',
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
