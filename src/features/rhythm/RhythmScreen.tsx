import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { Chips } from '@/components/shared/Chips';
import { WeekdayMultiPicker } from '@/components/shared/WeekdayPicker';
import { Segmented } from '@/components/shared/Segmented';
import { Stepper } from '@/components/shared/Stepper';
import { WhySheet } from '@/components/shared/WhySheet';
import { habitsRepo } from '@/db/repositories';
import { updateSettings } from '@/db/repositories/settings';
import { EXERCISE_PRESETS, estimateExerciseKcal, metsOf } from '@/db/data/exercise';
import { sleepDurationMin, toMin, toTime } from './logic/timeline';
import type { Habit, HabitKind, TimeOfDay } from '@/db/schema';

const WAKE_TIMES: TimeOfDay[] = ['05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00'];
const SLEEP_TIMES: TimeOfDay[] = ['22:00', '22:30', '23:00', '23:30', '00:00', '00:30', '01:00'];

const KIND_LABELS: Record<HabitKind, string> = {
  training: 'トレーニング',
  commute: '通勤・通学',
  work: '仕事',
  bath: '入浴',
  study: '勉強',
  other: 'その他',
};

/**
 * 1日のスケジュール。起床と就寝から逆算して自動で組む。
 * 根拠は各項目の「なぜ？」で開く（静的テキスト・出典つき）。
 */
export function RhythmScreen() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  const habits = useLiveQuery(() => db.habits.where('deleted').equals(0).toArray(), []);
  const profiles = useLiveQuery(() => db.profiles.where('deleted').equals(0).toArray(), []);

  if (!settings) return null;
  const r = settings.rhythm;
  const weight = profiles?.find((p) => p.isActive === 1)?.weightKg ?? 65;

  const sleepMin = sleepDurationMin(r);
  const setRhythm = (patch: Partial<typeof r>) => updateSettings({ rhythm: { ...r, ...patch } });

  return (
    <div className="pb-6">
      <PageHeader
        title="1日の流れ"
        backTo="/settings"
        action={
          <button
            onClick={() =>
              habitsRepo.create({
                name: 'トレーニング',
                kind: 'training',
                days: [1, 3, 5],
                startTime: '19:00',
                durationMin: 60,
                fixed: false,
                exerciseId: 'weights_moderate',
              })
            }
            className="flex size-8 items-center justify-center rounded-md active:bg-accent"
            aria-label="予定を追加"
          >
            <Plus className="size-5" />
          </button>
        }
      />

      <div className="space-y-6 p-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">起きる時刻</div>
          <Chips
            options={WAKE_TIMES.map((t) => ({ value: t, label: t }))}
            value={r.wakeTime}
            onChange={(v) => setRhythm({ wakeTime: v })}
            columns={4}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">寝る時刻</div>
          <Chips
            options={SLEEP_TIMES.map((t) => ({ value: t, label: t }))}
            value={r.sleepTime}
            onChange={(v) => setRhythm({ sleepTime: v })}
            columns={4}
          />
          <div className="text-xs tabular-nums text-muted-foreground">
            睡眠 {Math.floor(sleepMin / 60)} 時間 {sleepMin % 60} 分
            {sleepMin < 360 ? ' — 短すぎるかもしれません' : ''}
          </div>
          <WhySheet knowledgeId="sleep_golden_time" />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">カフェイン</div>
          <Segmented
            options={[
              { value: 'no', label: '飲まない' },
              { value: 'yes', label: '飲む' },
            ]}
            value={r.caffeine ? 'yes' : 'no'}
            onChange={(v) => setRhythm({ caffeine: v === 'yes' })}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">就寝前のタンパク質</div>
          <Segmented
            options={[
              { value: 'no', label: '摂らない' },
              { value: 'yes', label: '摂る' },
            ]}
            value={r.preSleepProtein ? 'yes' : 'no'}
            onChange={(v) => setRhythm({ preSleepProtein: v === 'yes' })}
          />
          <WhySheet knowledgeId="pre_sleep_protein" />
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">毎週きまってやること</div>
          {(habits ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">右上の＋で追加できます。</p>
          )}
          {(habits ?? []).map((h) => (
            <HabitCard key={h.id} habit={h} weightKg={weight} />
          ))}
        </div>

        {/* 組み上がった流れは今日タブに出す。ここは設定だけ */}
        <p className="text-[11px] text-muted-foreground">
          ここで決めた時刻から、今日タブに食事とたんぱく質の時刻が並びます。
        </p>
      </div>
    </div>
  );
}

function HabitCard({ habit, weightKg }: { habit: Habit; weightKg: number }) {
  const patch = (v: Partial<Habit>) => habitsRepo.update(habit.id, v);
  const est = estimateExerciseKcal(metsOf(habit.exerciseId), weightKg, habit.durationMin);

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{habit.name}</span>
        <button
          onClick={() => habitsRepo.remove(habit.id)}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          aria-label="削除"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <Chips
        options={(Object.keys(KIND_LABELS) as HabitKind[]).map((k) => ({
          value: k,
          label: KIND_LABELS[k],
        }))}
        value={habit.kind}
        onChange={(v: HabitKind) => patch({ kind: v, name: KIND_LABELS[v] })}
        columns={3}
      />

      <div>
        <div className="mb-1 text-xs text-muted-foreground">曜日</div>
        <WeekdayMultiPicker values={habit.days} onChange={(v) => patch({ days: v })} />
      </div>

      <div>
        <div className="mb-1 text-xs text-muted-foreground">開始</div>
        <Stepper
          value={toMin(habit.startTime)}
          onChange={(v) => patch({ startTime: toTime(v) })}
          step={30}
          min={0}
          max={1410}
          format={(v) => toTime(v)}
        />
      </div>

      <div>
        <div className="mb-1 text-xs text-muted-foreground">長さ</div>
        <Stepper
          value={habit.durationMin}
          onChange={(v) => patch({ durationMin: v })}
          step={15}
          min={15}
          max={240}
          suffix="分"
        />
      </div>

      {habit.kind === 'training' ? (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">運動の種類</div>
          <Chips
            options={EXERCISE_PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.hint }))}
            value={habit.exerciseId ?? 'weights_moderate'}
            onChange={(v) => patch({ exerciseId: v })}
            columns={2}
          />
          <div className="mt-2 rounded-md border p-3">
            <div className="text-xs">
              消費カロリーの概算{' '}
              <span className="font-semibold tabular-nums">約 {est.kcal} kcal</span>
            </div>
            <div className="text-[11px] tabular-nums text-muted-foreground">
              現実的な幅 {est.low}〜{est.high} kcal
            </div>
            <WhySheet knowledgeId="exercise_calories" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
