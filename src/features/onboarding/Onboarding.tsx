import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Chips } from '@/components/shared/Chips';
import { Segmented } from '@/components/shared/Segmented';
import { Stepper } from '@/components/shared/Stepper';
import { WeekdayPicker } from '@/components/shared/WeekdayPicker';
import { Logo } from '@/components/shared/Logo';
import { calcTargets } from '@/lib/nutrition';
import { createProfile, markOnboarded } from '@/db/repositories/profiles';
import { updateSettings } from '@/db/repositories/settings';
import { requestPersistence } from '@/db/repositories/backup';
import { db, newEntity } from '@/db/db';
import type { ActivityLevel, DietGoal, Macros, Sex, Weekday } from '@/db/schema';
import {
  ACTIVITY_OPTIONS,
  BUDGET_OPTIONS,
  CONTAINER_PRESETS,
  EQUIPMENT_PRESETS,
  GOAL_OPTIONS,
  SEX_OPTIONS,
} from './options';
import { cn } from '@/lib/utils';

/**
 * オンボーディング。5画面すべてタップだけで進む（D-009 / D-015）。
 * 「あとで設定する」でいつでも抜けられる。省いた項目は既定値で埋まる。
 */
const STEPS = ['目的', '体格', '活動量', '道具', '買い物'] as const;

