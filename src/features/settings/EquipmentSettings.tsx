import { useLiveQuery } from 'dexie-react-hooks';
import { db, newEntity, nowIso } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { Chips } from '@/components/shared/Chips';
import { Stepper } from '@/components/shared/Stepper';
import { WATTAGE_OPTIONS } from '@/features/onboarding/options';
import { EQUIPMENT_KIND_LABELS } from '@/lib/labels';
import { DEFAULT_RICE_MINUTES } from '@/features/cook/logic/rice';
import { updateCooking } from '@/db/repositories/settings';
import type { Equipment, EquipmentKind } from '@/db/schema';

/**
 * 調理器具は「持っている数」を答えるだけにする。
 *
 * 以前はカードを追加して種別をチップで選ばせていたが、
 * 「ガスコンロ」のカードの中に電子レンジのチップが並ぶ形になり、
 * 何を聞かれているのか分からなかった。追加も削除も種別変更も要らない。
 * 一覧に対して数を増減するだけにする（0台＝持っていない）。
 */
const KINDS: { kind: EquipmentKind; unit: string; hint?: string }[] = [
  { kind: 'microwave', unit: '台' },
  { kind: 'stovetop_burner', unit: '口', hint: '同時に火にかけられる数' },
  { kind: 'ih_burner', unit: '口', hint: '同時に火にかけられる数' },
  { kind: 'rice_cooker', unit: '台' },
  { kind: 'oven', unit: '台' },
  { kind: 'oven_toaster', unit: '台' },
  { kind: 'air_fryer', unit: '台' },
  { kind: 'pressure_cooker', unit: '台' },
  { kind: 'blender', unit: '台', hint: 'スムージー・プロテイン用' },
  { kind: 'hand_mixer', unit: '台' },
  { kind: 'food_processor', unit: '台' },
  { kind: 'shaker', unit: '本', hint: 'プロテインを溶かす' },
];

/**
 * ごはんが炊き上がるまでの分数。
 * 機種で倍近く違ううえ、鍋で炊く人もいるので、こちらで決めずに選んでもらう。
 */
const RICE_MINUTE_OPTIONS = [20, 30, 40, 50, 60, 70].map((m) => ({
  value: m,
  label: m + '分',
}));

export function EquipmentSettings() {
  const items = useLiveQuery(() => db.equipment.where('deleted').equals(0).toArray(), []);
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  if (!items || !settings) return null;

  const byKind = new Map(items.map((e) => [e.kind, e]));

  const setCount = async (kind: EquipmentKind, count: number) => {
    const existing = byKind.get(kind);
    if (existing) {
      await db.equipment.put({
        ...existing,
        slots: count,
        isAvailable: count > 0 ? 1 : 0,
        updatedAt: nowIso(),
      });
      return;
    }
    if (count <= 0) return;
    await db.equipment.add({
      ...newEntity(),
      kind,
      name: EQUIPMENT_KIND_LABELS[kind],
      slots: count,
      isAvailable: 1,
      ...(kind === 'microwave' ? { wattage: 600 } : {}),
    });
  };

  const setWattage = async (e: Equipment, wattage: number) => {
    await db.equipment.put({ ...e, wattage, updatedAt: nowIso() });
  };

  return (
    <div>
      <div className="p-4">
        <h2 className="mb-1 text-sm font-medium">加熱する道具</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          持っている数を入れてください。0 なら持っていない扱いです。
        </p>

        <div className="divide-y">
          {KINDS.map(({ kind, unit, hint }) => {
            const e = byKind.get(kind);
            const count = e?.slots ?? 0;
            return (
              <div key={kind} className="py-4">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{EQUIPMENT_KIND_LABELS[kind]}</div>
                    {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
                  </div>
                </div>

                <Stepper
                  value={count}
                  onChange={(v) => setCount(kind, v)}
                  step={1}
                  min={0}
                  max={6}
                  suffix={unit}
                />

                {/* 炊飯の時間は炊飯器の有無によらず要る。
                    持っていない人には、鍋で炊く段取りに変わることをここで言う */}
                {kind === 'rice_cooker' && (
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] text-muted-foreground">
                      {count > 0
                        ? '炊き上がりまで'
                        : '炊き上がりまで（鍋で炊く手順になります）'}
                    </div>
                    <Chips
                      options={RICE_MINUTE_OPTIONS}
                      value={settings.cooking.riceCookMinutes ?? DEFAULT_RICE_MINUTES}
                      onChange={(v) => void updateCooking(() => ({ riceCookMinutes: v }))}
                      columns={3}
                    />
                  </div>
                )}

                {kind === 'microwave' && count > 0 && e && (
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] text-muted-foreground">出力</div>
                    <Chips
                      options={WATTAGE_OPTIONS}
                      value={e.wattage ?? 600}
                      onChange={(v) => setWattage(e, v)}
                      columns={4}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 保存容器も同じく「大きさごとの個数」だけを聞く */
const CONTAINER_SIZES = [300, 500, 700, 900];

export function ContainerSettings() {
  const items = useLiveQuery(() => db.containers.where('deleted').equals(0).toArray(), []);
  if (!items) return null;

  const bySize = new Map(items.map((c) => [c.volumeMl, c]));
  const totalCount = items.reduce((n, c) => n + c.count, 0);

  const setCount = async (volumeMl: number, count: number) => {
    const existing = bySize.get(volumeMl);
    if (existing) {
      await db.containers.put({
        ...existing,
        count,
        isAvailable: count > 0 ? 1 : 0,
        updatedAt: nowIso(),
      });
      return;
    }
    if (count <= 0) return;
    await db.containers.add({
      ...newEntity(),
      labelCode: String(volumeMl),
      name: volumeMl + 'ml の容器',
      volumeMl,
      material: 'plastic',
      microwaveSafe: true,
      freezerSafe: true,
      count,
      isAvailable: 1,
    });
  };

  return (
    <div>
      <div className="p-4">
        <h2 className="mb-1 text-sm font-medium">保存容器</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          主菜は1食ずつ、副菜はまとめて詰めます。足りなければ皿で回せます。
        </p>

        <div className="divide-y">
          {CONTAINER_SIZES.map((ml) => (
            <div key={ml} className="py-4">
              <div className="mb-2 text-sm font-medium">{ml} ml</div>
              <Stepper
                value={bySize.get(ml)?.count ?? 0}
                onChange={(v) => setCount(ml, v)}
                step={1}
                min={0}
                max={30}
                suffix="個"
              />
            </div>
          ))}
        </div>

        <p className="pt-4 text-xs tabular-nums text-muted-foreground">合計 {totalCount} 個</p>
      </div>
    </div>
  );
}

/**
 * 台所の道具。**調理器具と保存容器を1つの画面にする。**
 *
 * 別々の入口にしていたが、考えるのは同じ場面——「うちの台所に何があるか」。
 * 設定の入口が13行あり、項目名を知っていてもどの画面かは推測するしか
 * なかった（本人指摘）。入口を減らすには、行を束ねるだけでは足りない。
 * **画面ごとまとめないと、階層が1つ増えるだけになる。**
 */
export function KitchenSettings() {
  return (
    <div className="pb-6">
      <PageHeader title="台所の道具" backTo="/settings" />
      <EquipmentSettings />
      <div className="mx-4 border-t" />
      <ContainerSettings />
    </div>
  );
}
