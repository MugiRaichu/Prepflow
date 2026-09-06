/**
 * プロファイルの生成・更新。
 * 目標PFCは常にここで計算する。UI から数値を直接書き込ませない（D-009）。
 */
import { db, newEntity, touch, nowIso } from '../db';
import { calcTargets, recalcProfileTargets, DEFAULT_BODY } from '@/lib/nutrition';
import type {
  ActivityLevel,
  AllergenTag,
  DietGoal,
  Profile,
  Sex,
  UUID,
  MealSlot,
} from '../schema';

export interface ProfileDraft {
  name?: string;
  sex?: Sex;
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
  goal?: DietGoal;
  activityLevel?: ActivityLevel;
  /** 避けるアレルゲン。最初の設定で聞く。あとから増やせる */
  allergens?: AllergenTag[];
}

const DEFAULT_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/** オンボーディングの入力（全部省略可）から Profile を作る */
export function buildProfile(draft: ProfileDraft): Profile {
  const sex = draft.sex ?? DEFAULT_BODY.sex;
  const birthYear = draft.birthYear ?? DEFAULT_BODY.birthYear;
  const heightCm = draft.heightCm ?? DEFAULT_BODY.heightCm;
  const weightKg = draft.weightKg ?? DEFAULT_BODY.weightKg;
  const goal = draft.goal ?? 'maintain';
  const activityLevel = draft.activityLevel ?? 'sedentary';

  const baseTargets = calcTargets({
    sex,
    weightKg,
    heightCm,
    ageYears: new Date().getFullYear() - birthYear,
    activityLevel,
    goal,
  });

  return {
    ...newEntity(),
    name: draft.name?.trim() || '自分',
    isActive: 1,
    role: 'adult',
    sex,
    birthYear,
    heightCm,
    weightKg,
    goal,
    activityLevel,
    baseTargets,
    tolerance: { kcalPct: 10, proteinPct: 15, fatPct: 20, carbPct: 20 },
    mealsPerDay: 3,
    activeSlots: DEFAULT_SLOTS,
    activityAdjust: {
      enabled: false,
      kcalPerStep: 0.04,
      lookbackDays: 7,
      maxAdjustPct: 15,
      applyTo: 'kcal_only',
      source: 'manual',
    },
    preferences: [],
    maxSameRecipePerWeek: 2,
    ...(draft.allergens?.length ? { allergens: draft.allergens } : {}),
  };
}

export async function createProfile(draft: ProfileDraft): Promise<Profile> {
  const p = buildProfile(draft);
  await db.profiles.add(p);
  return p;
}

export async function listProfiles(): Promise<Profile[]> {
  return db.profiles.where('deleted').equals(0).toArray();
}

export async function getProfile(id: UUID): Promise<Profile | undefined> {
  const p = await db.profiles.get(id);
  return p && p.deleted === 0 ? p : undefined;
}

/**
 * 更新。体格・目的・活動量が変わったら目標PFCを自動で再計算する。
 * manualTargets が立っている場合だけ再計算しない。
 */
export async function updateProfile(
  id: UUID,
  patch: Partial<Omit<Profile, keyof ReturnType<typeof newEntity>>>,
): Promise<Profile> {
  const cur = await db.profiles.get(id);
  if (!cur) throw new Error('profile not found: ' + id);

  const merged = { ...cur, ...patch } as Profile;
  const next = touch({ ...merged, baseTargets: recalcProfileTargets(merged) });
  await db.profiles.put(next);
  return next;
}

/**
 * アレルゲンを1つ切り替える。
 *
 * 続けて2つ押したときに1つ目が消えないよう、読み出しから書き込みまでを
 * トランザクションに入れる。描画時点の配列から作ると、非同期の保存が
 * 終わる前の値を元にしてしまう（MultiChips の onToggle を使う理由）。
 */
export async function toggleAllergen(id: UUID, tag: AllergenTag): Promise<void> {
  await db.transaction('rw', db.profiles, async () => {
    const p = await db.profiles.get(id);
    if (!p) return;
    const cur = p.allergens ?? [];
    const next = cur.includes(tag) ? cur.filter((a) => a !== tag) : [...cur, tag];
    await db.profiles.put({ ...p, allergens: next, updatedAt: nowIso() });
  });
}

/** 目標を手で書き換える。以後の自動再計算を止める */
export async function setManualTargets(
  id: UUID,
  targets: Profile['baseTargets'],
): Promise<Profile> {
  const cur = await db.profiles.get(id);
  if (!cur) throw new Error('profile not found: ' + id);
  const next = touch({ ...cur, baseTargets: targets, manualTargets: true });
  await db.profiles.put(next);
  return next;
}

/** 自動計算に戻す */
export async function clearManualTargets(id: UUID): Promise<Profile> {
  const cur = await db.profiles.get(id);
  if (!cur) throw new Error('profile not found: ' + id);
  const reverted = { ...cur, manualTargets: false };
  const next = touch({ ...reverted, baseTargets: recalcProfileTargets(reverted) });
  await db.profiles.put(next);
  return next;
}

export async function removeProfile(id: UUID): Promise<void> {
  const cur = await db.profiles.get(id);
  if (!cur) return;
  await db.profiles.put(touch({ ...cur, deleted: 1 }));
}

/** オンボーディング完了を記録する */
export async function markOnboarded(): Promise<void> {
  const s = await db.settings.get('singleton');
  if (!s) return;
  await db.settings.put({ ...s, onboardedAt: nowIso(), updatedAt: nowIso() });
}

/**
 * 好き嫌いを設定する。
 *
 * アレルギーとは別に持つ。アレルギーは体の問題で絶対に緩めないが、
 * 好き嫌いは「できれば避けたい」から「絶対に無理」まで幅がある。
 * 同じ扱いにすると、苦手なもの1つで献立が組めなくなる。
 *
 *   dislike … できるだけ避ける（スコアで減点。ほかに手がなければ出る）
 *   exclude … 絶対に入れない（アレルギーと同じ強さ）
 *   null    … 解除
 *
 * 食材IDで持つ。アレルゲンと違ってタグに畳めない（にんじんが嫌い、は
 * にんじんという食材そのものの話で、分類の話ではない）。
 */
export async function setFoodPreference(
  profileId: UUID,
  ingredient: { id: UUID; name: string; aliases: string[] },
  kind: 'dislike' | 'exclude' | null,
): Promise<void> {
  await db.transaction('rw', db.profiles, async () => {
    const p = await db.profiles.get(profileId);
    if (!p) return;
    const rest = p.preferences.filter((t) => !t.ingredientIds?.includes(ingredient.id));
    const next = kind
      ? [
          ...rest,
          {
            id: crypto.randomUUID(),
            kind,
            label: ingredient.name,
            aliases: ingredient.aliases,
            ingredientIds: [ingredient.id],
            // 「できるだけ避ける」を弱くしすぎると効いている実感が出ない。
            // 強くしすぎると栄養や予算に勝ってしまうので 0.8
            ...(kind === 'dislike' ? { weight: 0.8 } : {}),
          },
        ]
      : rest;
    await db.profiles.put({ ...p, preferences: next, updatedAt: nowIso() });
  });
}

/** その食材にいま付いている設定。付いていなければ null */
export function foodPreferenceOf(p: Profile, ingredientId: UUID): 'dislike' | 'exclude' | null {
  const tag = p.preferences.find((t) => t.ingredientIds?.includes(ingredientId));
  if (!tag) return null;
  return tag.kind === 'exclude' ? 'exclude' : tag.kind === 'dislike' ? 'dislike' : null;
}
