import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check } from 'lucide-react';
import { db, newEntity, nowIso } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { updateCooking } from '@/db/repositories/settings';
import { LIFE_STAGE_PRESETS, diffOf, presetOf } from './logic/presets';
import type { LifeStagePreset } from './logic/presets';
import { addDaysIso, todayIso } from '@/lib/labels';
import { cn } from '@/lib/utils';

const MODE_LABEL: Record<string, string> = {
  batch: 'まとめて作る',
  daily: '毎日その日に作る',
  hybrid: '枠ごとに使い分ける',
};

/**
 * 暮らしのひな形。**分類ではなく、まとめて設定を入れるための近道。**
 *
 * ここに並ぶ6つで暮らしを網羅することはできない。夜勤・シフト、単身赴任、
 * 学生、在宅ワーク、介護、二拠点——数えはじめると終わらないし、
 * 増やすほど「自分はどれなのか」を考える時間が増える（＝認知負荷）。
 *
 * 逆に、**この画面を触らなくてもアプリは仕立てられる。**
 * 献立を決めているのは名前ではなく制約のほうで、それは最初の設定で
 * すべて聞いている（何人・週に何回・何日分・どの食事・何分・予算・日持ち）。
 * だからここは「近いものがあれば押すと下が埋まる」という位置づけに留める。
 *
 * 選ぶと何が変わるかを先に出してから適用する。設定を黙って書き換えない。
 * 育休のような一時的な状態には期限を持たせ、戻し忘れを防ぐ。
 */
export function LifeStagePresets() {
  const nav = useNavigate();
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  const current = useLiveQuery(
    async () => (await db.households.where('isCurrent').equals(1).toArray())[0],
    [],
  );
  const [pending, setPending] = useState<LifeStagePreset | null>(null);

  if (!settings) return null;

  const currentPreset = current ? presetOf(current.lifeStage) : undefined;
  const now = {
    mode: current?.cooking.mode ?? 'batch',
    coverSlots: settings.cooking.coverSlots,
    coverDays: settings.cooking.coverDays,
    maxPrepMinutes: settings.cooking.maxPrepMinutes,
  };

  const apply = async (p: LifeStagePreset) => {
    const today = todayIso();
    await db.transaction('rw', db.households, async () => {
      // 有効な世帯は常に1つ。前のものは履歴として残す
      const all = await db.households.toArray();
      for (const h of all) {
        if (h.isCurrent === 1) {
          await db.households.put({ ...h, isCurrent: 0, activeUntil: today, updatedAt: nowIso() });
        }
      }
      await db.households.add({
        ...newEntity(),
        name: p.label,
        lifeStage: p.stage,
        cooking: p.cooking,
        activeFrom: today,
        ...(p.temporary ? { activeUntil: addDaysIso(today, 90) } : {}),
        isCurrent: 1,
      });
    });

    await updateCooking(() => ({
      coverSlots: p.coverSlots,
      coverDays: p.coverDays,
      maxPrepMinutes:
        p.cooking.mode === 'daily' ? p.cooking.maxDailyCookMinutes : p.cooking.maxBatchMinutes,
      // プリセットが入れるのは**初期値だけ**。同じ暮らしでも作る回数は人による。
      // あとから「週に何回作るか」で自由に変えられる
      cookSessionsPerWeek: p.cooking.mode === 'daily' ? 7 : p.cooking.mode === 'hybrid' ? 3 : 1,
    }));

    setPending(null);
  };

  return (
    <div>
      <div className="space-y-4 p-4">
        {/*
          **選ばなくてよいことを先に言う。**
          一覧を出すと「どれかに当てはまらないといけない」と読まれる。
          6つで暮らしは網羅できないので、当てはまらない人のほうが多い。
        */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          近いものがあれば押すと、作り方の設定がまとめて入ります。
          <b className="text-foreground">当てはまるものが無くても構いません。</b>
          献立は名前ではなく、人数・回数・時間・予算から組んでいます。
        </p>

        {current?.activeUntil && (
          <div className="rounded-lg border border-foreground/40 p-3 text-xs leading-relaxed">
            <span className="font-medium">{current.name}</span> は一時的な設定です。
            {current.activeUntil} ごろに見直してください。
          </div>
        )}

        <div className="space-y-2">
          {LIFE_STAGE_PRESETS.map((p) => {
            const active = current?.lifeStage === p.stage;
            return (
              <button
                key={p.stage}
                onClick={() => setPending(active ? null : p)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-4 text-left',
                  active ? 'border-foreground bg-foreground text-background' : 'pf-press',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div
                    className={cn(
                      'text-[11px] leading-relaxed',
                      active ? 'text-background/70' : 'text-muted-foreground',
                    )}
                  >
                    {p.hint}
                  </div>
                </div>
                {active ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>

        {/*
          ひな形を選んでいなくても、いまの設定は出す。
          「未設定」とだけ書くと、何かが欠けているように見える。実際は動いている
        */}
        <div className="rounded-lg border p-3 text-[11px] leading-relaxed text-muted-foreground">
          いまの設定: {MODE_LABEL[currentPreset?.cooking.mode ?? 'batch']} ／{' '}
          {settings.cooking.coverDays}日分 ／ 1回 {settings.cooking.maxPrepMinutes}分まで
          <button
            onClick={() => nav('/settings/cooking')}
            className="ml-1 underline underline-offset-2"
          >
            直す
          </button>
        </div>
      </div>

      {pending && (
        <ConfirmSheet
          preset={pending}
          changes={diffOf(pending, now)}
          onCancel={() => setPending(null)}
          onApply={() => apply(pending)}
        />
      )}
    </div>
  );
}

/** 何が変わるかを出してから適用する */
function ConfirmSheet({
  preset,
  changes,
  onCancel,
  onApply,
}: {
  preset: LifeStagePreset;
  changes: string[];
  onCancel: () => void;
  onApply: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onCancel}>
      <div
        className="pf-rise w-full space-y-4 rounded-t-2xl border-t bg-background p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="text-base font-semibold">{preset.label}に切り替える</div>
          <div className="text-xs text-muted-foreground">{preset.hint}</div>
        </div>

        {changes.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {changes.map((c) => (
              <li key={c}>・{c}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">設定は変わりません。</p>
        )}

        {preset.temporary ? (
          <p className="text-[11px] text-muted-foreground">3ヶ月後に見直しの案内を出します。</p>
        ) : null}

        <p className="text-[11px] text-muted-foreground">次に作る献立から変わります。</p>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="min-h-12 rounded-lg border text-sm active:bg-accent">
            やめる
          </button>
          <button
            onClick={onApply}
            className="min-h-12 rounded-lg bg-foreground text-sm font-semibold text-background"
          >
            切り替える
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 単独画面としての入口。設定の一覧からは外した（→「作り方」の中）。
 * 古いリンクやブックマークのために残す。
 */
export function HouseholdScreen() {
  return (
    <div className="pb-6">
      <PageHeader title="いまの暮らし" backTo="/settings/cooking" />
      <LifeStagePresets />
    </div>
  );
}
