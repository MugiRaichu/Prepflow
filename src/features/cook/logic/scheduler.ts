/**
 * 並行調理のスケジューラ。
 *
 * 解いているのは「資源制約つきスケジューリング」。資源は2種類ある。
 *   - 機器（コンロの口数、レンジの台数）: durationSec のあいだ占有される
 *   - 人（1人）: handsOnSec のあいだだけ拘束される
 *
 * この2つを分けているのが要点。「レンジで5分加熱」は機器を5分押さえるが
 * 人は拘束しないので、その5分に別の作業を入れられる。
 * 人を1人の資源として扱わないと「同時に3品炒める」ような非現実的な段取りが出る。
 *
 * 厳密な最適解を出す問題ではない（NP困難）ので、
 * 「残り経路が長いタスクを優先し、最も早く置ける場所に置く」貪欲法で解く。
 * 手順数はせいぜい数十なので、これで実用上は十分に詰まる。
 */
import type { CookTask, ScheduledTask, ScheduleResult, SchedulerInput } from './types';

/** 空き時間を探すための占有区間 */
interface Busy {
  start: number;
  end: number;
}

/** from 以降で length ぶんの空きが取れる最初の時刻 */
function earliestFree(busy: Busy[], from: number, length: number): number {
  if (length <= 0) return from;
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  let t = from;
  for (const b of sorted) {
    if (b.end <= t) continue;
    if (t + length <= b.start) return t;
    t = Math.max(t, b.end);
  }
  return t;
}

const overlaps = (busy: Busy[], start: number, length: number): boolean =>
  length > 0 && busy.some((b) => start < b.end && start + length > b.start);

/** レシピ × バッチ数 をタスク列に展開する */
export function buildTasks(items: SchedulerInput['items']): CookTask[] {
  const out: CookTask[] = [];
  for (const { recipe, batches } of items) {
    for (let b = 0; b < batches; b++) {
      const idOf = (stepIndex: number) => recipe.id + ':' + b + ':' + stepIndex;
      for (const step of recipe.steps) {
        out.push({
          id: idOf(step.index),
          recipeId: recipe.id,
          recipeTitle: recipe.title + (batches > 1 ? '（' + (b + 1) + '回目）' : ''),
          batchIndex: b,
          stepIndex: step.index,
          label: step.text,
          durationSec: step.durationSec,
          handsOnSec: step.handsOnSec,
          ...(step.equipmentKind ? { equipmentKind: step.equipmentKind } : {}),
          dependsOn: step.dependsOn.map(idOf),
        });
      }
    }
  }
  return out;
}

/** 各タスクから終端までの最長経路。長いものを先に置く */
function criticalLengths(tasks: CookTask[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const successors = new Map<string, string[]>();
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (!successors.has(d)) successors.set(d, []);
      successors.get(d)!.push(t.id);
    }
  }

  const memo = new Map<string, number>();
  const visit = (id: string): number => {
    const cached = memo.get(id);
    if (cached != null) return cached;
    const t = byId.get(id);
    if (!t) return 0;
    // 循環していたら 0 で打ち切る（シードのバグ対策）
    memo.set(id, 0);
    const succ = successors.get(id) ?? [];
    const best = succ.reduce((m, s) => Math.max(m, visit(s)), 0);
    const v = t.durationSec + best;
    memo.set(id, v);
    return v;
  };

  for (const t of tasks) visit(t.id);
  return memo;
}

