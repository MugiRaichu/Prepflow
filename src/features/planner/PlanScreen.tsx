import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Check, ChevronDown } from 'lucide-react';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { yen, formatDateJa, MEAL_SLOT_LABELS, todayIso } from '@/lib/labels';
import { commitWeek, proposeWeek } from './logic/generate';
import { WishBar } from './WishBar';
import { EMPTY_REQUEST } from './logic/request';
import { autoBackup } from '@/db/repositories/backup';
import { publishIfEnabled } from '@/calendar/gasCalendar';
import type { WeekRequest } from './logic/request';
import type { CookingMode, MealSlot, WeekPlan } from '@/db/schema';
import { cn } from '@/lib/utils';

/** 表示順。朝→昼→夕→間食 */
const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
import type { GenerateContext } from './logic/generate';
import type { WeekPlanCandidate } from './logic/types';
import { averageMacros, buildDailyMenus, portionMacros } from './logic/distribute';
import { perDayMinutes } from './logic/time';
import { addDaysIso } from '@/lib/labels';

/**
 * 週のプラン。生成は1タップで、選択肢は出さない（D-015）。
 * 気に入らなければ「別の案」で丸ごと差し替える。個別編集はさせない。
 */
export function PlanScreen() {
  const nav = useNavigate();
  const [cands, setCands] = useState<WeekPlanCandidate[] | null>(null);
  const [ctx, setCtx] = useState<GenerateContext | null>(null);
  const [rejections, setRejections] = useState<Record<string, number>>({});
  const [request, setRequest] = useState<WeekRequest>(EMPTY_REQUEST);
  const [relaxations, setRelaxations] = useState<string[]>([]);
  const [minFeasible, setMinFeasible] = useState<number | null>(null);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  const saved = useLiveQuery(
    () => db.weekPlans.where('deleted').equals(0).reverse().sortBy('weekStart'),
    [],
  );
  const current = saved?.[0];

  // 作り方によって時間の単位が変わるので、希望を入れる時点で知っておく
  const household = useLiveQuery(() => db.households.where('isCurrent').equals(1).toArray(), []);
  const mode: CookingMode = household?.[0]?.cooking.mode ?? 'batch';

  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  const today = todayIso();
  // 週の途中なら「今日から作り直す」を出す。始まる前なら普通に作り直せばよい
  const canReplan =
    Boolean(current && settings) &&
    today >= current!.weekStart &&
    today < addDaysIso(current!.weekStart, settings!.cooking.coverDays);
  const [replanFrom, setReplanFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 希望を変えた直後にも押せるよう、state ではなく引数で受け取る
  const generate = async (req: WeekRequest = request, from: string | null = replanFrom) => {
    setBusy(true);
    setError(null);
    try {
      setReplanFrom(from);
      const r = await proposeWeek(req, from ? { fromDate: from } : {});
      setCands(r.candidates);
      setCtx(r.ctx);
      setRejections(r.rejections);
      setRelaxations(r.relaxations);
      setMinFeasible(r.minFeasibleMinutes);
      setIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '作れませんでした');
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!cands || !ctx) return;
    setBusy(true);
    try {
      await commitWeek(cands[idx]!, ctx);
      // 節目で外に写しを取る。書き出し先が未設定なら何も起きない
      void autoBackup();
      // Google カレンダーへの書き出し。オフなら何もしない
      void publishIfEnabled();
      setCands(null);
      nav('/shopping');
    } finally {
      setBusy(false);
    }
  };

  const c = cands?.[idx];

  return (
    <div>
      <PageHeader
        title={mode === 'daily' ? '今週の献立' : '週のプラン'}
        action={
          cands && cands.length > 1 ? (
            <button
              onClick={() => setIdx((idx + 1) % cands.length)}
              className="flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-xs active:bg-accent"
            >
              <RefreshCw className="size-3.5" />
              別の案
            </button>
          ) : undefined
        }
      />

      <div className="space-y-4 p-4">
        <WishBar value={request} onChange={setRequest} mode={mode} />

        {relaxations.length > 0 && cands && cands.length > 0 && (
          <div className="rounded-lg border border-foreground/40 p-3">
            <div className="text-xs font-medium">希望どおりには組めなかったので、こう調整しました</div>
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
              {relaxations.map((r) => (
                <li key={r}>・{r}</li>
              ))}
            </ul>
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              アレルゲンと保存日数は緩めていません。
            </div>
          </div>
        )}

        {!cands && current && (
          <SavedPlanCard
            plan={current}
            onReplan={canReplan ? () => void generate(request, today) : undefined}
          />
        )}

        {error && <div className="rounded-lg border border-foreground/40 p-3 text-xs">{error}</div>}

        {!cands && (
          <EmptyState
            title={current ? '作り直しますか' : 'まだ献立がありません'}
            description={
              mode === 'daily'
                ? '1週間ぶんの買い物を1回で済ませるために、日ごとの献立を先に決めます。作るのは当日ぶんだけです。'
                : '予算と栄養を同時に満たす組合せを探します。'
            }
            action={
              <button
                onClick={() => generate()}
                disabled={busy}
                className="mt-1 inline-flex min-h-11 items-center rounded-md bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
              >
                {busy ? '計算中…' : '献立を作る'}
              </button>
            }
          />
        )}

        {cands && cands.length === 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="text-sm font-medium">条件を満たす組合せが見つかりませんでした</div>

            {/* 時短が原因なら「では何分なら組めるのか」を数字で出し、1タップで通す。
                「時間を増やしてください」だけでは、いくつにすればよいか分からない */}
            {request.timeCapMinutes != null &&
              minFeasible != null &&
              minFeasible > request.timeCapMinutes && (
                <div className="space-y-2 rounded-md border border-foreground/40 p-3">
                  <div className="text-xs leading-relaxed">
                    {mode === 'daily' ? '1日' : 'まとめて'}
                    {request.timeCapMinutes}分では、栄養と予算が同時に合いません。
                    <span className="font-medium">
                      {Math.ceil(minFeasible)}分なら組めます。
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      const next = {
                        ...request,
                        timeCapMinutes: Math.ceil(minFeasible),
                      };
                      setRequest(next);
                      void generate(next);
                    }}
                    disabled={busy}
                    className="min-h-10 w-full rounded-md bg-foreground text-xs font-medium text-background disabled:opacity-50"
                  >
                    {Math.ceil(minFeasible)}分で作る
                  </button>
                </div>
              )}

            {/* 件数は出さない。「品数が上限を超える: 12891816 件」は探索の内部事情で、
                読んでも行動が変わらない（D-053）。効く順に上位2つだけ言葉で出す */}
            <div className="space-y-1 text-xs text-muted-foreground">
              {topReasons(rejections).map((r) => (
                <div key={r}>・{r}</div>
              ))}
            </div>
          </div>
        )}

        {c && ctx && (
          <CandidateView
            c={c}
            ctx={ctx}
            index={idx}
            total={cands!.length}
          />
        )}

        {cands && (
          <div className="space-y-2">
            {c && (
              <button
                onClick={accept}
                disabled={busy}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-semibold text-background disabled:opacity-50"
              >
                <Check className="size-4" />
                この案にする
              </button>
            )}
            <button
              onClick={() => generate()}
              disabled={busy}
              className="min-h-11 w-full rounded-lg border text-sm active:bg-accent disabled:opacity-50"
            >
              {busy ? '計算中…' : 'この希望で作り直す'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 詰まった理由のうち、利用者が動かせるものだけを言葉にする。
 *
 * 件数は出さない。探索の内部事情であって、読んでも次の行動が決まらない。
 * 「品数が上限を超える」のような、こちらが勝手に決めた上限も出さない
 * （緩和ラダーが自動で広げるので、利用者が触る対象ではない）。
 */
const ACTIONABLE: Record<string, string> = {
  予算を超える: '予算では足りません。設定で予算を上げてください',
  調理時間が足りない: '調理時間が足りません。上限を延ばしてください',
  '1日の調理時間に収まらない': '1日の調理時間に収まりません。上限を延ばしてください',
  今週の希望に届かない: '今週の希望が厳しすぎます。日数を減らしてください',
  今週は避けたい食材: '「避けたい」を外すと組めるかもしれません',
  保存日数が足りない: '保存日数の条件に合うレシピがありません',
  'アレルゲン・除外食材': '除外した食材が多く、使えるレシピが残っていません',
  レシピが足りない: 'レシピが足りません',
};

function topReasons(rejections: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [key] of Object.entries(rejections).sort((a, b) => b[1] - a[1])) {
    const text = ACTIONABLE[key];
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= 2) break;
  }
  return out.length > 0 ? out : ['希望を減らすか、予算か調理時間を増やしてください'];
}

/**
 * 保存済みの献立。
 *
 * 以前は「作成済みのプランがあります」と書いてあるだけで、押しても何も起きなかった。
 * 作った本人が中身を見返せないのは、作っていないのとほとんど変わらない。
 * 保存済みの日別メニュー（plannedMeals）をそのまま開く。
 */
function SavedPlanCard({ plan, onReplan }: { plan: WeekPlan; onReplan?: () => void }) {
  const [open, setOpen] = useState(false);
  const meals = useLiveQuery(
    async () =>
      (await db.plannedMeals.where('weekPlanId').equals(plan.id).toArray()).sort(
        (a, b) => a.date.localeCompare(b.date) || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot],
      ),
    [plan.id],
  );

  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 p-4 text-left active:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">
            {formatDateJa(plan.weekStart)} から
          </div>
          <div className="mt-1 text-lg font-semibold">いまの献立</div>
          <div className="mt-1 text-xs tabular-nums text-muted-foreground">
            見込み {yen(plan.estimatedCostYen)} / 予算 {yen(plan.budgetYen)}
          </div>
        </div>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t p-4">
          {(meals ?? []).map((m) => (
            <div key={m.id} className="flex gap-3">
              <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                {formatDateJa(m.date).replace(/（.）/, '')} {MEAL_SLOT_LABELS[m.slot]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-snug">
                  {m.items.map((i) => i.recipeTitle).join(' + ')}
                </div>
                <div className="text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(m.nutrition.kcal)} kcal ・ P {Math.round(m.nutrition.proteinG)}g
                </div>
              </div>
            </div>
          ))}
          {meals?.length === 0 && (
            <div className="text-xs text-muted-foreground">日ごとの内訳が保存されていません。</div>
          )}
        </div>
      )}

      {/* 週の途中の変更。作って詰めた日は残し、それ以外の今日以降を組み直す。
          家にある食材を優先するので、今週の余りが次の献立に回る */}
      {onReplan && (
        <div className="border-t p-3">
          <button
            onClick={onReplan}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border text-sm active:bg-accent"
          >
            <RefreshCw className="size-3.5" />
            今日から作り直す
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateView({
  c,
  ctx,
  index,
  total,
}: {
  c: WeekPlanCandidate;
  ctx: GenerateContext;
  index: number;
  total: number;
}) {
  // 表示は「実際に容器へ詰める中身」から計算する。
  // ソルバーの見積りと日別配分がずれたとき、画面に出す数字は後者が正しい
  const menus = buildDailyMenus(
    c.mains,
    c.sides,
    c.ricePlan,
    c.riceServings,
    ctx.meals,
    ctx.target.kcal,
    ctx.maxSameDishMeals,
  );
  const actual = averageMacros(menus);

  const rows: { label: string; a: number; t: number; unit: string }[] = [
    { label: 'カロリー', a: actual.kcal, t: ctx.target.kcal, unit: 'kcal' },
    { label: 'たんぱく質', a: actual.proteinG, t: ctx.target.proteinG, unit: 'g' },
    { label: '脂質', a: actual.fatG, t: ctx.target.fatG, unit: 'g' },
    { label: '炭水化物', a: actual.carbG, t: ctx.target.carbG, unit: 'g' },
  ];

  return (
    <div key={index} className="pf-rise space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-muted-foreground">
          {formatDateJa(ctx.weekStart)} から {ctx.meals} 食分{ctx.replan ? 'を作り直し' : ''}
        </div>
        <div className="text-[10px] tabular-nums text-muted-foreground">
          案 {index + 1} / {total}
        </div>
      </div>

      {/* 何を残し、何を使っているかを先に言う。数字の前に前提を置く */}
      {(ctx.replan || ctx.inventoryCoveredYen > 0) && (
        <div className="space-y-0.5 rounded-lg border p-3 text-xs leading-relaxed">
          {ctx.replan && ctx.replan.lockedDates.length > 0 && (
            <div>
              {ctx.replan.lockedDates.map((d) => formatDateJa(d).replace(/（.）/, '')).join('・')}{' '}
              は作ったぶんをそのまま食べます
            </div>
          )}
          {ctx.inventoryCoveredYen > 0 && (
            <div className="text-muted-foreground">
              家にある食材（約{yen(ctx.inventoryCoveredYen)}ぶん）を優先して組んでいます
            </div>
          )}
        </div>
      )}

      {ctx.freezeFromDay != null && (
        <div className="rounded-lg border border-foreground/40 p-3 text-xs leading-relaxed">
          <span className="font-medium">
            {ctx.freezeFromDay + 1} 日目以降のぶんは冷凍してください
          </span>
          <span className="block text-muted-foreground">
            作った日に冷凍し、食べる前日に冷蔵へ移してください。
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="見込み" value={yen(c.estimatedCostYen)} />
        {ctx.mode === 'daily' ? (
          <Stat
            label="1日あたり"
            value={Math.round(perDayMinutes(c.handsOnMinutes, ctx.cookDays)) + '分'}
          />
        ) : (
          <Stat label="手を動かす" value={c.handsOnMinutes + '分'} />
        )}
        <Stat
          label={ctx.mode === 'daily' ? '合計' : 'のべ時間'}
          value={(ctx.mode === 'daily' ? c.handsOnMinutes : c.rawMinutes) + '分'}
        />
      </div>

      <div className="rounded-lg border p-4">
        <div className="mb-3 text-xs text-muted-foreground">1食あたり（目標との差）</div>
        <div className="space-y-2">
          {rows.map((r) => {
            const pct = r.t > 0 ? r.a / r.t : 0;
            const off = Math.round((pct - 1) * 100);
            return (
              <div key={r.label} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{r.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-foreground"
                    style={{ width: Math.min(pct * 100, 100) + '%' }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums">
                  {Math.round(r.a)}
                  <span className="text-muted-foreground">
                    /{Math.round(r.t)} {off > 0 ? '+' : ''}
                    {off}%
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <DailyMenu menus={menus} ctx={ctx} />

      <DishList title="主菜" items={c.mains} meals={ctx.meals} />
      <DishList title="副菜" items={c.sides} meals={ctx.meals} />
      {c.ricePlan && (
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">主食</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-sm font-medium">{c.ricePlan.recipe.title}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              1食 {c.riceServings} 人前
            </span>
          </div>
        </div>
      )}

      {c.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {c.notes.map((n) => (
            <li key={n}>・{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DishList({
  title,
  items,
  meals,
}: {
  title: string;
  items: WeekPlanCandidate['mains'];
  meals: number;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 text-xs text-muted-foreground">{title}</div>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.recipe.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{it.recipe.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {it.batches > 1 ? it.batches + '回分 ' : ''}
                {Math.round((it.totalServings / meals) * 10) / 10} 人前/食
              </span>
            </div>
            {it.recipe.summary && (
              <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                {it.recipe.summary}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 日ごとの内訳。同じ物を5日食べるのか日替わりなのかは、
 * 献立を受け入れるかどうかの判断に直結するので、確定前に必ず見せる。
 */
function DailyMenu({
  menus,
  ctx,
}: {
  menus: ReturnType<typeof buildDailyMenus>;
  ctx: GenerateContext;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 text-xs text-muted-foreground">日ごとの内訳</div>
      <div className="space-y-3">
        {menus.map((portions, i) => {
          const n = portionMacros(portions);
          // 朝昼晩をカバーすると1日に複数の枠が入る。日付は枠数で割って出す
          const slots = Math.max(ctx.slots.length, 1);
          const dayIndex = Math.floor(i / slots);
          const slot = ctx.slots[i % slots];
          return (
            <div key={i} className="flex gap-3">
              <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                {formatDateJa(addDaysIso(ctx.weekStart, dayIndex)).replace(/（.）/, '')}
                {slots > 1 && slot ? ' ' + MEAL_SLOT_LABELS[slot] : ''}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-snug">
                  {portions.map((p) => p.recipe.title).join(' + ')}
                </div>
                <div className="text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(n.kcal)} kcal ・ P {Math.round(n.proteinG)}g
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
