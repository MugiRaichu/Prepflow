/**
 * レシピ（builtin）— 間食と、パンの朝食。
 *
 * **間食は料理ではない。**枠を食事と等しく扱っていたとき、間食に
 * 主菜＋副菜＋ごはんで1.3kg・1289kcal が入っていた（本人指摘）。
 * ここに置くのは、手に取ってすぐ食べられるものだけ。
 *   - 火を使わない（使ってもレンジかトースターまで）
 *   - 手を動かすのは5分以内
 *   - 1食ぶんの重さにしない
 *
 * パンの朝食を主菜（`主食込み`）にしているのは、ごはんが別に付かないようにするため。
 * **パン派は世の中に普通にいる**のに、これまで主食がごはん1品しか無かった。
 *
 * ここまで使われていなかった食材（プロテイン・きなこ・バナナ・ヨーグルト・
 * アーモンド・切り餅・オートミール・ブルーベリー）が、そのまま生きる。
 */
import type { SeedRecipe, SeedStep } from './recipes';
import type { EquipmentKind } from '../schema';

const st = (
  text: string,
  min: number,
  hands: number,
  kind?: EquipmentKind,
  after?: number[],
): SeedStep => ({ text, min, hands, ...(kind ? { kind } : {}), ...(after ? { after } : {}) });

