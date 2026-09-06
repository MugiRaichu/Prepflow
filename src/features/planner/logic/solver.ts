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
 * 探索に載せる候補の上限。
 *
 * 組合せの数は候補数 n に対して C(n, k) で増える。レシピを増やしたとき、
 * 主菜47品・k=5 で 150万通りになりメモリが尽きた。
 * ここで絞らないと、レシピを足すほどアプリが動かなくなる。
 */
const SHORTLIST = 20;

/** 文字列から決定論的な数を作る（FNV-1a）。並べ替えの種にする */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** 制約の端を守るために必ず残す件数（速い順・安い順・たんぱく質の多い順 それぞれ） */
const KEEP_EXTREMES = 5;

/**
 * 候補を SHORTLIST 件に絞る。
 *
 * 2つの要求がぶつかる。
 *
 *   - **毎週同じ顔ぶれにしない。**「安い順に20件」のような取り方をすると、
 *     レシピを増やしても選ばれる料理は変わらない
 *   - **端を落とさない。**「10分で作れる献立」は、いちばん速いレシピが
 *     候補に残っていないと成立しない。実際、順番だけで絞ったときに
 *     時短の条件が軒並み「解なし」になった
 *
 * そこで、速い順・安い順・たんぱく質の多い順の上位を先に確保してから、
 * 残りの枠を週ごとに変わる順で埋める。
 * 同じ週なら何度押しても同じ結果になり（決定論）、週が変われば顔ぶれが変わる。
 */
