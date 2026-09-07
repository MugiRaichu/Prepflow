import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight, User, Flame, Box, ShoppingCart, Bell, Clock, Home, Database, BookOpen, Package, Wrench, Boxes, Activity, Search, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { db } from '@/db/db';
import { listAskableStock } from '@/db/repositories/inventory';
import { PageHeader } from '@/components/shared/PageHeader';
import { WEEKDAY_LABELS, yen } from '@/lib/labels';
import { searchSettings } from './catalog';

type Row = { to: string; icon: LucideIcon; label: string; value: string };

/**
 * 設定のトップ。各項目の「今の値」を出して、開かなくても分かるようにする。
 *
 * 4つに束ねる。並びは「使う頻度」ではなく「考える順番」。
 *   自分のこと → 作ると買う → 材料 → アプリ
 * 12行を平らに並べると、探すのに全部を読むことになる。
 */
export function SettingsHome() {
  const [query, setQuery] = useState('');
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
  const health = useLiveQuery(() => db.activitySamples.count(), []);
  // 開いた先に並ぶものと同じ数を出す。調味料は棚卸しに出ないので数にも入れない
  const stock = useLiveQuery(async () => (await listAskableStock()).length, []);
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
        {
          // ふだんは献立を作る直前に出るが、気づいたときに1品だけ直したい人はここから
          to: '/stock',
          icon: Boxes,
          label: '家にあるもの',
          value: stock != null ? stock + ' 品' : '',
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
        {
          to: '/settings/health',
          icon: Activity,
          label: 'ヘルスケア連携',
          value: health ? health + ' 日ぶん' : '未設定',
        },
        { to: '/settings/data', icon: Database, label: 'データの保存', value: '書き出し・戻す' },
      ],
    },
  ];

  const hits = searchSettings(query);

  return (
    <div className="pb-6">
      <PageHeader title="設定" />

      {/*
        名前で引く。**画面名を覚えていなくても辿り着けるようにする。**

        入口は13行だが、触れる項目は30以上あり、画面名の下や
        `細かい設定` の中に入っている。「賞味期限はどこ？」と思ったとき、
        「作り方」を開くという発想にはならない（本人指摘）。
      */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 rounded-md border px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="設定を名前で探す（例: 賞味期限）"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="shrink-0 p-1 text-muted-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {query.trim() ? (
        <div className="p-4 pt-3">
          {hits.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              見つかりませんでした。下の一覧から探してください。
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {hits.map((h) => (
                <Link
                  key={h.label}
                  to={h.to}
                  onClick={() => setQuery('')}
                  className="pf-press flex min-h-14 items-center gap-3 px-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{h.label}</span>
                    {/* 行き先を必ず出す。次からは検索せずに辿り着けるようにする */}
                    <span className="block text-[10px] text-muted-foreground">
                      設定 › {h.where}
                      {h.folded && ' ›「細かい設定」を開く'}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}

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