export function schedule(input: SchedulerInput): ScheduleResult {
  const tasks = buildTasks(input.items);
  if (tasks.length === 0) {
    return {
      tasks: [],
      makespanSec: 0,
      handsOnSec: 0,
      idleSec: 0,
      sequentialSec: 0,
      lanes: 0,
      bottlenecks: [],
    };
  }

  const priority = criticalLengths(tasks);

  // 機器はスロットごとに占有表を持つ。コンロ3口なら3本
  const slotsByKind = new Map<string, { id: string; name: string; slot: number; busy: Busy[] }[]>();
  for (const e of input.equipment) {
    const list = slotsByKind.get(e.kind) ?? [];
    for (let i = 0; i < e.slots; i++) {
      list.push({ id: e.id, name: e.name, slot: i, busy: [] });
    }
    slotsByKind.set(e.kind, list);
  }

  const cookBusy: Busy[] = [];
  const placed = new Map<string, ScheduledTask>();
  const remaining = new Set(tasks.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const waited = new Map<string, number>();

  while (remaining.size > 0) {
    // 先行タスクが全部置き終わっているものだけが候補
    const ready = [...remaining]
      .map((id) => byId.get(id)!)
      .filter((t) => t.dependsOn.every((d) => !remaining.has(d)));

    if (ready.length === 0) {
      // 依存が壊れている。残りを直列に並べて破綻を可視化する
      let t = Math.max(0, ...[...placed.values()].map((p) => p.endSec));
      for (const id of remaining) {
        const task = byId.get(id)!;
        placed.set(id, { ...task, startSec: t, endSec: t + task.durationSec, lane: 0, critical: false });
        t += task.durationSec;
      }
      break;
    }

    interface SlotRef {
      id: string;
      name: string;
      slot: number;
      busy: Busy[];
    }
    let best: { task: CookTask; start: number; slotRef?: SlotRef; waitSec?: number } | null = null;

    for (const task of ready) {
      // 先行タスクが全部終わる時刻より前には始められない
      const depReady = task.dependsOn.reduce(
        (m, d) => Math.max(m, placed.get(d)?.endSec ?? 0),
        0,
      );

      const slots = task.equipmentKind ? (slotsByKind.get(task.equipmentKind) ?? []) : [];

      if (task.equipmentKind && slots.length === 0) {
        // 持っていない器具の手順。器具なしで進めるしかないので、人の空きだけ見る
        const start = earliestFree(cookBusy, depReady, task.handsOnSec);
        if (!best || start < best.start || (start === best.start && priorityOf(task) > priorityOf(best.task))) {
          best = { task, start };
        }
        continue;
      }

      if (slots.length === 0) {
        const start = earliestFree(cookBusy, depReady, task.handsOnSec);
        if (!best || start < best.start || (start === best.start && priorityOf(task) > priorityOf(best.task))) {
          best = { task, start };
        }
        continue;
      }

      // 機器と人の両方が空く最初の時刻を、スロットごとに探して最良を取る
      for (const s of slots) {
        let t = depReady;
        for (let guard = 0; guard < 200; guard++) {
          const eqStart = earliestFree(s.busy, t, task.durationSec);
          const cookStart = earliestFree(cookBusy, eqStart, task.handsOnSec);
          if (cookStart === eqStart) {
            t = eqStart;
            break;
          }
          // 人が空くまで待つと機器がふさがるかもしれない。やり直す
          t = cookStart;
          if (!overlaps(s.busy, t, task.durationSec)) break;
        }
        if (!best || t < best.start || (t === best.start && priorityOf(task) > priorityOf(best.task))) {
          best = { task, start: t, slotRef: s, waitSec: Math.max(t - depReady, 0) };
        }
      }
    }

    function priorityOf(t: CookTask) {
      return priority.get(t.id) ?? 0;
    }

    if (!best) break;

    const { task, start, slotRef } = best;
    // 実際に置いたものだけを待ち時間として数える
    if (slotRef && (best.waitSec ?? 0) > 0) {
      waited.set(slotRef.name, (waited.get(slotRef.name) ?? 0) + (best.waitSec ?? 0));
    }
    if (slotRef) slotRef.busy.push({ start, end: start + task.durationSec });
    if (task.handsOnSec > 0) cookBusy.push({ start, end: start + task.handsOnSec });

    placed.set(task.id, {
      ...task,
      startSec: start,
      endSec: start + task.durationSec,
      ...(slotRef ? { equipmentId: slotRef.id, equipmentName: slotRef.name, slot: slotRef.slot } : {}),
      lane: 0,
      critical: false,
    });
    remaining.delete(task.id);
  }

  const scheduled = [...placed.values()].sort((a, b) => a.startSec - b.startSec);
  const makespan = Math.max(0, ...scheduled.map((t) => t.endSec));
  const handsOn = scheduled.reduce((n, t) => n + t.handsOnSec, 0);
  const sequential = scheduled.reduce((n, t) => n + t.durationSec, 0);

  assignLanes(scheduled);
  markCritical(scheduled, makespan);

  return {
    tasks: scheduled,
    makespanSec: makespan,
    handsOnSec: handsOn,
    idleSec: Math.max(makespan - handsOn, 0),
    sequentialSec: sequential,
    lanes: Math.max(1, ...scheduled.map((t) => t.lane + 1)),
    bottlenecks: [...waited.entries()]
      .filter(([, v]) => v > 60)
      .sort((a, b) => b[1] - a[1])
      .map(([equipmentName, waitedSec]) => ({ equipmentName, waitedSec })),
  };
}

/** 重ならないように行へ振り分ける。ガントの描画用 */
function assignLanes(tasks: ScheduledTask[]): void {
  const laneEnds: number[] = [];
  for (const t of tasks) {
    let lane = laneEnds.findIndex((end) => end <= t.startSec);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = t.endSec;
    t.lane = lane;
  }
}

/**
 * 終了時刻から逆にたどって、遅らせると全体が延びるタスクに印を付ける。
 * ここを縮めない限り全体は縮まない、という説明に使う。
 */
function markCritical(tasks: ScheduledTask[], makespan: number): void {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const stack = tasks.filter((t) => t.endSec === makespan).map((t) => t.id);
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    if (!t) continue;
    t.critical = true;
    for (const d of t.dependsOn) {
      const dep = byId.get(d);
      if (dep && dep.endSec === t.startSec) stack.push(d);
    }
  }
}
