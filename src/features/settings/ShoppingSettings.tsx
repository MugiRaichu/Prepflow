import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { Chips, MultiChips } from '@/components/shared/Chips';
import { Stepper } from '@/components/shared/Stepper';
import { WeekdayPicker } from '@/components/shared/WeekdayPicker';
import { updateCooking, updateShopping } from '@/db/repositories/settings';
import { getDefaultStore, setPriceBand, reliabilityOf } from '@/db/repositories/stores';
import { cadenceLabel } from '@/features/planner/logic/cadence';
import { BUDGET_OPTIONS } from '@/features/onboarding/options';
import { MEAL_SLOT_LABELS, sortSlots } from '@/lib/labels';
import type { MealSlot, PriceBand, Weekday } from '@/db/schema';

/**
 * 買い物と予算。**買い物に関わることだけ**を置く。
 *
 * 以前は作り方の設定も同じ画面にあり、10項目が縦に並んでいた。
 * 買い物の話と作り方の話は考えるタイミングが違うので、画面を分けた（→ CookingSettings）。
 */
export function ShoppingSettings() {
  const s = useLiveQuery(() => db.settings.get('singleton'), []);
  if (!s) return null;

  return (
    <div>
      <PageHeader title="買い物と予算" backTo="/settings" />
      <div className="space-y-6 p-4">
        <Labeled label="1週間の食費">
          <Chips
            options={BUDGET_OPTIONS}
            value={s.shopping.weeklyBudgetYen}
            onChange={(v) => updateShopping(() => ({ weeklyBudgetYen: v }))}
            columns={3}
          />
        </Labeled>

        <Labeled label="買い出しの曜日">
          <WeekdayPicker
            value={s.shopping.shoppingDay}
            onChange={(v: Weekday) => updateShopping(() => ({ shoppingDay: v }))}
          />
        </Labeled>

        <StoreSetting />
      </div>
    </div>
  );
}

/**
 * 作り方。目に入る順に「何回」「何日分」「どの食事」。
 *
 * この3つで献立の形が決まる。それ以外（時間・曜日・飽きの許容）は
 * 既定のままで困らない人が多いので、畳んでおく。
 * 作り置きの曜日と時間は、毎日作る人には関係ないので出さない。
 */
export function CookingSettings() {
  const s = useLiveQuery(() => db.settings.get('singleton'), []);
  if (!s) return null;

  const sessions = s.cooking.cookSessionsPerWeek ?? 1;
  const daily = sessions >= 5;
  const meals = s.cooking.coverDays * s.cooking.coverSlots.length;

  return (
    <div>
      <PageHeader title="作り方" backTo="/settings" />
      <div className="space-y-6 p-4">
        <Labeled label="週に何回作るか" hint={cadenceLabel(sessions, s.cooking.coverDays)}>
          <Stepper
            value={sessions}
            onChange={(v) => updateCooking(() => ({ cookSessionsPerWeek: v }))}
            step={1}
            min={1}
            max={7}
            suffix="回"
          />
        </Labeled>

        <Labeled
          label="何日分"
          hint={
            !daily && s.cooking.coverDays > s.cooking.maxFridgeDays
              ? '4日を超えるぶんは冷凍が前提になります'
              : undefined
          }
        >
          <Stepper
            value={s.cooking.coverDays}
            onChange={(v) => updateCooking(() => ({ coverDays: v }))}
            step={1}
            min={2}
            max={7}
            suffix="日分"
          />
        </Labeled>

        <Labeled label="どの食事を作るか">
          <MultiChips
            options={(['breakfast', 'lunch', 'dinner'] as MealSlot[]).map((m) => ({
              value: m,
              label: MEAL_SLOT_LABELS[m] + '食',
            }))}
            values={s.cooking.coverSlots}
            onToggle={(m) =>
              updateCooking((c) => {
                const next = c.coverSlots.includes(m)
                  ? c.coverSlots.filter((x) => x !== m)
                  : [...c.coverSlots, m];
                // 全部外すと献立が作れなくなるので、最低1つは残す
                return { coverSlots: sortSlots(next.length ? next : (['dinner'] as MealSlot[])) };
              })
            }
            columns={3}
          />
        </Labeled>

        <details className="rounded-lg border">
          <summary className="cursor-pointer px-4 py-3 text-xs text-muted-foreground">
            細かい設定
          </summary>
          <div className="space-y-6 border-t p-4">
            {!daily && (
              <>
                <Labeled label="作り置きの曜日">
                  <WeekdayPicker
                    value={s.cooking.prepDay}
                    onChange={(v: Weekday) => updateCooking(() => ({ prepDay: v }))}
                  />
                </Labeled>

                <Labeled label="1回に使える時間">
                  <Stepper
                    value={s.cooking.maxPrepMinutes}
                    onChange={(v) => updateCooking(() => ({ maxPrepMinutes: v }))}
                    step={15}
                    min={30}
                    max={300}
                    suffix="分"
                  />
                </Labeled>
              </>
            )}

            <Labeled
              label="同じ料理が続いてよい回数"
              hint={
                '少なくするほど品数が増えます。いまは ' +
                Math.ceil(meals / Math.max(s.cooking.maxSameDishMeals ?? 3, 1)) * 2 +
                '品ほど'
              }
            >
              <Stepper
                value={s.cooking.maxSameDishMeals ?? 3}
                onChange={(v) => updateCooking(() => ({ maxSameDishMeals: v }))}
                step={1}
                min={1}
                max={7}
                suffix="食まで"
              />
            </Labeled>
          </div>
        </details>
      </div>
    </div>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * よく行く店の価格水準。
 *
 * 店ごとの実売価格は取得できない（公開APIが無く、各社の規約は自動取得を禁じ、
 * そもそも商品単価を公開していない店が多い）。
 * できるのは「マスタの想定より何割高い店か」を、レシートの合計から学ぶこと。
 * ここで聞くのは、実績が入るまでの出発点だけ。
 *
 * 以前は店の名前を入れる欄があったが、名前はどこにも表示されず、
 * 何のための欄か分からなかった（本人指摘）。店は1つしか持たないので要らない。
 */
function StoreSetting() {
  const [store, setStore] = useState<Awaited<ReturnType<typeof getDefaultStore>> | null>(null);

  const reload = async () => setStore(await getDefaultStore());
  useEffect(() => {
    void reload();
  }, []);

  if (!store) return null;

  const band: PriceBand =
    store.priceFactor <= 0.9 ? 'cheap' : store.priceFactor >= 1.15 ? 'premium' : 'normal';
  const rel = reliabilityOf(store);

  return (
    <Labeled
      label="よく行く店の価格帯"
      hint={
        rel === 'unknown'
          ? 'レシートの合計を入れると、見込み金額が実際の店に近づきます'
          : '実績' + store.sampleCount + '回から調整' + (rel === 'rough' ? '中' : '済み') + '（' + store.priceFactor + '倍）'
      }
    >
      <Chips
        options={[
          { value: 'cheap', label: '安め', hint: '業務用・ディスカウント' },
          { value: 'normal', label: 'ふつう', hint: '一般的なスーパー' },
          { value: 'premium', label: '高め', hint: '駅ナカ・高級店' },
        ]}
        value={band}
        onChange={(v: PriceBand) => void setPriceBand(store.id, v).then(reload)}
        columns={3}
      />
    </Labeled>
  );
}
