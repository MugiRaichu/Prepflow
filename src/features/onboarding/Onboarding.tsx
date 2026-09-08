import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft } from 'lucide-react';
import { Chips, MultiChips } from '@/components/shared/Chips';
import { Segmented } from '@/components/shared/Segmented';
import { Stepper } from '@/components/shared/Stepper';
import { WeekdayMultiPicker, WeekdayPicker } from '@/components/shared/WeekdayPicker';
import { Logo } from '@/components/shared/Logo';
import { bodyDefaultsFor, calcTargets } from '@/lib/nutrition';
import { createProfile, markOnboarded } from '@/db/repositories/profiles';
import { updateSettings } from '@/db/repositories/settings';
import { requestPersistence } from '@/db/repositories/backup';
import { db, newEntity } from '@/db/db';
import { cadenceLabel } from '@/features/planner/logic/cadence';
import { DEFAULT_RICE_MINUTES } from '@/features/cook/logic/rice';
import {
  ALLERGEN_LABELS,
  MANDATORY_ALLERGENS,
  MEAL_SLOT_LABELS,
  OPTIONAL_ALLERGENS,
  sortSlots,
} from '@/lib/labels';
import type {
  ActivityLevel,
  AllergenTag,
  DietGoal,
  Macros,
  MealSlot,
  Sex,
  Weekday,
} from '@/db/schema';
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
 * オンボーディング。
 *
 * **最初に全部聞く。** 以前は5画面に削っていたが、聞かなかったぶんは既定値のまま
 * 最初の献立に出てしまい、「アレルギーが入っていた」「毎日作りたいのに週まとめの
 * 画面が出た」のように、初回の献立が本人のものにならなかった。
 * あとから設定画面で直せるとしても、直す必要に気づくのは失敗したあとになる。
 *
 * 長くなるぶん、飽きさせない造りにする（D-102）。
 *   - 章で区切る。「あと何問か」ではなく「いま何の話をしているか」が分かる
 *   - 答えた瞬間に数字が動く。目標カロリー、週の食数、1回の調理時間
 *   - 決めたことが上に積み上がる。進んでいる手応えを出す
 *   - 「あとで設定する」はいつでも押せる。省いたぶんは既定値で埋める
 */

type StepKey =
  | 'eaters'
  | 'goal'
  | 'body'
  | 'activity'
  | 'allergy'
  | 'cadence'
  | 'cover'
  | 'rhythm'
  | 'equipment'
  | 'shopping'
  | 'keep'
  | 'done';

interface StepDef {
  key: StepKey;
  chapter: string;
  title: string;
  note?: string;
}

const STEPS: StepDef[] = [
  /*
    人数を最初に聞く。**ここを聞いていなかった。**

    1人前提で組んでいたので、2人で使うと量も金額も容器の数も
    すべて半分だった。あとの質問（予算・容器・時間）はどれも
    人数の上に乗るので、先に聞かないと答えようがない。
  */
  {
    key: 'eaters',
    chapter: 'あなたのこと',
    title: '何人ぶん作りますか',
    note: '量も食費も容器の数も、ここから決まります。',
  },
  { key: 'goal', chapter: 'あなたのこと', title: '何を目指しますか', note: 'あとから変えられます。' },
  { key: 'body', chapter: 'あなたのこと', title: '体格', note: 'だいたいで構いません。' },
  {
    key: 'activity',
    chapter: 'あなたのこと',
    title: 'どのくらい動きますか',
    note: '仕事と運動を合わせた、ふだんの活動量です。',
  },
  {
    key: 'allergy',
    chapter: '食べられないもの',
    title: 'アレルギーはありますか',
    note: '選んだものは、どんな条件でも献立に入りません。ここだけは緩めません。',
  },
  {
    key: 'cadence',
    chapter: '暮らし',
    title: '週に何回、台所に立ちますか',
    note: 'ここで献立の形が変わります。まとめて作るのか、その日に作るのか。',
  },
  {
    key: 'cover',
    chapter: '暮らし',
    title: '何日分・どの食事',
    note: '作らない食事は献立に出ません。',
  },
  {
    key: 'rhythm',
    chapter: '暮らし',
    title: '1日の時間',
    note: '食事とタンパク質の時刻を、ここから逆算します。',
  },
  { key: 'equipment', chapter: '台所', title: '持っている道具', note: '無いものは段取りに出ません。' },
  { key: 'shopping', chapter: '買い物', title: '食費と曜日', note: '毎週この曜日で回します。' },
  {
    key: 'keep',
    chapter: '買い物',
    title: '作ったものを何日もたせますか',
    note: '賞味期限はここと、料理ごとの日持ちの短いほうで決まります。',
  },
  { key: 'done', chapter: '', title: '準備OKですか？', note: undefined },
];