export function Onboarding() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [goal, setGoal] = useState<DietGoal>('maintain');
  const [sex, setSex] = useState<Sex>('unspecified');
  const [ageDecade, setAgeDecade] = useState(30);
  const [heightCm, setHeightCm] = useState(170);
  const [weightKg, setWeightKg] = useState(65);
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('sedentary');
  const [equipmentPresetId, setEquipmentPresetId] = useState('standard');
  const [containerPresetId, setContainerPresetId] = useState('few');
  const [weeklyBudgetYen, setWeeklyBudgetYen] = useState(5000);
  const [shoppingDay, setShoppingDay] = useState<Weekday>(6);
  const [prepDay, setPrepDay] = useState<Weekday>(0);

  const birthYear = new Date().getFullYear() - ageDecade;
  const preview = calcTargets({
    sex,
    weightKg,
    heightCm,
    ageYears: ageDecade,
    activityLevel,
    goal,
  });

  const finish = async () => {
    setSaving(true);
    try {
      await createProfile({ sex, birthYear, heightCm, weightKg, goal, activityLevel });

      const eq = EQUIPMENT_PRESETS.find((p) => p.id === equipmentPresetId);
      if (eq) {
        await db.equipment.bulkAdd(
          eq.items.map((i) => ({
            ...newEntity(),
            kind: i.kind,
            name: i.name,
            slots: i.slots,
            isAvailable: 1 as const,
            ...(i.wattage ? { wattage: i.wattage } : {}),
          })),
        );
      }

      const cp = CONTAINER_PRESETS.find((p) => p.id === containerPresetId);
      if (cp && cp.count > 0) {
        await db.containers.add({
          ...newEntity(),
          labelCode: 'A',
          name: '保存容器',
          volumeMl: cp.volumeMl,
          material: 'plastic',
          microwaveSafe: true,
          freezerSafe: true,
          count: cp.count,
          isAvailable: 1,
        });
      }

      const s = await db.settings.get('singleton');
      if (s) {
        await updateSettings({
          shopping: { ...s.shopping, weeklyBudgetYen, shoppingDay },
          cooking: { ...s.cooking, prepDay },
        });
      }

      // 端末の空き容量が減ったときにブラウザが消してしまわないよう、
      // 使い始めの時点で永続化を頼んでおく。断られても動作に支障はない
      await requestPersistence();
      await markOnboarded();
      nav('/dashboard', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  const next = () => (step === STEPS.length - 1 ? finish() : setStep(step + 1));

  return (
    <div className="pf-shell flex flex-col bg-background text-foreground">
      {/* セーフエリアは外側で避ける。h-12 に padding を足すと中身が潰れる */}
      <header className="pf-safe-top shrink-0 border-b">
        <div className="flex h-12 items-center gap-2 px-3">
          {step > 0 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="-ml-1 flex size-8 items-center justify-center"
              aria-label="戻る"
            >
              <ChevronLeft className="size-5" />
            </button>
          ) : (
            <Logo withText={false} />
          )}
          <span className="flex-1 text-sm font-medium">{STEPS[step]}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {step + 1} / {STEPS.length}
          </span>
        </div>
      </header>

      <div className="flex shrink-0 gap-0.5 px-3 pt-2">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={cn('h-0.5 flex-1 rounded-full', i <= step ? 'bg-foreground' : 'bg-border')}
          />
        ))}
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {step === 0 && (
          <Section
            title="何を目指しますか"
            note="あとから変えられます。"
          >
            <Chips options={GOAL_OPTIONS} value={goal} onChange={setGoal} columns={3} />
          </Section>
        )}

        {step === 1 && (
          <Section
            title="体格"
            note="だいたいで構いません。"
          >
            <Labeled label="性別">
              <Segmented options={SEX_OPTIONS} value={sex} onChange={setSex} />
            </Labeled>
            <Labeled label="年代">
              <Chips
                options={[20, 30, 40, 50, 60].map((a) => ({ value: a, label: a + '代' }))}
                value={ageDecade}
                onChange={setAgeDecade}
                columns={5}
              />
            </Labeled>
            <Labeled label="身長">
              <Stepper
                value={heightCm}
                onChange={setHeightCm}
                step={1}
                min={130}
                max={210}
                suffix="cm"
              />
            </Labeled>
            <Labeled label="体重">
              <Stepper
                value={weightKg}
                onChange={setWeightKg}
                step={0.5}
                min={30}
                max={150}
                suffix="kg"
              />
            </Labeled>
          </Section>
        )}

        {step === 2 && (
          <Section title="どのくらい動きますか" note="仕事と運動を合わせた、ふだんの活動量です。">
            <Chips
              options={ACTIVITY_OPTIONS}
              value={activityLevel}
              onChange={setActivityLevel}
              columns={2}
            />
            <TargetPreview targets={preview} />
          </Section>
        )}

        {step === 3 && (
          <Section
            title="持っている道具"
            note="あとから変えられます。"
          >
            <Labeled label="加熱器具">
              <Chips
                options={EQUIPMENT_PRESETS.map((p) => ({
                  value: p.id,
                  label: p.label,
                  hint: p.hint,
                }))}
                value={equipmentPresetId}
                onChange={setEquipmentPresetId}
                columns={1}
              />
            </Labeled>
            <Labeled label="保存容器">
              <Chips
                options={CONTAINER_PRESETS.map((p) => ({
                  value: p.id,
                  label: p.label,
                  hint: p.hint,
                }))}
                value={containerPresetId}
                onChange={setContainerPresetId}
                columns={3}
              />
            </Labeled>
          </Section>
        )}

        {step === 4 && (
          <Section
            title="買い物と作り置き"
            note="毎週この曜日で回します。"
          >
            <Labeled label="1週間の食費">
              <Chips
                options={BUDGET_OPTIONS}
                value={weeklyBudgetYen}
                onChange={setWeeklyBudgetYen}
                columns={3}
              />
            </Labeled>
            <Labeled label="買い出しの曜日">
              <WeekdayPicker value={shoppingDay} onChange={setShoppingDay} />
            </Labeled>
            <Labeled label="作り置きの曜日">
              <WeekdayPicker value={prepDay} onChange={setPrepDay} />
            </Labeled>
          </Section>
        )}
      </main>

      <footer className="pf-safe-bottom shrink-0 space-y-2 border-t px-4 py-3">
        <button
          onClick={next}
          disabled={saving}
          className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background active:scale-[0.99] disabled:opacity-50"
        >
          {step === STEPS.length - 1 ? (saving ? '作成中…' : 'はじめる') : '次へ'}
        </button>
        <button
          onClick={finish}
          disabled={saving}
          className="min-h-9 w-full text-xs text-muted-foreground"
        >
          あとで設定する
        </button>
      </footer>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

/** 目的と活動量を選んだ時点で、目標がどう出るかを見せる */
export function TargetPreview({ targets }: { targets: Macros }) {
  const items = [
    { label: 'カロリー', value: targets.kcal, unit: 'kcal' },
    { label: 'たんぱく質', value: targets.proteinG, unit: 'g' },
    { label: '脂質', value: targets.fatG, unit: 'g' },
    { label: '炭水化物', value: targets.carbG, unit: 'g' },
  ];
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 text-xs text-muted-foreground">1日あたりの目標</div>
      <div className="grid grid-cols-4 gap-2">
        {items.map((i) => (
          <div key={i.label}>
            <div className="text-[10px] text-muted-foreground">{i.label}</div>
            <div className="text-base font-semibold tabular-nums">{i.value}</div>
            <div className="text-[10px] text-muted-foreground">{i.unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
