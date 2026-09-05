import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight, User, Flame, Box, ShoppingCart, Bell, Clock, Home, Database, BookOpen, Package, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { WEEKDAY_LABELS, yen } from '@/lib/labels';

type Row = { to: string; icon: LucideIcon; label: string; value: string };

/**
 * 設定のトップ。各項目の「今の値」を出して、開かなくても分かるようにする。
 *
 * 4つに束ねる。並びは「使う頻度」ではなく「考える順番」。
 *   自分のこと → 作ると買う → 材料 → アプリ
 * 12行を平らに並べると、探すのに全部を読むことになる。
 */
export function SettingsHome() {
  const profiles = useLiveQuery(() => db.profiles.where('deleted').equals(0).toArray(), []);
  const equipment = useLiveQuery(() => db.equipment.where('deleted').equals(0).toArray(), []);
  const containers = useLiveQuery(() => db.containers.where('deleted').equals(0).toArray(), []);
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  const recipes = useLiveQuery(async () => {
    const all = await db.recipes.toArray();
    return {
      active: all.filter((r) => r.deleted === 0).length,
      mine: all.filter((r) => r.source !== 'builtin').length,
    };
  }, []);
  const ingredients = useLiveQuery(() => db.ingredients.where('deleted').equals(0).count(), []);
  const household = useLiveQuery(
    async () => (await db.households.where('isCurrent').equals(1).toArray())[0],
    [],
  );

  const containerCount = (containers ?? []).reduce((n, c) => n + c.count, 0);

  const groups: { title: string; rows: Row[] }[] = [
    {
      title: '自分のこと',
      rows: [
        {
          to: '/settings/profiles',
          icon: User,
          label: '食べる人',
          value: (profiles ?? []).map((p) => p.name).join('、') || '未設定',
        },
        { to: '/household', icon: Home, label: 'いまの暮らし', value: household?.name ?? '未設定' },
        {
          to: '/rhythm',
          icon: Clock,
          label: '1日の流れ',
          value: settings
            ? settings.rhythm.wakeTime + ' 起床 / ' + settings.rhythm.sleepTime + ' 就寝'
            : '',
        },
      ],
    },
    {
      title: '作ると買う',
      rows: [
        {
          to: '/settings/cooking',
          icon: Flame,
          label: '作り方',
          value: settings
            ? '週' + (settings.cooking.cookSessionsPerWeek ?? 1) + '回・' + settings.cooking.coverDays + '日分'
            : '',
        },
        {
          to: '/settings/shopping',
          icon: ShoppingCart,
          label: '買い物と予算',
          value: settings
            ? yen(settings.shopping.weeklyBudgetYen) +
              ' / 週・' +
              WEEKDAY_LABELS[settings.shopping.shoppingDay] +
              '曜'
            : '',
        },
        {
          to: '/settings/equipment',
          icon: Wrench,
          label: '調理器具',
          value: equipment?.length ? equipment.length + ' 種類' : '未設定',
        },
        {
          to: '/settings/containers',
          icon: Box,
          label: '保存容器',
          value: containerCount ? containerCount + ' 個' : '未設定',
        },
      ],
    },
    {
      title: '材料',
      rows: [
        {
          to: '/recipes',
          icon: BookOpen,
          label: 'レシピ',
          value: recipes
            ? recipes.active + ' 品' + (recipes.mine ? '（自作 ' + recipes.mine + '）' : '')
            : '',
        },
        {
          to: '/settings/ingredients',
          icon: Package,
          label: '食材・プロテイン',
          value: ingredients ? ingredients + ' 品' : '',
        },
      ],
    },
    {
      title: 'アプリ',
      rows: [
        {
          to: '/settings/notify',
          icon: Bell,
          label: 'LINE・カレンダー',
          value: settings
            ? [settings.notify.lineEnabled ? 'LINE' : '', settings.calendar.enabled ? 'カレンダー' : '']
                .filter(Boolean)
                .join('・') || 'オフ'
            : '',
        },
        { to: '/settings/data', icon: Database, label: 'データの保存', value: '書き出し・戻す' },
      ],
    },
  ];

  return (
    <div className="pb-6">
      <PageHeader title="設定" />
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="px-4 pb-1 pt-5 text-[11px] font-medium text-muted-foreground">{g.title}</h2>
          <div className="divide-y border-y">
            {g.rows.map((r) => (
              <Link key={r.to} to={r.to} className="pf-press flex min-h-14 items-center gap-3 px-4">
                <r.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="shrink-0 text-sm">{r.label}</span>
                <span className="flex-1 truncate text-right text-xs text-muted-foreground">
                  {r.value}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