const CHAPTERS = ['あなたのこと', '食べられないもの', '暮らし', '台所', '買い物'];

export function Onboarding() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adults, setAdults] = useState(1);
  const [goal, setGoal] = useState<DietGoal>('maintain');
  const [sex, setSex] = useState<Sex>('unspecified');
  const [ageDecade, setAgeDecade] = useState(30);
  /*
   * 体格の初期値は**性別に合わせて動く**。全員に 170cm / 65kg を出していたが、
   * 女性にはほぼ確実に外れる数字で、その1回のために減らすボタンを何十回も押すことになる。
   *
   * ただし**自分で動かしたあとは、もう触らない。**性別を選び直しても、
   * 入れた数字が勝手に書き換わるのは驚きにしかならない。
   */
  const [heightCm, setHeightCm] = useState(bodyDefaultsFor('unspecified').heightCm);
  const [weightKg, setWeightKg] = useState(bodyDefaultsFor('unspecified').weightKg);
  const [heightTouched, setHeightTouched] = useState(false);
  const [weightTouched, setWeightTouched] = useState(false);

  const pickSex = (v: Sex) => {
    setSex(v);
    const d = bodyDefaultsFor(v);
    if (!heightTouched) setHeightCm(d.heightCm);
    if (!weightTouched) setWeightKg(d.weightKg);
  };
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('sedentary');
  const [allergens, setAllergens] = useState<AllergenTag[]>([]);
  const [showAllAllergens, setShowAllAllergens] = useState(false);
  const [sessions, setSessions] = useState(1);
  const [coverDays, setCoverDays] = useState(5);
  const [coverSlots, setCoverSlots] = useState<MealSlot[]>(['dinner']);
  const [wakeTime, setWakeTime] = useState('07:00');
  const [sleepTime, setSleepTime] = useState('23:30');
  const [equipmentPresetId, setEquipmentPresetId] = useState('standard');
  const [containerPresetId, setContainerPresetId] = useState('few');
  const [riceCookMinutes, setRiceCookMinutes] = useState(DEFAULT_RICE_MINUTES);
  const [weeklyBudgetYen, setWeeklyBudgetYen] = useState(5000);
  const [shoppingDay, setShoppingDay] = useState<Weekday>(6);
  const [prepDays, setPrepDays] = useState<Weekday[]>([0]);
  const [maxFridgeDays, setMaxFridgeDays] = useState(3);
  const [allowFreezing, setAllowFreezing] = useState(true);

  const birthYear = new Date().getFullYear() - ageDecade;
  const targets = calcTargets({
    sex,
    weightKg,
    heightCm,
    ageYears: ageDecade,
    activityLevel,
    goal,
  });

  const daily = sessions >= 5;
  const meals = coverDays * coverSlots.length;
  const hasRiceCooker = (EQUIPMENT_PRESETS.find((p) => p.id === equipmentPresetId)?.items ?? []).some(
    (i) => i.kind === 'rice_cooker',
  );

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      /*
       * 人数ぶんのプロファイルを作る。献立の計算はもともと複数人に対応していて
       * （目標を合計し、容器も人数ぶん用意する）、**聞いていなかっただけ**。
       *
       * 2回目に通ったときに増やさない。器具や容器と同じで、この画面は
       * 「あとで設定する」で抜けたあと入り直すことがある
       */
      const already = await db.profiles.where('deleted').equals(0).count();
      if (already === 0) {
        await createProfile({ sex, birthYear, heightCm, weightKg, goal, activityLevel, allergens });
        for (let i = 2; i <= adults; i++) {
          await createProfile({
            name: i + '人目',
            sex,
            birthYear,
            heightCm,
            weightKg,
            goal,
            activityLevel,
            allergens,
          });
        }
      }

      /*
       * 器具と容器は**すでにあれば作らない**。
       *
       * この画面は2回通ることがある（「あとで設定する」で抜けたあと、
       * 設定から入り直す）。毎回足していると、コンロが2倍になり、
       * 容器は labelCode が重複して**保存そのものが失敗する**。
       * 実際、「はじめる」を押しても何も起きない状態になっていた。
       */
      const eq = EQUIPMENT_PRESETS.find((p) => p.id === equipmentPresetId);
      const haveEquipment = await db.equipment.count();
      if (eq && haveEquipment === 0) {
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
      const haveContainers = await db.containers.count();
      if (cp && cp.count > 0 && haveContainers === 0) {
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
          cooking: {
            ...s.cooking,
            prepDays,
            // 複数版を読まない古い画面のために、先頭を単数側にも残す
            prepDay: prepDays[0] ?? 0,
            cookSessionsPerWeek: sessions,
            coverDays,
            coverSlots: sortSlots(coverSlots),
            maxFridgeDays,
            allowFreezing,
            riceCookMinutes,
          },
          rhythm: { ...s.rhythm, wakeTime, sleepTime },
        });
      }

      // 端末の空き容量が減ったときにブラウザが消してしまわないよう、
      // 使い始めの時点で永続化を頼んでおく。断られても動作に支障はない
      await requestPersistence();
      await markOnboarded();
      nav('/dashboard', { replace: true });
    } catch (e) {
      /*
       * **黙って止まらない。**
       * ここは try/finally だけで、失敗しても画面には何も出なかった。
       * 押しても何も起きないボタンは、壊れているのか自分が悪いのか分からない。
       */
      setError(e instanceof Error ? e.message : '保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const cur = STEPS[step];
  const last = step === STEPS.length - 1;
  const next = () => (last ? finish() : setStep(step + 1));

  const toggleAllergen = (a: AllergenTag) =>
    setAllergens((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  const toggleSlot = (m: MealSlot) =>
    setCoverSlots((cur) => {
      const nextSlots = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
      // 全部外すと献立が作れなくなるので、最低1つは残す
      return sortSlots(nextSlots.length ? nextSlots : (['dinner'] as MealSlot[]));
    });

  return (
    <div className="pf-shell flex flex-col bg-background text-foreground">
      {/* セーフエリアは外側で避ける。h-12 に padding を足すと中身が潰れる */}
      <header className="pf-safe-top shrink-0 border-b">
        <div className="flex h-12 items-center gap-2 px-3">
          {step > 0 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="-ml-1 flex size-11 items-center justify-center"
              aria-label="戻る"
            >
              <ChevronLeft className="size-5" />
            </button>
          ) : (
            <Logo withText={false} />
          )}
          <span className="flex-1 text-sm font-medium">{cur.chapter || 'Prepflow'}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {step + 1} / {STEPS.length}
          </span>
        </div>
      </header>

      <ChapterBar current={cur.chapter} />

      {/*
        中身を縦の中心に置く。

        設問が3択だけの回では、内容が上端に貼りついて下に600px近い余白が残り、
        画面が壊れて見えた。**選ぶものと押すボタンも遠かった**（親指は下にある）。
        `justify-center` は中身が画面より短いときだけ効き、長い回では
        いつもどおり上から並んでスクロールする。
      */}
      <main className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 py-6">
        {/* key を付けて、画面が変わるたびに入り直させる。進んだ手応えが出る */}
        <div key={cur.key} className="pf-rise">
          <Section title={cur.title} note={cur.note}>
            {cur.key === 'eaters' && (
              <>
                <Stepper value={adults} onChange={setAdults} step={1} min={1} max={6} suffix="人" />
                {/*
                  2人目以降の体格は聞かない。ここで6人ぶんの身長体重を
                  順番に聞くと、その前に閉じられる。同じ体格で見積もって、
                  違うなら設定で1人ずつ直せることだけ伝える。
                */}
                <Note>
                  {adults === 1
                    ? '1人ぶんで組みます。'
                    : adults +
                      '人ぶんで組みます。量も食費も' +
                      adults +
                      '倍になります。2人目からはあなたと同じ体格で見積もるので、違うときは設定 › 食べる人で直せます。'}
                </Note>
              </>
            )}

            {cur.key === 'goal' && (
              <Chips options={GOAL_OPTIONS} value={goal} onChange={setGoal} columns={3} />
            )}

            {cur.key === 'body' && (
              <>
                <Labeled label="性別">
                  <Segmented options={SEX_OPTIONS} value={sex} onChange={pickSex} />
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
                    onChange={(v) => {
                      setHeightTouched(true);
                      setHeightCm(v);
                    }}
                    step={1}
                    min={130}
                    max={210}
                    suffix="cm"
                  />
                </Labeled>
                <Labeled label="体重">
                  <Stepper
                    value={weightKg}
                    onChange={(v) => {
                      setWeightTouched(true);
                      setWeightKg(v);
                    }}
                    step={0.5}
                    min={30}
                    max={150}
                    suffix="kg"
                  />
                </Labeled>
              </>
            )}

            {cur.key === 'activity' && (
              <>
                <Chips
                  options={ACTIVITY_OPTIONS}
                  value={activityLevel}
                  onChange={setActivityLevel}
                  columns={2}
                />
                <TargetPreview targets={targets} />
              </>
            )}

            {cur.key === 'allergy' && (
              <>
                <MultiChips
                  options={MANDATORY_ALLERGENS.map((a) => ({ value: a, label: ALLERGEN_LABELS[a] }))}
                  values={allergens}
                  onToggle={toggleAllergen}
                  columns={4}
                />
                {showAllAllergens ? (
                  <MultiChips
                    options={OPTIONAL_ALLERGENS.map((a) => ({
                      value: a,
                      label: ALLERGEN_LABELS[a],
                    }))}
                    values={allergens}
                    onToggle={toggleAllergen}
                    columns={4}
                  />
                ) : (
                  <button
                    onClick={() => setShowAllAllergens(true)}
                    className="min-h-11 w-full text-xs text-muted-foreground"
                  >
                    ほかのものも選ぶ
                  </button>
                )}
                <Note>
                  {allergens.length === 0
                    ? '無ければそのまま次へ。'
                    : allergens.map((a) => ALLERGEN_LABELS[a]).join('・') +
                      ' を含む料理は出しません。'}
                </Note>
              </>
            )}

            {cur.key === 'cadence' && (
              <>
                <Stepper
                  value={sessions}
                  onChange={setSessions}
                  step={1}
                  min={1}
                  max={7}
                  suffix="回"
                />
                <Note>{cadenceLabel(sessions, coverDays)}</Note>
              </>
            )}

            {cur.key === 'cover' && (
              <>
                <Labeled label="何日分">
                  <Stepper
                    value={coverDays}
                    onChange={setCoverDays}
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
                    values={coverSlots}
                    onToggle={toggleSlot}
                    columns={3}
                  />
                </Labeled>
                {/* 決めた瞬間に「何食ぶんの話なのか」が出る。数字が動くと手が止まらない */}
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="1週間で" value={meals + '食'} />
                  {/* 出すのは答えから出た数だけ。所要時間は献立が決まるまで分からないので出さない */}
                  <Stat
                    label={daily ? '1日あたり' : '1回で作るのは'}
                    value={Math.ceil(meals / Math.max(sessions, 1)) + '食ぶん'}
                  />
                </div>
              </>
            )}

            {cur.key === 'rhythm' && (
              <>
                <Labeled label="起きる時間">
                  <TimeChips
                    value={wakeTime}
                    onChange={setWakeTime}
                    options={['05:30', '06:00', '06:30', '07:00', '07:30', '08:00']}
                  />
                </Labeled>
                <Labeled label="寝る時間">
                  <TimeChips
                    value={sleepTime}
                    onChange={setSleepTime}
                    options={['22:00', '22:30', '23:00', '23:30', '00:00', '01:00']}
                  />
                </Labeled>
                <Note>{sleepHours(wakeTime, sleepTime)} の睡眠です。</Note>
              </>
            )}

            {cur.key === 'equipment' && (
              <>
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
                {/*
                  炊飯器が無い構成を選んだ人には聞かない。
                  「レンジ + コンロ1口」を選んだ直後に炊飯時間を聞かれると、
                  さっき答えたことが効いていないように見える。
                  （鍋で炊く人はあとから設定 › 調理器具で入れられる）
                */}
                {hasRiceCooker && (
                  <Labeled label="ごはんが炊き上がるまで">
                    <Chips
                      options={[20, 30, 40, 50, 60, 70].map((m) => ({ value: m, label: m + '分' }))}
                      value={riceCookMinutes}
                      onChange={setRiceCookMinutes}
                      columns={3}
                    />
                  </Labeled>
                )}
              </>
            )}

            {cur.key === 'shopping' && (
              <>
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
                {/* 週2回作る人は「日曜と水曜」のように分かれる。複数選べる */}
                {!daily && (
                  <Labeled label="作り置きをする曜日">
                    <WeekdayMultiPicker values={prepDays} onChange={setPrepDays} />
                  </Labeled>
                )}
                {/*
                  「1食あたり1000円で組みます」と書いていた。**上限を予定額に読み違える。**
                  実際に出てくる献立は1食 500〜600円で、予算はその上限でしかない。
                  初回に「1食1000円のアプリ」という印象を作っていた。
                */}
                <Note>
                  1食あたり {Math.round(weeklyBudgetYen / Math.max(meals, 1))}{' '}
                  円までで組みます。使い切る必要はありません。
                </Note>
              </>
            )}

            {cur.key === 'keep' && (
              <>
                <Labeled label="冷蔵庫に置く日数">
                  <Chips
                    options={[2, 3, 4, 5].map((d) => ({ value: d, label: d + '日' }))}
                    value={maxFridgeDays}
                    onChange={setMaxFridgeDays}
                    columns={4}
                  />
                </Labeled>
                <Labeled label="冷凍を使いますか">
                  <Segmented
                    options={[
                      { value: 'yes', label: '使う' },
                      { value: 'no', label: '使わない' },
                    ]}
                    value={allowFreezing ? 'yes' : 'no'}
                    onChange={(v: string) => setAllowFreezing(v === 'yes')}
                  />
                </Labeled>
                <Note>
                  {coverDays > maxFridgeDays
                    ? allowFreezing
                      ? maxFridgeDays +
                        '日を超えるぶんは冷凍に回します。食べる前日に冷蔵へ移す指示を出します。'
                      : maxFridgeDays + '日で足りるよう、週の途中でもう一度作る形になります。'
                    : '冷蔵だけで足ります。'}
                </Note>
              </>
            )}

            {cur.key === 'done' && (
              <Summary
                lines={[
                  ['何人ぶん', adults + '人'],
                  [
                    '目標',
                    // 人数ぶんの合計を出す。1人ぶんの数字を出すと、買い出し金額と桁が合わない
                    targets.kcal * adults + ' kcal / たんぱく質 ' + targets.proteinG * adults + ' g',
                  ],
                  [
                    '避けるもの',
                    allergens.length
                      ? allergens.map((a) => ALLERGEN_LABELS[a]).join('・')
                      : '指定なし',
                  ],
                  ['作り方', cadenceLabel(sessions, coverDays)],
                  [
                    '献立',
                    coverDays +
                      '日分 × ' +
                      coverSlots.map((m) => MEAL_SLOT_LABELS[m] + '食').join('・') +
                      '（' +
                      meals +
                      '食）',
                  ],
                  ['食費', '週 ' + weeklyBudgetYen.toLocaleString() + ' 円'],
                  ['保存', '冷蔵 ' + maxFridgeDays + '日まで' + (allowFreezing ? '・冷凍あり' : '')],
                ]}
              />
            )}

            {/*
              最後の画面にも、ここまでと同じ断りを置く。
              **決めきらないと始められない、と思わせない。**
              1問目から「あとから変えられます」と言い続けてきたのに、
              最後だけ言わないと、確定させる画面に見える
            */}
            {cur.key === 'done' && (
              <p className="text-center text-xs text-muted-foreground">
                あとで設定し直せます。
              </p>
            )}
          </Section>
        </div>
      </main>

      <footer className="pf-safe-bottom shrink-0 space-y-2 border-t px-4 py-3">
        {error && (
          <div className="rounded-md border border-primary/50 p-2 text-xs leading-relaxed">
            保存できませんでした（{error}）。もう一度押すか、設定から入り直してください。
          </div>
        )}
        <button
          onClick={next}
          disabled={saving}
          className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background active:scale-[0.99] disabled:opacity-50"
        >
          {last ? (saving ? '作成中…' : 'はじめる') : '次へ'}
        </button>
        <button
          onClick={finish}
          disabled={saving}
          className="min-h-11 w-full text-xs text-muted-foreground"
        >
          あとで設定する
        </button>
      </footer>
    </div>
  );
}

/**
 * どの章にいるか。
 * 一本の進捗バーだと10問が延々続くように見えるが、章で切ると
 * 「いまは暮らしの話」「次で台所」と、残りの形が読める。
 */
function ChapterBar({ current }: { current: string }) {
  const at = CHAPTERS.indexOf(current);
  return (
    <div className="flex shrink-0 gap-1 px-3 pt-2">
      {CHAPTERS.map((c, i) => (
        <div key={c} className="flex-1 space-y-1">
          <div
            className={cn(
              'h-0.5 rounded-full transition-colors',
              // 章そのものが終わっているか、いまその章にいるか
              i < at ? 'bg-foreground' : i === at ? 'bg-foreground' : 'bg-border',
            )}
          />
          <div
            className={cn(
              'truncate text-center text-[9px]',
              i === at ? 'text-foreground' : 'text-muted-foreground/50',
            )}
          >
            {c}
          </div>
        </div>
      ))}
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

/** 選んだ結果がどう効くかを、その場で1行で返す */
function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** 時刻はキーボードを出さずに選べるようにする。指1本で終わらせる */
function TimeChips({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Chips
      options={options.map((t) => ({ value: t, label: t }))}
      value={value}
      onChange={onChange}
      columns={3}
    />
  );
}

/** 最後に、答えたことをまとめて返す。ここまでの手間が形になったことを見せる */
function Summary({ lines }: { lines: [string, string][] }) {
  return (
    <div className="divide-y rounded-lg border">
      {lines.map(([label, value]) => (
        <div key={label} className="flex items-start gap-3 px-4 py-3">
          <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-medium">{value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 起床と就寝から睡眠時間を出す。日をまたぐので単純な引き算にしない */
function sleepHours(wake: string, sleep: string): string {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  let span = toMin(wake) - toMin(sleep);
  if (span <= 0) span += 24 * 60;
  const h = Math.floor(span / 60);
  const m = span % 60;
  return h + '時間' + (m ? m + '分' : '');
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
            <div className="text-xs text-muted-foreground">{i.label}</div>
            <div className="text-base font-semibold tabular-nums">{i.value}</div>
            <div className="text-xs text-muted-foreground">{i.unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
