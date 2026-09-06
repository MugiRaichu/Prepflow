/**
 * 週の献立ソルバー。LLM は使わない（D-011 / D-018）。
 *
 * これは探索問題であって推論ではない。予算・PFC・器具・嗜好という制約を
 * 同時に満たす組合せを、全数に近い探索で選ぶ。決定論的なので、
 * 同じ入力からは必ず同じ結果が出る（同じ献立が再現できる）。
 *
 * 構造:
 *   1食 = 主菜の配分 + 副菜の配分 + ごはん
 *   たんぱく質は主菜から、炭水化物はごはんの量で調整する。
 *
 * バッチ単位で考えるのが要点。3食分だけ欲しくても鍋は1回分作るので、
 * 原価も時間もバッチ単位で発生する。作った分はカバーする食数で等分する。
 */
import { totalMinutes, handsOnMinutes } from '@/db/data/build';
import { timeMetric } from './time';
import type { AllergenTag, Macros, Recipe } from '@/db/schema';
import type { PlanItem, SolveInput, SolveResult, WeekPlanCandidate } from './types';

const MAX_BATCHES = 2;
// 希望を課すと2品では必ず溢れる場合がある。1品も許すが、単調さはスコアで戻す
const MIN_PICK = 1;
/** 品数の上限。飽きの許容範囲によってはここまで増やす */
const MAX_PICK_HARD = 7;

/**
 * 何品まで選ぶか。食数と「同じ主菜を何食まで許すか」から決まる。
 *
 * 14食を主菜2品で埋めれば1品あたり7食で、朝昼晩ずっと同じものになる。
 * 3食までしか許さないなら最低5品要る。品数はユーザーに聞かず、ここで導く。
 */
function pickRange(meals: number, maxSameDishMeals: number): number {
  const needed = Math.ceil(meals / Math.max(maxSameDishMeals, 1));
  return Math.min(Math.max(needed, 3), MAX_PICK_HARD);
}

/**
 * 品数が増えたら1品あたりの仕込みは1回に絞る。
 * 5品×2回=10回分も作ると量が過剰になるうえ、組合せが跳ね上がる。
 */
const maxBatchesFor = (k: number): number => (k >= 4 ? 1 : MAX_BATCHES);
/**
 * 脂質の上限（目標に対する比）。下限だけだと、希望に寄せた結果として
 * 脂質が4割増しの案が勝つことがある。カロリーが同じなら炭水化物が削られる。
 */
const MAX_FAT_RATIO = 1.35;

/** 1食あたりのごはんは 0〜2 人前まで */
const RICE_MAX = 2;
/** ごはんの最小単位。茶碗に軽く1杯が約0.5人前（83g）。これより細かく刻んでも盛れない */
export const RICE_STEP = 0.5;

