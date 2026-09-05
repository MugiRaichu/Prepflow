/**
 * 起床・就寝・習慣から1日のスケジュールを組む。
 *
 * すべて逆算で決める。基準は2つだけ。
 *   - 起床時刻（朝食と体内時計の起点）
 *   - 就寝時刻（夕食・カフェイン・就寝前タンパク質の締切の起点）
 *
 * 根拠は db/data/knowledge.ts に出典つきで置き、ここは時刻の計算だけを持つ。
 */
import type { Habit, MealSlot, TimeOfDay, Weekday } from '@/db/schema';
import type { DailyRhythm } from '@/db/schema';

export type EntryKind =
  | 'wake'
  | 'meal'
  | 'training'
  | 'habit'
  | 'event'
  | 'cook'
  | 'protein'
  | 'caffeine_cutoff'
  | 'winddown'
  | 'sleep';

/** カレンダーから来た予定。件名と時刻だけ */
export interface CalendarBlock {
  title: string;
  start: TimeOfDay;
  end?: TimeOfDay;
}

export interface TimelineEntry {
  time: TimeOfDay;
  /** 終了時刻（幅のある予定のみ） */
  endTime?: TimeOfDay;
  kind: EntryKind;
  label: string;
  /** 補足。1行 */
  note?: string;
  /** 「なぜ？」で開く知見のID */
  knowledgeId?: string;
  /** 予定に合わせて動いた時刻かどうか */
  adjusted?: boolean;
}

// --- 時刻の計算（分に直して扱う） -------------------------------------------

export const toMin = (t: TimeOfDay): number => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** 15分刻みに丸める。13:56 のような時刻は生活の指示として使いにくい */
export const roundTo15 = (min: number): number => Math.round(min / 15) * 15;

export const toTime = (min: number): TimeOfDay => {
  const wrapped = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
};

/** 起床を起点に、就寝が翌日にまたぐ場合も一直線に扱う */
function sleepMinFrom(wake: number, sleep: number): number {
  return sleep <= wake ? sleep + 1440 : sleep;
}

export interface BuildTimelineInput {
  rhythm: DailyRhythm;
  habits: Habit[];
  weekday: Weekday;
  /** カバーしている食事枠。作り置きの対象を示すのに使う */
  coverSlots: MealSlot[];
  /**
   * その日のカレンダーの予定。毎週の習慣と違い、日ごとに変わるもの。
   * 食事と重なれば食事を動かし、夕方の予定が長引けば夕食を後ろへ送る。
   */
  events?: CalendarBlock[];
  /**
   * その日に作る場合の、手を動かす時間（分）。
   * 渡すと「作る」の枠が夕食の前に入り、夕方の予定の後に収まるよう夕食も動く。
   * 作り置きを食べるだけの日は渡さない。
   */
  cookMinutes?: number;
}

