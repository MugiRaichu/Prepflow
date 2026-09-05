import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { Chips, MultiChips } from '@/components/shared/Chips';
import {
  ALLERGEN_LABELS,
  MANDATORY_ALLERGENS,
  OPTIONAL_ALLERGENS,
} from '@/lib/labels';
import { Segmented } from '@/components/shared/Segmented';
import { Stepper } from '@/components/shared/Stepper';
import { TargetPreview } from '@/features/onboarding/Onboarding';
import {
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  SEX_OPTIONS,
} from '@/features/onboarding/options';
import {
  createProfile,
  removeProfile,
  toggleAllergen,
  updateProfile,
} from '@/db/repositories/profiles';
import type { ActivityLevel, AllergenTag, DietGoal, Profile, Sex } from '@/db/schema';

/**
 * 食べる人の設定。数値の直接入力は置かず、すべてタップとステッパー（D-009）。
 * 目標PFCは体格・活動量・目的から自動計算され、ここでは表示のみ。
 */
export function ProfileSettings() {
  const profiles = useLiveQuery(() => db.profiles.where('deleted').equals(0).toArray(), []);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="食べる人"
        backTo="/settings"
        action={
          <button
            onClick={async () => {
              const p = await createProfile({ name: '' });
              setOpenId(p.id);
            }}
            className="flex size-8 items-center justify-center rounded-md active:bg-accent"
            aria-label="追加"
          >
            <Plus className="size-5" />
          </button>
        }
      />

      <div className="divide-y">
        {(profiles ?? []).map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            open={openId === p.id}
            onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            canDelete={(profiles ?? []).length > 1}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileRow({
  profile,
  open,
  onToggle,
  canDelete,
}: {
  profile: Profile;
  open: boolean;
  onToggle: () => void;
  canDelete: boolean;
}) {
  const t = profile.baseTargets;
  const age = new Date().getFullYear() - (profile.birthYear ?? new Date().getFullYear() - 30);

  const patch = (v: Partial<Profile>) => updateProfile(profile.id, v);

  return (
    <div>
      <button onClick={onToggle} className="flex w-full min-h-14 items-center gap-3 px-4 text-left active:bg-accent">
        <span className="flex-1 text-sm font-medium">{profile.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t.kcal} kcal ・ P {t.proteinG}g
        </span>
      </button>

      {open && (
        <div className="space-y-5 px-4 pb-6">
          <Labeled label="名前">
            <input
              value={profile.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="自分"
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Labeled>

          <Labeled label="目的">
            <Chips
              options={GOAL_OPTIONS}
              value={profile.goal}
              onChange={(v: DietGoal) => patch({ goal: v })}
              columns={3}
            />
          </Labeled>

          <Labeled label="活動量">
            <Chips
              options={ACTIVITY_OPTIONS}
              value={profile.activityLevel}
              onChange={(v: ActivityLevel) => patch({ activityLevel: v })}
              columns={2}
            />
          </Labeled>

          <Labeled label="性別">
            <Segmented
              options={SEX_OPTIONS}
              value={profile.sex ?? 'unspecified'}
              onChange={(v: Sex) => patch({ sex: v })}
            />
          </Labeled>

          <Labeled label="年齢">
            <Stepper
              value={age}
              onChange={(v) => patch({ birthYear: new Date().getFullYear() - v })}
              step={1}
              min={15}
              max={99}
              suffix="歳"
            />
          </Labeled>

          <Labeled label="身長">
            <Stepper
              value={profile.heightCm ?? 170}
              onChange={(v) => patch({ heightCm: v })}
              step={1}
              min={130}
              max={210}
              suffix="cm"
            />
          </Labeled>

          <Labeled label="体重">
            <Stepper
              value={profile.weightKg ?? 65}
              onChange={(v) => patch({ weightKg: v })}
              step={0.5}
              min={30}
              max={150}
              suffix="kg"
            />
          </Labeled>

          <AllergenPicker profile={profile} />

          <TargetPreview targets={t} />

          <p className="text-[10px] text-muted-foreground">
            体重を更新すると目標も変わります。
          </p>

          {canDelete && (
            <button
              onClick={() => removeProfile(profile.id)}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border text-xs active:bg-accent"
            >
              <Trash2 className="size-3.5" />
              この人を削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * アレルゲンの指定。
 *
 * 食材ではなくアレルゲンで選ばせる。「卵」を選べば、卵を含むレシピが全部消える。
 * 食材ごとに選ばせると、食材が増えるたびに指定し直しになる。
 *
 * 表示義務のある8品目を先に出し、残りは畳んでおく。
 * ここはハード制約で、献立が組めなくても絶対に緩めない。
 */
function AllergenPicker({ profile }: { profile: Profile }) {
  const [showAll, setShowAll] = useState(false);
  const selected = profile.allergens ?? [];
  const extra = selected.filter((a) => !MANDATORY_ALLERGENS.includes(a));
  const open = showAll || extra.length > 0;

  const toOption = (a: AllergenTag) => ({ value: a, label: ALLERGEN_LABELS[a] });

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">アレルギー</div>
      <MultiChips
        options={MANDATORY_ALLERGENS.map(toOption)}
        values={selected}
        onToggle={(a) => void toggleAllergen(profile.id, a)}
        columns={4}
      />

      {open ? (
        <MultiChips
          options={OPTIONAL_ALLERGENS.map(toOption)}
          values={selected}
          onToggle={(a) => void toggleAllergen(profile.id, a)}
          columns={4}
        />
      ) : (
        <button
          onClick={() => setShowAll(true)}
          className="min-h-9 w-full rounded-md border text-[11px] text-muted-foreground active:bg-accent"
        >
          ほかの食材も指定する
        </button>
      )}

      {selected.length > 0 && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          選んだものを含む料理は献立に出しません。ほかの条件が満たせなくても外しません。
        </p>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}