function shortlist(usable: Recipe[], input: SolveInput): Recipe[] {
  if (usable.length <= SHORTLIST) return usable;

  const picked = new Map<string, Recipe>();
  const takeTop = (rank: (r: Recipe) => number) => {
    for (const r of [...usable].sort((a, b) => rank(a) - rank(b)).slice(0, KEEP_EXTREMES)) {
      picked.set(r.id, r);
    }
  };
  takeTop((r) => handsOnMinutes(r));
  takeTop((r) => r.estimatedCostYen ?? 0);
  takeTop((r) => -r.nutritionPerServing.proteinG);

  const seed = input.seed ?? '';
  const keyOf = (r: Recipe) =>
    (input.recentRecipeIds.has(r.id) ? 0x100000000 : 0) + hash32(seed + r.id);
  for (const r of [...usable].sort((a, b) => keyOf(a) - keyOf(b))) {
    if (picked.size >= SHORTLIST) break;
    picked.set(r.id, r);
  }
  return [...picked.values()];
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

  const usable = shortlist(filtered, input);

  const out: SubPlan[] = [];
  // 品数は飽きの許容範囲から決める。主菜も副菜も同じ扱いにする。
  // 主菜だけ日替わりにしても、副菜が14食とも同じなら皿の見た目は変わらない
  const maxPick = pickRange(input.meals, input.maxSameDishMeals);
  for (let k = MIN_PICK; k <= Math.min(maxPick, usable.length); k++) {
    for (const combo of combinations(usable, k)) {
      for (const batches of batchPatterns(k, maxBatchesFor(k))) {
        let macros: Macros = ZERO;
        let costYen = 0;
        let rawMin = 0;
        let handsMin = 0;
        let penalty = 0;
        let tooMuch = false;
        const items: PlanItem[] = [];

        for (let i = 0; i < combo.length; i++) {
          const r = combo[i]!;
          const b = batches[i]!;
          const totalServings = b * r.servings;
          items.push({ recipe: r, batches: b, totalServings });
          // 1食に同じ品を2人前も3人前も詰めるのは現実的でない。
          // 数字の上では目標に合っても、実際には食べきれず飽きる
          const perMeal = totalServings / input.meals;
          if (perMeal > 1.5) penalty += (perMeal - 1.5) * 0.5;
          // 1食に同じ品を3人前は誰も食べない。スコアではなく打ち切りにする
          if (perMeal > 3) {
            tooMuch = true;
            break;
          }
          macros = addMacros(macros, scaleMacros(r.nutritionPerServing, totalServings));
          // 家にある食材を引いた原価が渡されていればそれを使う（今週の余りを使う案が勝つ）
          costYen += (input.costOverride?.get(r.id) ?? r.estimatedCostYen ?? 0) * b;
          rawMin += totalMinutes(r) * b;
          handsMin += handsOnMinutes(r) * b;
          penalty += dislikePenalty(r, input.dislikedIngredientIds);
          if (input.recentRecipeIds.has(r.id)) penalty += 0.4;
        }

        if (tooMuch) continue;

        // 同じ料理が何食に載るかを見て、飽きの許容範囲を超える案を落とす。
        // 総人前に対する比率から食数を見積もる（実際の割り振りは distribute.ts）
        {
          const total = items.reduce((n, it) => n + it.totalServings, 0);
          if (total > 0) {
            const worstMeals = Math.max(
              ...items.map((it) => (it.totalServings * input.meals) / total),
            );
            if (worstMeals > input.maxSameDishMeals + 1e-6) {
              rejections['同じ料理が続きすぎる'] = (rejections['同じ料理が続きすぎる'] ?? 0) + 1;
              continue;
            }
          }
        }

        // 「パスタを3食」のような希望を満たすか。人前の比率で判定する。
        //
        // 下限を満たすだけだと、希望を入れる前と同じ献立がそのまま返ることがある
        // （もともと鶏肉が入っていれば「鶏肉2日」は自動的に満たされる）。
        // 利用者からは「選んでも反映されない」ようにしか見えないので、
        // **満たした度合いをスコアでも報いる**。多く入っている案が勝つ
        if (applyRequests && input.requiredTagMeals.length > 0) {
          const totalServings = items.reduce((n, it) => n + it.totalServings, 0);
          let ok = true;
          for (const req of input.requiredTagMeals) {
            const tagged = items
              .filter((it) => it.recipe.tags.includes(req.tag))
              .reduce((n, it) => n + it.totalServings, 0);
            // 週の食数に対する希望の割合ぶんの人前が要る
            const need = (totalServings * req.meals) / input.meals;
            if (tagged < need - 1e-6) {
              ok = false;
              break;
            }
            // 希望のぶんを超えて入っているほど軽くする。
            // 強くしすぎると栄養の乖離に勝ってしまい、希望は叶うが献立が歪む
            const surplus = need > 0 ? Math.min((tagged - need) / need, 1) : 0;
            penalty -= surplus * 0.3;
          }
          if (!ok) {
            rejections['今週の希望に届かない'] = (rejections['今週の希望に届かない'] ?? 0) + 1;
            continue;
          }
        }

        // ここで刈っておかないと、レシピを増やした瞬間に組合せが爆発する。
        // 主菜と副菜は「足す」だけの関係なので、片方だけで上限を超えた案は
        // 何を足しても通らない。落としても解は減らない（漏れのない枝刈り）
        const macrosPerMeal = scaleMacros(macros, 1 / input.meals);
        if (costYen > input.budgetYen) continue;
        if (macrosPerMeal.kcal > input.target.kcal * (1 + input.maxKcalDeviation)) continue;
        if (macrosPerMeal.proteinG > input.target.proteinG * (1 + input.maxProteinDeviation))
          continue;

        out.push({
          items,
          macrosPerMeal,
          costYen,
          rawMin,
          handsMin,
          penalty,
        });
      }
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

  const out: SubPlan[] = [];
  for (const list of buckets.values()) {
    if (list.length > PER_BUCKET) {
      list.sort(
        (a, b) => a.penalty - b.penalty || a.costYen - b.costYen || a.handsMin - b.handsMin,
      );
      list.length = PER_BUCKET;
    }
    out.push(...list);
  }
  return out;
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

        const need = input.target.kcal - base.kcal;
        riceServings = Math.max(0, Math.min(need / rice.nutritionPerServing.kcal, RICE_MAX));
        riceServings = Math.round(riceServings * riceShare * 10) / 10;
        if (riceServings > 0) {
          perMeal = addMacros(base, scaleMacros(rice.nutritionPerServing, riceServings));
          const totalServings = riceServings * input.meals;
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