/** 混ぜるだけ・温めるだけの間食。作り置きしない（その場で作る） */
const SNACKS: SeedRecipe[] = [
  {
    title: 'プロテイン（水）',
    role: 'snack',
    summary: 'シェイカーで振るだけ。たんぱく質だけを足したいときに',
    servings: 1,
    yieldFactor: 1,
    items: [['ほえいぷろていん', 30, '1杯']],
    steps: [st('水に溶かして振る', 2, 2, 'shaker')],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['間食', 'プロテイン', '高たんぱく', '時短'],
  },
  {
    title: 'プロテイン（牛乳）',
    role: 'snack',
    summary: '水より腹持ちする。カロリーも足したい日に',
    servings: 1,
    yieldFactor: 1,
    items: [
      ['ほえいぷろていん', 30, '1杯'],
      ['ぎゅうにゅう', 200],
    ],
    steps: [st('牛乳に溶かして振る', 2, 2, 'shaker')],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['間食', 'プロテイン', '高たんぱく', '時短'],
  },
  {
    title: 'プロテインバナナシェイク',
    role: 'snack',
    summary: 'ミキサーがあれば30秒。運動のあとに',
    servings: 1,
    yieldFactor: 1,
    items: [
      ['ほえいぷろていん', 30, '1杯'],
      ['ばなな', 100, '1本'],
      ['とうにゅう', 200],
    ],
    steps: [st('ミキサーにかける', 3, 3, 'blender')],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['間食', 'プロテイン', '高たんぱく', '時短'],
  },
  {
    title: 'プロテインパンケーキ',
    role: 'snack',
    summary: '粉とプロテインと卵を混ぜて焼くだけ。冷めても食べられる',
    servings: 2,
    yieldFactor: 0.85,
    items: [
      ['ほえいぷろていん', 60, '2杯'],
      ['こむぎこ', 60],
      ['たまご', 100, '2個'],
      ['ぎゅうにゅう', 100],
      ['はちみつ', 21, '大さじ1'],
    ],
    steps: [
      st('材料を混ぜる', 4, 4),
      st('弱火で両面を焼く', 8, 5, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 2, reheatNote: '600Wで40秒' },
    tags: ['間食', 'プロテイン', '高たんぱく'],
  },
  {
    title: 'ココアのプロテインパンケーキ',
    summary: '純ココアは砂糖が入っていないので、甘さははちみつだけで足りる',
    role: 'snack',
    servings: 2,
    yieldFactor: 0.85,
    items: [
      ['ほえいぷろていん', 60, '2杯'],
      ['こむぎこ', 50],
      ['じゅんここあ', 12, '大さじ2'],
      ['たまご', 100, '2個'],
      ['ぎゅうにゅう', 120],
      ['はちみつ', 21, '大さじ1'],
    ],
    steps: [
      st('材料を混ぜる。ココアはだまになりやすいので先に粉どうしで合わせる', 5, 5),
      st('弱火で両面を焼く', 8, 5, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 2, reheatNote: '600Wで40秒' },
    tags: ['間食', 'プロテイン', '高たんぱく'],
  },
  {
    title: 'ギリシャヨーグルトとブルーベリー',
    role: 'snack',
    summary: '器に盛るだけ。たんぱく質が10g乗る',
    servings: 1,
    yieldFactor: 1,
    items: [
      ['ぎりしゃよーぐると', 150],
      ['ぶるーべりー', 50],
      ['はちみつ', 10],
    ],
    steps: [st('器に盛る', 2, 2)],
    storage: { location: 'fridge', keepsDays: 2 },
    tags: ['間食', '高たんぱく', '時短'],
  },
  {
    title: 'ヨーグルトときなこ',
    role: 'snack',
    summary: 'きなこで大豆たんぱくを足す。混ぜるだけ',
    servings: 1,
    yieldFactor: 1,
    items: [
      ['よーぐると', 150],
      ['きなこ', 12, '大さじ2'],
      ['はちみつ', 10],
    ],
    steps: [st('混ぜる', 2, 2)],
    storage: { location: 'fridge', keepsDays: 2 },
    tags: ['間食', '時短', '節約'],
  },
  {
    title: 'きなこ牛乳',
    role: 'snack',
    summary: '寝る前に。温めてもいい',
    servings: 1,
    yieldFactor: 1,
    items: [
      ['ぎゅうにゅう', 200],
      ['きなこ', 12, '大さじ2'],
      ['はちみつ', 10],
    ],
    steps: [st('混ぜる', 2, 2)],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['間食', '時短', '節約'],
  },
  {
    title: 'ゆで卵2個',
    role: 'snack',
    summary: 'まとめてゆでておけば、そのまま持ち出せる',
    servings: 1,
    yieldFactor: 0.9,
    items: [['たまご', 100, '2個']],
    steps: [st('ゆでて冷ます', 12, 3, 'stovetop_burner')],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['間食', '高たんぱく', '節約'],
  },
  {
    title: 'おにぎり',
    role: 'snack',
    summary: '炭水化物を足したいときに。握って持ち出せる',
    servings: 2,
    yieldFactor: 2.2,
    items: [
      ['せいはくまい', 100],
      ['しお', 2],
    ],
    steps: [
      st('米を研いで炊飯器にセットする', 5, 5, 'rice_cooker'),
      st('塩をつけて握る', 4, 4, undefined, [0]),
    ],
    storage: { location: 'freezer', keepsDays: 30, reheatNote: '600Wで1分30秒' },
    tags: ['間食', '節約', '時短'],
  },
  {
    title: 'ツナおにぎり',
    role: 'snack',
    summary: 'たんぱく質が乗るおにぎり。運動前に',
    servings: 2,
    yieldFactor: 2.0,
    items: [
      ['せいはくまい', 100],
      ['つなかん', 70],
      ['まよねーず', 12, '大さじ1'],
      ['しお', 2],
    ],
    steps: [
      st('米を研いで炊飯器にセットする', 5, 5, 'rice_cooker'),
      st('ツナとマヨネーズを混ぜて握る', 5, 5, undefined, [0]),
    ],
    storage: { location: 'freezer', keepsDays: 30, reheatNote: '600Wで1分30秒' },
    tags: ['間食', '高たんぱく', '節約'],
  },
  {
    title: '焼き餅（きなこ）',
    role: 'snack',
    summary: '運動前の炭水化物に。トースターに入れるだけ',
    servings: 1,
    yieldFactor: 0.95,
    items: [
      ['きりもち', 100, '2個'],
      ['きなこ', 12, '大さじ2'],
      ['さとう', 5],
    ],
    steps: [st('トースターで焼き、きなこをまぶす', 8, 3, 'oven_toaster')],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['間食', '時短'],
  },
  {
    title: 'オートミールのミルク粥',
    role: 'snack',
    summary: 'レンジで2分。腹持ちがよく、朝が弱い日にも',
    servings: 1,
    yieldFactor: 1.6,
    items: [
      ['おーとみーる', 40],
      ['ぎゅうにゅう', 180],
      ['はちみつ', 10],
    ],
    steps: [st('混ぜてラップをし、レンジで加熱する', 4, 2, 'microwave')],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['間食', 'レンジだけ', '時短'],
  },
  {
    title: 'オートミールとプロテインのバー風',
    role: 'snack',
    summary: '混ぜて冷やすだけ。切って持ち出せる',
    servings: 4,
    yieldFactor: 0.9,
    items: [
      ['おーとみーる', 120],
      ['ほえいぷろていん', 60, '2杯'],
      ['はちみつ', 60],
      ['あーもんど', 40],
      ['ぎゅうにゅう', 60],
    ],
    steps: [
      st('アーモンドを刻む', 3, 3),
      st('全部を混ぜて型に押し込み、冷やして切る', 8, 6, undefined, [0]),
    ],
    storage: { location: 'fridge', keepsDays: 5 },
    tags: ['間食', 'プロテイン', '高たんぱく', '日持ち'],
  },
  {
    title: 'アーモンドとバナナ',
    role: 'snack',
    summary: '袋から出すだけ。持ち歩ける',
    servings: 1,
    yieldFactor: 1,
    items: [
      ['あーもんど', 25],
      ['ばなな', 100, '1本'],
    ],
    steps: [st('皿に出す', 1, 1)],
    storage: { location: 'fridge', keepsDays: 5 },
    tags: ['間食', '時短'],
  },
  {
    title: '納豆1パック',
    role: 'snack',
    summary: '安くてたんぱく質が乗る。混ぜるだけ',
    servings: 1,
    yieldFactor: 1,
    items: [
      ['なっとう', 45, '1パック'],
      ['しょうゆ', 5],
    ],
    steps: [st('混ぜる', 2, 2)],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['間食', '高たんぱく', '節約', '時短'],
  },
  {
    title: '豆乳とバナナ',
    role: 'snack',
    summary: '朝が食べられない日でも、これなら入る',
    servings: 1,
    yieldFactor: 1,
    items: [
      ['とうにゅう', 200],
      ['ばなな', 100, '1本'],
    ],
    steps: [st('コップに注いでバナナと', 1, 1)],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['間食', '時短'],
  },
];

/**
 * パンの朝食。
 *
 * `主食込み` を付けてあるので、ごはんは別に付かない。
 * 主食がごはん1品しかない状態が続いていたが、**パン派は普通にいる**。
 */
const BREAD: SeedRecipe[] = [
  {
    title: 'たまごトースト',
    role: 'main',
    summary: '焼いている間に卵を作る。5分で終わる',
    servings: 1,
    yieldFactor: 0.9,
    items: [
      ['しょくぱん', 120, '2枚'],
      ['たまご', 100, '2個'],
      ['ばたー', 8],
      ['しお', 1],
      ['こしょう', 1],
    ],
    steps: [
      st('パンをトースターに入れる', 5, 1, 'oven_toaster'),
      st('卵を炒り卵にして乗せる', 5, 5, 'stovetop_burner'),
    ],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['パン', '朝食', '主食込み', '高たんぱく', '時短'],
  },
  {
    title: 'ツナとチーズのトースト',
    role: 'main',
    summary: '乗せて焼くだけ。洗い物が出ない',
    servings: 2,
    yieldFactor: 0.9,
    items: [
      ['しょくぱん', 120, '2枚'],
      ['つなかん', 140],
      ['ちーず', 36, '2枚'],
      ['まよねーず', 24, '大さじ2'],
      ['こしょう', 1],
    ],
    steps: [st('ツナとマヨを乗せ、チーズをかけて焼く', 8, 4, 'oven_toaster')],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['パン', '朝食', '主食込み', '高たんぱく', '時短'],
  },
  {
    title: 'ハムエッグトーストとサラダ',
    role: 'main',
    summary: 'ベーコンで塩気を出す。緑を1つ添える',
    servings: 2,
    yieldFactor: 0.85,
    items: [
      ['しょくぱん', 120, '2枚'],
      ['べーこん', 60],
      ['たまご', 100, '2個'],
      ['れたす', 80],
      ['まよねーず', 12, '大さじ1'],
    ],
    steps: [
      st('パンを焼く', 5, 1, 'oven_toaster'),
      st('ベーコンと卵を焼く', 6, 5, 'stovetop_burner'),
      st('レタスをちぎって添える', 3, 3, undefined, [0, 1]),
    ],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['パン', '朝食', '主食込み', '高たんぱく'],
  },
  {
    title: 'きなこトースト',
    role: 'main',
    summary: '甘い朝が好きな人に。大豆たんぱくが少し乗る',
    servings: 1,
    yieldFactor: 0.9,
    items: [
      ['しょくぱん', 120, '2枚'],
      ['きなこ', 12, '大さじ2'],
      ['ばたー', 10],
      ['はちみつ', 21, '大さじ1'],
    ],
    steps: [st('パンを焼き、バターときなこ、はちみつをかける', 6, 3, 'oven_toaster')],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['パン', '朝食', '主食込み', '時短'],
  },
  {
    title: 'たまごサンド',
    role: 'main',
    summary: '前の晩に作って持ち出せる。ゆで卵はまとめてゆでる',
    servings: 2,
    yieldFactor: 0.9,
    items: [
      ['しょくぱん', 180, '3枚'],
      ['たまご', 200, '4個'],
      ['まよねーず', 36, '大さじ3'],
      ['しお', 2],
      ['こしょう', 1],
    ],
    steps: [
      st('卵をゆでる', 12, 3, 'stovetop_burner'),
      st('刻んでマヨネーズで和え、パンにはさむ', 8, 8, undefined, [0]),
    ],
    storage: { location: 'fridge', keepsDays: 1 },
    tags: ['パン', '朝食', '主食込み', '高たんぱく'],
  },
];

export const BUILTIN_RECIPES_SNACK: SeedRecipe[] = [...SNACKS, ...BREAD];