export function buildTimeline(input: BuildTimelineInput): TimelineEntry[] {
  const { rhythm, habits, weekday } = input;
  const wake = toMin(rhythm.wakeTime);
  const sleep = sleepMinFrom(wake, toMin(rhythm.sleepTime));
  const awake = sleep - wake;

  const todays = habits
    .filter((h) => h.deleted === 0 && h.days.includes(weekday))
    .map((h) => {
      const start = toMin(h.startTime);
      return { ...h, startMin: start < wake ? start + 1440 : start };
    })
    .sort((a, b) => a.startMin - b.startMin);

  const training = todays.find((h) => h.kind === 'training');

  const out: TimelineEntry[] = [];

  out.push({
    time: toTime(wake),
    kind: 'wake',
    label: '起床',
    note: '起きる時刻が毎日ほぼ同じだと、体内時計が安定します',
    knowledgeId: 'meal_regularity',
  });

  // 朝食は起床の30〜60分後。体内時計を合わせる手がかりになる
  const breakfast = roundTo15(wake + 45);
  out.push({
    time: toTime(breakfast),
    kind: 'meal',
    label: '朝食',
    note: '起床からおよそ45分後',
    knowledgeId: 'meal_regularity',
  });

  // 昼食は起床と就寝のほぼ中間。予定と重なれば予定のあとへ（下で確定する）
  let lunch = roundTo15(wake + awake * 0.42);
  let lunchAdjusted = false;

  // カレンダーの予定。起床を0時とした軸に直す
  const blocks = (input.events ?? [])
    .map((e) => {
      const s = toMin(e.start);
      const startMin = s < wake ? s + 1440 : s;
      const rawEnd = e.end ? toMin(e.end) : s + 60;
      const endMin = rawEnd < startMin ? rawEnd + 1440 : rawEnd;
      return { title: e.title, startMin, endMin };
    })
    .filter((b) => b.endMin > b.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  for (const b of blocks) {
    out.push({
      time: toTime(b.startMin),
      endTime: toTime(b.endMin),
      kind: 'event',
      label: b.title,
    });
  }

  const lunchClash = blocks.find((b) => b.startMin <= lunch && lunch < b.endMin);
  if (lunchClash) {
    lunch = roundTo15(lunchClash.endMin);
    lunchAdjusted = true;
  }
  out.push({
    time: toTime(lunch),
    kind: 'meal',
    label: '昼食',
    ...(lunchAdjusted ? { note: '予定のあと', adjusted: true } : {}),
  });

  // 夕食は就寝の2.5時間前が上限。トレーニングがあればそれも見る
  let dinner = roundTo15(sleep - 150);
  let dinnerNote = '就寝の2時間半前まで';
  let dinnerAdjusted = false;

  if (training) {
    const tStart = training.startMin;
    const tEnd = tStart + training.durationMin;

    // トレ前の食事: 開始2時間前までに済ませる（消化のため）
    const preGap = tStart - lunch;
    out.push({
      time: toTime(tStart),
      endTime: toTime(tEnd),
      kind: 'training',
      label: training.name,
      note:
        preGap >= 120
          ? '前の食事から' + Math.round(preGap / 60) + '時間空いています'
          : '前の食事から間隔が短いので、軽めに',
      knowledgeId: 'training_fasted',
    });

    // トレ後の食事。「30分以内」ではない。前の食事から4〜6時間の窓に入っていればよい
    const afterTraining = tEnd + 30;
    if (afterTraining > dinner) {
      dinner = roundTo15(Math.min(afterTraining, sleep - 90));
      dinnerNote = 'トレーニング後。前の食事から4〜6時間の窓に収まっています';
      dinnerAdjusted = true;
    } else {
      dinnerNote = 'トレーニング後。急いで摂る必要はありません';
    }
  }

  // 夕方の予定が終わってから作り、それから食べる。
  // 予定が長引く日に「20:30 夕食」と出しても守れないので、予定の終わりから積む
  const cook = Math.max(0, Math.round(input.cookMinutes ?? 0));
  const evening = blocks.filter((b) => b.endMin > lunch);
  const busyUntil = evening.length > 0 ? Math.max(...evening.map((b) => b.endMin)) : null;
  if (busyUntil != null && busyUntil + 15 + cook > dinner) {
    // 切り上げる。切り捨てると「作る」が予定の終わりより前に始まってしまう
    dinner = Math.min(Math.ceil((busyUntil + 15 + cook) / 15) * 15, roundTo15(sleep - 90));
    dinnerNote = cook > 0 ? '予定のあとに作ってから' : '予定のあと';
    dinnerAdjusted = true;
  }

  if (cook > 0) {
    out.push({
      time: toTime(dinner - cook),
      endTime: toTime(dinner),
      kind: 'cook',
      label: '今日のぶんを作る',
      note: '手を動かす時間の見込み ' + cook + '分',
    });
  }

  out.push({
    time: toTime(dinner),
    kind: 'meal',
    label: '夕食',
    note: dinnerNote,
    knowledgeId: training ? 'protein_timing' : 'dinner_before_sleep',
    ...(dinnerAdjusted ? { adjusted: true } : {}),
  });

  // カフェインの締切: 就寝の7時間前（半減期5〜6時間の中間を取る）
  if (rhythm.caffeine) {
    const cutoff = sleep - 420;
    if (cutoff > wake) {
      out.push({
        time: toTime(cutoff),
        kind: 'caffeine_cutoff',
        label: 'カフェインはここまで',
        note: '就寝の7時間前',
        knowledgeId: 'caffeine_cutoff',
      });
    }
  }

  // 就寝前のタンパク質
  if (rhythm.preSleepProtein) {
    out.push({
      time: toTime(sleep - 45),
      kind: 'protein',
      label: '就寝前のタンパク質',
      note: '1日の合計量の中から回します。足すのではありません',
      knowledgeId: 'pre_sleep_protein',
    });
  }

  // 寝る前の1時間
  out.push({
    time: toTime(sleep - 60),
    kind: 'winddown',
    label: '照明を落とす',
    note: '入眠が早まると、最初の深い眠りも前に来ます',
    knowledgeId: 'winddown',
  });

  // 固定の習慣（通勤・入浴など）
  for (const h of todays) {
    if (h.kind === 'training') continue;
    out.push({
      time: toTime(h.startMin),
      endTime: toTime(h.startMin + h.durationMin),
      kind: 'habit',
      label: h.name,
    });
  }

  out.push({
    time: toTime(sleep),
    kind: 'sleep',
    label: '就寝',
    note: 'ここから60〜90分の深い眠りが要になります',
    knowledgeId: 'sleep_golden_time',
  });

  // 起床を0時とした軸で並べ替える（日をまたいでも順序が崩れない）
  const key = (e: TimelineEntry) => {
    const m = toMin(e.time);
    return m < wake ? m + 1440 : m;
  };
  return out.sort((a, b) => key(a) - key(b));
}

/** 起床から就寝までの時間（分）。睡眠時間の警告に使う */
export function sleepDurationMin(rhythm: DailyRhythm): number {
  const wake = toMin(rhythm.wakeTime);
  const sleep = sleepMinFrom(wake, toMin(rhythm.sleepTime));
  return 1440 - (sleep - wake);
}