/** 組合せ列挙（サイズ k） */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i <= arr.length - (k - cur.length); i++) {
      cur.push(arr[i]!);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

/** バッチ数の全パターン（各 1..max） */
function batchPatterns(n: number, max: number): number[][] {
  let out: number[][] = [[]];
  for (let i = 0; i < n; i++) {
    const next: number[][] = [];
    for (const p of out) for (let b = 1; b <= max; b++) next.push([...p, b]);
    out = next;
  }
  return out;
}

const scaleMacros = (m: Macros, k: number): Macros => ({
  kcal: m.kcal * k,
  proteinG: m.proteinG * k,
  fatG: m.fatG * k,
  carbG: m.carbG * k,
});

const addMacros = (a: Macros, b: Macros): Macros => ({
  kcal: a.kcal + b.kcal,
  proteinG: a.proteinG + b.proteinG,
  fatG: a.fatG + b.fatG,
  carbG: a.carbG + b.carbG,
});

const ZERO: Macros = { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 };

/** ハード制約: 禁止食材を含むレシピを落とす */
function isBanned(r: Recipe, banned: Set<string>): boolean {
  return r.ingredients.some((i) => banned.has(i.ingredientId));
}

/**
 * ハード制約: 避けるアレルゲンを含むレシピを落とす。
 * Recipe.allergens は材料の allergens を集計したもの（build.ts）。
 * ここは**何があっても緩めない**。緩和ラダーの対象にもしない。
 */
function hasBannedAllergen(r: Recipe, banned: Set<AllergenTag>): boolean {
  if (banned.size === 0) return false;
  return r.allergens.some((a) => banned.has(a));
}

/** ソフト制約: 苦手食材の重みの合計 */
function dislikePenalty(r: Recipe, disliked: Map<string, number>): number {
  let p = 0;
  for (const i of r.ingredients) p += disliked.get(i.ingredientId) ?? 0;
  return p;
}

/** 保存日数が足りるか。冷凍を許すなら冷凍で逃がせる */
function keepsLongEnough(r: Recipe, days: number, allowFreezing: boolean): boolean {
  if (r.storage.location === 'freezer') return allowFreezing;
  return r.storage.keepsDays >= days;
}

interface SubPlan {
  items: PlanItem[];
  macrosPerMeal: Macros;
  costYen: number;
  rawMin: number;
  handsMin: number;
  penalty: number;
}

/**
 * 掃引（sweep）の幅。
 *
 * 組合せの数は候補数 n に対して C(n, k) で増える。主菜47品・k=7 なら
 * 629億通りで、総当たりは何をしても終わらない。
 *
 * かといって**候補を上位20件に切り詰めるのは間違いだった。**残り27品が
 * 最初から検討されず、「その条件に合う献立はあるのに見つからない」が起きる。
 *
 * 代わりに、品数を1品ずつ増やしながら掃いていく。各段で
 *   - **全候補を試す**（どのレシピも毎回、追加の対象になる）
 *   - 栄養の升目で間引いて、次の段へ持ち越す数だけを抑える
 * 持ち越す数は抑えるが、選ばれ得るレシピは1品も落とさない。
 */
const SWEEP_PER_BUCKET = 4;
const SWEEP_MAX_STATES = 6000;

/** 総当たりで済ませる品数の上限。ここまでは間引かずに厳密に見る */
const EXACT_MAX_PICK = 3;

/** 総当たりの打ち切り。候補が極端に多いときの保険（通常は届かない） */
const EXACT_MAX_NODES = 400_000;

/**
 * 組合せを1品ずつ積んでいくときの中間値。
 * 総当たりと掃引で同じ足し算を使うために切り出してある。
 */
interface Acc {
  macros: Macros;
  costYen: number;
  rawMin: number;
  handsMin: number;
  penalty: number;
  totalServings: number;
}

const emptyAcc = (): Acc => ({
  macros: ZERO,
  costYen: 0,
  rawMin: 0,
  handsMin: 0,
  penalty: 0,
  totalServings: 0,
});

/**
 * 掃引の途中経過。どこまで進んだか（last）と、積んだ中身。
 *
 * `tags` は「今週の希望」のタグごとに積んだ人前。間引くときの升の鍵に使う。
 * **毎回 items を走査し直すと、状態が数十万あるので効かない**
 * （実測で1回の解に18秒かかった）。足すときに一緒に持ち上げる。
 */
interface State {
  last: number;
  items: PlanItem[];
  acc: Acc;
  tags: number[];
}

/**
 * 1品足す。**足した時点で通らないと分かるものは null を返す。**
 *
 * 原価もカロリーもたんぱく質も「足すだけ」の関係なので、途中で上限を
 * 超えた組合せは、この先に何を足しても通らない。ここで落としても
 * 見つかる献立は1つも減らない（漏れのない枝刈り）。
 */
function extend(acc: Acc, r: Recipe, batches: number, input: SolveInput): Acc | null {
  const totalServings = batches * r.servings;
  // 1食に同じ品を3人前は誰も食べない。数字の上で目標に合っても食べきれない
  if (totalServings / input.meals > 3) return null;

  const costYen = acc.costYen + (input.costOverride?.get(r.id) ?? r.estimatedCostYen ?? 0) * batches;
  if (costYen > input.budgetYen) return null;

  const macros = addMacros(acc.macros, scaleMacros(r.nutritionPerServing, totalServings));
  if (macros.kcal / input.meals > input.target.kcal * (1 + input.maxKcalDeviation)) return null;
  if (macros.proteinG / input.meals > input.target.proteinG * (1 + input.maxProteinDeviation)) {
    return null;
  }

  // 1食に同じ品を2人前も3人前も詰めるのは現実的でない。
  // 数字の上では目標に合っても、実際には食べきれず飽きる
  const perMeal = totalServings / input.meals;
  let penalty = acc.penalty + dislikePenalty(r, input.dislikedIngredientIds);
  if (perMeal > 1.5) penalty += (perMeal - 1.5) * 0.5;
  if (input.recentRecipeIds.has(r.id)) penalty += 0.4;

  return {
    macros,
    costYen,
    rawMin: acc.rawMin + totalMinutes(r) * batches,
    handsMin: acc.handsMin + handsOnMinutes(r) * batches,
    penalty,
    totalServings: acc.totalServings + totalServings,
  };
}

/**
 * 升の中から残すものを選ぶ。
 *
 * 「良い順に n 件」では駄目だった。**制約が効くのは端**で、
 * いちばん速い案・いちばん安い案が升の中で2位以下だと、そのまま消える。
 * 実際、これを入れる前は「1日10分で作る」が解なしになった
 * （11分の案は残り、10分の案が総合順位で負けて落ちていた）。
 *
 * 先に各軸の最小を確保してから、残り枠を総合順に埋める。
 */
function keepFrontier<T extends object>(
  list: T[],
  limit: number,
  rank: (a: T, b: T) => number,
  axes: ((x: T) => number)[],
): T[] {
  if (list.length <= limit) return list;
  const picked = new Set<T>();
  for (const axis of axes) {
    let best = list[0]!;
    for (const x of list) if (axis(x) < axis(best)) best = x;
    picked.add(best);
  }
  for (const x of [...list].sort(rank)) {
    if (picked.size >= limit) break;
    picked.add(x);
  }
  return [...picked];
}

/**
 * 次の段へ持ち越す途中経過を間引く。
 *
 * 栄養の升目（カロリーとたんぱく質）で分けて、升ごとに上位だけ残す。
 * 升の中で選ぶ基準は「嫌いなものが少ない・安い・速い」。
 *
 * 「今週の希望」があるときは、希望のタグを何人前積んでいるかも升の鍵に足す。
 * これを入れないと、栄養が同じという理由でパスタ入りの途中経過が全部消え、
 * 最後に「パスタ3食」を満たせなくなる。
 */
function thinStates(states: State[], input: SolveInput): State[] {
  const buckets = new Map<string, State[]>();
  for (const s of states) {
    const per = s.acc.macros;
    let key =
      Math.round(per.kcal / (BUCKET_KCAL * input.meals)) +
      ':' +
      Math.round(per.proteinG / (BUCKET_PROTEIN * input.meals));
    /*
     * 希望のタグを何人前積んでいるか。**粗く見る。**
     * 1人前きざみで升を分けると升の数が跳ね上がる。
     * レシピ1品はおおむね4人前なので、4人前きざみ（＝何品ぶんか）で足りる。
     */
    for (const t of s.tags) key += ':' + Math.round(t / 4);
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  }

  const rank = (a: State, b: State) =>
    a.acc.penalty - b.acc.penalty || a.acc.costYen - b.acc.costYen || a.acc.handsMin - b.acc.handsMin;

  const out: State[] = [];
  for (const list of buckets.values()) {
    out.push(
      ...keepFrontier(list, SWEEP_PER_BUCKET, rank, [
        (s) => s.acc.handsMin,
        (s) => s.acc.costYen,
      ]),
    );
  }
  // 升の数そのものが増えすぎたときの保険。良い順に残す
  if (out.length > SWEEP_MAX_STATES) {
    out.sort(rank);
    out.length = SWEEP_MAX_STATES;
  }
  return out;
}

/** 主菜または副菜の候補を列挙する */
function buildSubPlans(
  pool: Recipe[],
  input: SolveInput,
  rejections: Record<string, number>,
  /** 主菜のときだけ「今週の希望」を課す */
  applyRequests: boolean,
): SubPlan[] {
  const filtered = pool.filter((r) => {
    if (hasBannedAllergen(r, input.bannedAllergens)) {
      rejections['アレルゲンを含む'] = (rejections['アレルゲンを含む'] ?? 0) + 1;
      return false;
    }
    if (isBanned(r, input.bannedIngredientIds)) {
      rejections['アレルゲン・除外食材'] = (rejections['アレルゲン・除外食材'] ?? 0) + 1;
      return false;
    }
    // その日に作って食べるなら保存日数は関係ない
    if (input.mode !== 'daily' && !keepsLongEnough(r, input.maxFridgeDays, input.allowFreezing)) {
      rejections['保存日数が足りない'] = (rejections['保存日数が足りない'] ?? 0) + 1;
      return false;
    }
    if (input.avoidTags.some((t) => r.tags.includes(t))) {
      rejections['今週は避けたい食材'] = (rejections['今週は避けたい食材'] ?? 0) + 1;
      return false;
    }
    return true;
  });

  /*
   * 指名された料理は**必ず入れる**。
   *
   * 探索の出発点にすることで実現する。候補を全部並べてから「指名を含むもの」を
   * 選り分けるのではなく、指名を積んだ状態から始めて残りを足す。
   * 探索の量も減る（指名した品数ぶん、深さが浅くて済む）。
   *
   * 並び順を変えて指名を先頭に持ってくるのは、掃引が「最後に足した位置より
   * 後ろ」だけを見る作りだから。先頭に置けば、指名を二度足すことがない。
   */
  const pinnedIds = input.pinnedRecipeIds;
  const pinned = pinnedIds?.size ? filtered.filter((r) => pinnedIds.has(r.id)) : [];
  const usable =
    pinned.length > 0
      ? [...pinned, ...filtered.filter((r) => !pinnedIds!.has(r.id))]
      : filtered;

  // 品数は飽きの許容範囲から決める。主菜も副菜も同じ扱いにする。
  // 主菜だけ日替わりにしても、副菜が14食とも同じなら皿の見た目は変わらない
  const maxPick = Math.min(pickRange(input.meals, input.maxSameDishMeals), usable.length);
  const out: SubPlan[] = [];

  /**
   * 選び終えた組合せを1つの案にする。
   * 通らない条件はここで落とす（どれも組合せ全体が揃わないと判定できない）。
   */
  const finish = (items: PlanItem[], acc: Acc): SubPlan | null => {
    let penalty = acc.penalty;

    // 同じ料理が何食に載るかを見て、飽きの許容範囲を超える案を落とす。
    // 総人前に対する比率から食数を見積もる（実際の割り振りは distribute.ts）
    if (acc.totalServings > 0) {
      const worstMeals = Math.max(
        ...items.map((it) => (it.totalServings * input.meals) / acc.totalServings),
      );
      if (worstMeals > input.maxSameDishMeals + 1e-6) {
        rejections['同じ料理が続きすぎる'] = (rejections['同じ料理が続きすぎる'] ?? 0) + 1;
        return null;
      }
    }

    // 「パスタを3食」のような希望を満たすか。人前の比率で判定する。
    //
    // 下限を満たすだけだと、希望を入れる前と同じ献立がそのまま返ることがある
    // （もともと鶏肉が入っていれば「鶏肉2日」は自動的に満たされる）。
    // 利用者からは「選んでも反映されない」ようにしか見えないので、
    // **満たした度合いをスコアでも報いる**。多く入っている案が勝つ
    if (applyRequests && input.requiredTagMeals.length > 0) {
      for (const req of input.requiredTagMeals) {
        const tagged = items
          .filter((it) => it.recipe.tags.includes(req.tag))
          .reduce((n, it) => n + it.totalServings, 0);
        // 週の食数に対する希望の割合ぶんの人前が要る
        const need = (acc.totalServings * req.meals) / input.meals;
        if (tagged < need - 1e-6) {
          rejections['今週の希望に届かない'] = (rejections['今週の希望に届かない'] ?? 0) + 1;
          return null;
        }
        // 希望のぶんを超えて入っているほど軽くする。
        // 強くしすぎると栄養の乖離に勝ってしまい、希望は叶うが献立が歪む
        const surplus = need > 0 ? Math.min((tagged - need) / need, 1) : 0;
        penalty -= surplus * 0.3;
      }
    }

    return {
      items,
      macrosPerMeal: scaleMacros(acc.macros, 1 / input.meals),
      costYen: acc.costYen,
      rawMin: acc.rawMin,
      handsMin: acc.handsMin,
      penalty,
    };
  };

  /*
   * 品数の少ないほうは総当たりで見る。
   * C(n,3) までなら数が知れているので、間引かずに厳密に扱う。
   * 仕込みを2回に増やせるのもここだけ（maxBatchesFor）。
   */
  let nodes = 0;
  // 指名は必ず入るので、残りの枠だけを総当たりする
  const rest = usable.slice(pinned.length);
  for (let k = Math.max(MIN_PICK, pinned.length); k <= Math.min(maxPick, EXACT_MAX_PICK); k++) {
    for (const tail of combinations(rest, k - pinned.length)) {
      const combo = [...pinned, ...tail];
      if (nodes > EXACT_MAX_NODES) break;
      for (const batches of batchPatterns(k, maxBatchesFor(k))) {
        nodes++;
        const items: PlanItem[] = [];
        let acc = emptyAcc();
        let ok = true;
        for (let i = 0; i < combo.length; i++) {
          const next = extend(acc, combo[i]!, batches[i]!, input);
          if (!next) {
            ok = false;
            break;
          }
          items.push({ recipe: combo[i]!, batches: batches[i]!, totalServings: batches[i]! * combo[i]!.servings });
          acc = next;
        }
        if (!ok) continue;
        const plan = finish(items, acc);
        if (plan) out.push(plan);
      }
    }
  }

  /*
   * 品数の多いほうは掃引で見る。
   *
   * 1品ずつ増やしながら、**毎回すべての候補を追加の対象にする**。
   * 段ごとに栄養の升目で間引いて次へ持ち越すので、状態数は一定に収まる。
   * 落とすのは「栄養がほとんど同じ、中身違いの途中経過」だけで、
   * レシピそのものは1品も候補から外れない。
   */
  if (maxPick > EXACT_MAX_PICK) {
    // 希望のタグを持つかどうかは候補ごとに決まっている。毎回 tags を引き直さない
    const reqs = applyRequests ? input.requiredTagMeals : [];
    const tagged = usable.map((r) => reqs.map((q) => (r.tags.includes(q.tag) ? r.servings : 0)));

    /*
     * 掃引の出発点。仕込みは1回（maxBatchesFor が 4品以上で 1 を返すのと同じ扱い）。
     *
     * 指名がある場合は、**それを積んだ1つの状態から始める。**
     * 候補を全部並べてから選り分けるのではなく、必ず入るものを先に積む。
     * 指名は usable の先頭に並べてあるので、以降は「後ろだけを見る」規則のまま
     * 二度足しにならない。
     */
    let states: State[];
    let startDepth: number;

    if (pinned.length > 0) {
      let acc: Acc | null = emptyAcc();
      const items: PlanItem[] = [];
      const tags = reqs.map(() => 0);
      for (let i = 0; i < pinned.length && acc; i++) {
        const r = pinned[i]!;
        acc = extend(acc, r, 1, input);
        items.push({ recipe: r, batches: 1, totalServings: r.servings });
        for (let q = 0; q < reqs.length; q++) tags[q]! += tagged[i]![q]!;
      }
      states = acc ? [{ last: pinned.length - 1, items, acc, tags }] : [];
      startDepth = pinned.length + 1;
    } else {
      states = usable
        .map((r, i) => ({
          last: i,
          items: [{ recipe: r, batches: 1, totalServings: r.servings }],
          acc: extend(emptyAcc(), r, 1, input),
          tags: tagged[i]!,
        }))
        .filter((s): s is State => s.acc !== null) as State[];
      startDepth = 2;
    }

    /*
     * 「今週の希望」に**もう届かない**途中経過を落とす。
     *
     * 残りの枠を全部その希望の料理で埋めたとしても必要量に届かないなら、
     * この先どう伸ばしても希望は満たせない。落としても解は減らない。
     *
     * これが無いと、届かない枝を最後まで伸ばしてから捨てることになる。
     * 「麺を4食」の指定で1回の解に18秒かかっていたのはこれが理由。
     */
    const maxServings = Math.max(...usable.map((r) => r.servings));
    const reachable = (st: State, depth: number): boolean => {
      if (reqs.length === 0) return true;
      const room = (maxPick - depth) * maxServings;
      for (let q = 0; q < reqs.length; q++) {
        const need = ((st.acc.totalServings + room) * reqs[q]!.meals) / input.meals;
        if (st.tags[q]! + room < need - 1e-6) return false;
      }
      return true;
    };

    states = states.filter((st) => reachable(st, startDepth - 1));

    for (let depth = startDepth; depth <= maxPick; depth++) {
      const next: State[] = [];
      for (const s of states) {
        for (let i = s.last + 1; i < usable.length; i++) {
          const r = usable[i]!;
          const acc = extend(s.acc, r, 1, input);
          // 原価もカロリーも足すだけなので、ここで超えた案は
          // 何を足しても通らない。落としても解は減らない（漏れのない枝刈り）
          if (!acc) continue;
          const st: State = {
            last: i,
            items: [...s.items, { recipe: r, batches: 1, totalServings: r.servings }],
            acc,
            tags: reqs.length === 0 ? s.tags : s.tags.map((v, q) => v + tagged[i]![q]!),
          };
          if (!reachable(st, depth)) continue;
          next.push(st);
        }
      }
      states = thinStates(next, input);
      if (depth > EXACT_MAX_PICK) {
        for (const s of states) {
          const plan = finish(s.items, s.acc);
          if (plan) out.push(plan);
        }
      }
      if (states.length === 0) break;
    }
  }

  return out;
}

/**
 * 栄養がほぼ同じ案を間引く。
 *
 * レシピを増やすと、主菜側・副菜側それぞれの案が線形以上に増え、
 * その積を総当たりするので探索は急に重くなる（19品→40品で 188ms→615ms）。
 *
 * ただし増えた案の大半は**栄養がほとんど同じ**もの同士で、組み合わせたときの
 * 結果も変わらない。カロリーとたんぱく質を粗い升目に落とし、同じ升の中では
 * 上位だけ残す。升の中で選ぶ基準は「嫌いなものが少ない・安い・速い」。
 *
 * 升を細かく取ってあるので、栄養の組合せの幅は保たれる。
 * 失うのは「栄養が同じで中身だけ違う案」の数で、これは最後に
 * 主菜の組合せで重複を落とす処理（diverse）とも役割が重なっている。
 */
/** 主菜・副菜それぞれの案の上限。積が探索時間になるので、ここが効く */
const MAX_SUBPLANS = 1200;

const BUCKET_KCAL = 25;
const BUCKET_PROTEIN = 3;
const PER_BUCKET = 3;

function thinOut(plans: SubPlan[]): SubPlan[] {
  const buckets = new Map<string, SubPlan[]>();
  for (const p of plans) {
    const key =
      Math.round(p.macrosPerMeal.kcal / BUCKET_KCAL) +
      ':' +
      Math.round(p.macrosPerMeal.proteinG / BUCKET_PROTEIN);
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }

  const rank = (a: SubPlan, b: SubPlan) =>
    a.penalty - b.penalty || a.costYen - b.costYen || a.handsMin - b.handsMin;
  const axes = [
    (p: SubPlan) => p.handsMin,
    (p: SubPlan) => p.rawMin,
    (p: SubPlan) => p.costYen,
  ];

  const out: SubPlan[] = [];
  for (const list of buckets.values()) {
    // 時間と予算はこのあと課される。端を残さないと「解なし」になる
    out.push(...keepFrontier(list, PER_BUCKET, rank, axes));
  }

  /*
   * 全体の上限。
   *
   * このあと主菜×副菜を総当たりで組み合わせるので、**両側の件数の積**が
   * そのまま所要時間になる。升の数が増えると片側3000件を超え、
   * 900万通りで1回の解に18秒かかった。
   * ここで絞っても、栄養の升と各軸の端は上で確保済み。
   */
  return keepFrontier(out, MAX_SUBPLANS, rank, axes);
}

/**
 * 目標との乖離。各栄養素の相対誤差を重み付けで足す。
 * たんぱく質を重くしているのは、身体づくりで最も外してはいけないため。
 */
function deviationOf(actual: Macros, target: Macros): number {
  const rel = (a: number, t: number) => (t > 0 ? Math.abs(a - t) / t : 0);
  return (
    rel(actual.kcal, target.kcal) * 1.0 +
    rel(actual.proteinG, target.proteinG) * 1.6 +
    rel(actual.fatG, target.fatG) * 0.6 +
    rel(actual.carbG, target.carbG) * 0.6
  );
}

export function solveWeek(input: SolveInput): SolveResult {
  const rejections: Record<string, number> = {};
  /** 時間以外を満たした案の最短時間。時間だけが原因で詰んだときに数字で返す */
  let minFeasibleMinutes: number | null = null;

  const mainsPool = input.recipes.filter((r) => r.role === 'main' && r.deleted === 0);
  const sidesPool = input.recipes.filter((r) => r.role === 'side' && r.deleted === 0);
  const rice = input.recipes.find((r) => r.role === 'staple' && r.deleted === 0);

  if (mainsPool.length < 1 || sidesPool.length < 1) {
    return { candidates: [], rejections: { 'レシピが足りない': 1 }, minFeasibleMinutes: null };
  }

  const mainPlans = thinOut(buildSubPlans(mainsPool, input, rejections, true));
  const sidePlans = thinOut(buildSubPlans(sidesPool, input, rejections, false));

  const candidates: WeekPlanCandidate[] = [];

  for (const mp of mainPlans) {
    for (const sp of sidePlans) {
      const dishes = mp.items.length + sp.items.length;
      if (dishes > input.maxRecipesPerWeek) {
        rejections['品数が上限を超える'] = (rejections['品数が上限を超える'] ?? 0) + 1;
        continue;
      }

      const costYen = mp.costYen + sp.costYen;
      if (costYen > input.budgetYen) {
        rejections['予算を超える'] = (rejections['予算を超える'] ?? 0) + 1;
        continue;
      }

      const base = addMacros(mp.macrosPerMeal, sp.macrosPerMeal);

      // 足りないカロリーをごはんで埋める。炭水化物の調整弁
      let riceServings = 0;
      let perMeal = base;
      let ricePlan: PlanItem | undefined;
      if (rice) {
        // パスタなど主食を兼ねる主菜の日はごはんを付けない（distribute.ts と同じ規則）。
        // その分だけ見積りからも外さないと、実際より多いカロリーを表示してしまう
        const mainServings = mp.items.reduce((n, it) => n + it.totalServings, 0);
        const stapleServings = mp.items
          .filter((it) => it.recipe.tags.includes('主食込み'))
          .reduce((n, it) => n + it.totalServings, 0);
        const riceShare =
          mainServings > 0 ? Math.max(0, 1 - stapleServings / mainServings) : 1;

        /*
         * ごはんは**茶碗に盛れる単位**に丸める。
         *
         * ここは「目標カロリーの残り ÷ ごはん1人前」を 0.1 きざみで出していたので、
         * 1食 0.1 人前（＝約17g、ひとくち）のような、盛れも詰めもしない量が
         * 画面に出ていた。0.5人前（約83g、茶碗に軽く1杯）を最小の単位にして、
         * それに満たない残りはごはんで埋めない。
         */
        const need = input.target.kcal - base.kcal;
        const raw = Math.max(0, Math.min(need / rice.nutritionPerServing.kcal, RICE_MAX));
        riceServings = Math.round(raw / RICE_STEP) * RICE_STEP;

        if (riceServings > 0) {
          /*
           * パスタの日はごはんを付けない（distribute.ts）。
           * その割合を**盛る量から引いてはいけない。**
           * 引くと、ごはんが付く日の茶碗まで小さくなる。
           * 0.1人前まで縮んでいたのは、ここで二重に割り引いていたため。
           * 割合を掛けるのは、週の平均として見積もるときと、買う量だけ。
           */
          perMeal = addMacros(
            base,
            scaleMacros(rice.nutritionPerServing, riceServings * riceShare),
          );
          const totalServings = riceServings * input.meals * riceShare;
          const batches = Math.max(1, Math.ceil(totalServings / rice.servings));
          ricePlan = { recipe: rice, batches, totalServings };
        }
      }

      // カロリーが大きく外れる案は採らない。緩和は request.ts の段階で行う
      const kcalOff = Math.abs(perMeal.kcal - input.target.kcal) / Math.max(input.target.kcal, 1);
      if (kcalOff > input.maxKcalDeviation) {
        rejections['カロリーが目標から離れすぎる'] =
          (rejections['カロリーが目標から離れすぎる'] ?? 0) + 1;
        continue;
      }

      // たんぱく質も縛る。カロリーだけ見ていると -30% の案が通ってしまう
      const proteinOff =
        Math.abs(perMeal.proteinG - input.target.proteinG) / Math.max(input.target.proteinG, 1);
      if (proteinOff > input.maxProteinDeviation) {
        rejections['たんぱく質が目標から離れすぎる'] =
          (rejections['たんぱく質が目標から離れすぎる'] ?? 0) + 1;
        continue;
      }

      // 脂質が落ちすぎる案を落とす。ごはんで埋めれば kcal は合ってしまうので、
      // kcal の判定だけでは脂質の欠落を見つけられない
      if (perMeal.fatG < input.target.fatG * input.minFatRatio) {
        rejections['脂質が不足する'] = (rejections['脂質が不足する'] ?? 0) + 1;
        continue;
      }
      // 上限も要る。脂質が4割増しになると、同じカロリーの中で炭水化物が削られる
      if (perMeal.fatG > input.target.fatG * MAX_FAT_RATIO) {
        rejections['脂質が多すぎる'] = (rejections['脂質が多すぎる'] ?? 0) + 1;
        continue;
      }

      // 時間はここで最後に見る。ほかを全部通った案だけを対象にすることで、
      // 「時間さえ緩めれば組める最短の時間」が測れる（時短の希望に数字で答えるため）
      const timeMinutes = timeMetric(input.mode, mp.handsMin + sp.handsMin, input.cookDays);
      const timeCap = input.mode === 'daily' ? input.maxDailyCookMinutes : input.maxPrepMinutes;
      if (minFeasibleMinutes == null || timeMinutes < minFeasibleMinutes) {
        minFeasibleMinutes = timeMinutes;
      }
      if (timeMinutes > timeCap) {
        const key = input.mode === 'daily' ? '1日の調理時間に収まらない' : '調理時間が足りない';
        rejections[key] = (rejections[key] ?? 0) + 1;
        continue;
      }

      const deviation = deviationOf(perMeal, input.target);
      // 予算は使い切る必要がないので、余らせるほうを軽く優遇する
      const costRatio = costYen / input.budgetYen;
      // 主菜1品だけだと週の食事が単調になる。同点なら2品を選ばせる
      const monotony = mp.items.length === 1 && input.meals >= 4 ? 0.3 : 0;
      // 時短を頼まれたときは、上限を下回るだけでなく「より短い」ほうを選ぶ。
      // 頼まれていないときは時間で献立を歪めない
      const timeScore = input.timeCapIsExplicit ? (timeMinutes / Math.max(timeCap, 1)) * 0.4 : 0;
      const score =
        deviation + mp.penalty + sp.penalty + costRatio * 0.25 + dishes * 0.02 + monotony + timeScore;

      const notes: string[] = [];
      if (riceServings === 0) notes.push('ごはんなしで目標カロリーに届いています');
      if (costRatio < 0.7) notes.push('予算に余裕があります（' + Math.round(costRatio * 100) + '%）');
      if (perMeal.proteinG < input.target.proteinG * 0.9)
        notes.push('たんぱく質がやや不足しています');
      if (perMeal.fatG < input.target.fatG * 0.8) notes.push('脂質が目標を下回っています');
      if (perMeal.carbG > input.target.carbG * 1.2) notes.push('ごはんの割合が多めです');

      candidates.push({
        mains: mp.items,
        sides: sp.items,
        riceServings,
        ...(ricePlan ? { ricePlan } : {}),
        perMeal,
        deviation,
        estimatedCostYen: Math.round(
          costYen +
            (ricePlan && rice
              ? (input.costOverride?.get(rice.id) ?? rice.estimatedCostYen ?? 0) * ricePlan.batches
              : 0),
        ),
        rawMinutes: mp.rawMin + sp.rawMin,
        handsOnMinutes: mp.handsMin + sp.handsMin,
        score,
        notes,
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score || a.estimatedCostYen - b.estimatedCostYen);

  // 同じ主菜の組合せばかり並ばないよう、主菜が重複する案は間引く
  const seen = new Set<string>();
  const diverse: WeekPlanCandidate[] = [];
  for (const c of candidates) {
    const key = c.mains
      .map((i) => i.recipe.id)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    diverse.push(c);
    if (diverse.length >= 8) break;
  }

  return { candidates: diverse, rejections, minFeasibleMinutes };
}
