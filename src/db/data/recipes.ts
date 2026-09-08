/**
 * レシピ（builtin）。
 *
 * 栄養値・原価・出来上がり重量はここに書かない。すべて食材マスタから計算する
 * （seed 時に buildRecipe が算出）。手で書くと必ず食材と食い違う。
 *
 * 手順の min（所要分）と hands（人が張り付く分）を分けているのが並行調理の要。
 * 「レンジ5分」は機器を5分占有するが人は拘束しないので hands=0 と書く。
 */
import type { EquipmentKind, RecipeRole } from '../schema';

export interface SeedStep {
  text: string;
  /** 使う機器の種別。実機の割当は調理セッション作成時 */
  kind?: EquipmentKind;
  /** 所要分（機器の占有時間） */
  min: number;
  /** うち人が張り付く分 */
  hands: number;
  /** 先行手順の index */
  after?: number[];
}

export interface SeedRecipe {
  title: string;
  role: RecipeRole;
  summary?: string;
  /** 何食分できるか */
  servings: number;
  /** 加熱による重量変化。出来上がり重量 = 材料合計 × これ */
  yieldFactor: number;
  /** [食材のnameKey, グラム数, 表示用（任意）] */
  items: [string, number, string?][];
  steps: SeedStep[];
  storage: {
    location: 'fridge' | 'freezer';
    keepsDays: number;
    /** おいしく食べられる日数。省略時は keepsDays と同じ（→ build.ts で補う） */
    bestWithinDays?: number;
    /** 冷凍に耐えるか。書かなければ材料から決める（→ build.ts） */
    freezesWell?: boolean;
    reheatNote?: string;
  };
  tags: string[];
}

const st = (
  text: string,
  min: number,
  hands: number,
  kind?: EquipmentKind,
  after?: number[],
): SeedStep => ({ text, min, hands, ...(kind ? { kind } : {}), ...(after ? { after } : {}) });

const MAINS: SeedRecipe[] = [
  {
    title: '鶏むねの照り焼き',
    role: 'main',
    summary: '高たんぱく・低脂質の定番。片栗粉をまぶすとパサつかない',
    servings: 4,
    yieldFactor: 0.85,
    items: [
      ['とりむねにく', 600],
      ['かたくりこ', 12, '大さじ1.5'],
      ['しょうゆ', 36, '大さじ2'],
      ['みりん', 36, '大さじ2'],
      ['さとう', 9, '大さじ1'],
      ['さらだあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('鶏むね肉を一口大のそぎ切りにする', 6, 6),
      st('片栗粉をまぶす', 2, 2, undefined, [0]),
      st('フライパンで両面を焼く', 8, 4, 'stovetop_burner', [1]),
      st('調味料を加えて煮からめる', 4, 2, 'stovetop_burner', [2]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで1分半' },
    tags: ['鶏肉', '高たんぱく'],
  },
  {
    title: '鶏むねのレンジ蒸し',
    role: 'main',
    summary: '火を使わない。コンロが埋まっている時間に並行して作れる',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['とりむねにく', 600],
      ['りょうりしゅ', 30, '大さじ2'],
      ['しお', 4, '小さじ0.7'],
      ['しょうが', 10],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('鶏むね肉に塩と酒をもみ込む', 4, 4),
      st('耐熱皿に入れてラップをし、レンジで加熱', 8, 0, 'microwave', [0]),
      st('粗熱を取って裂く。ごま油としょうがを混ぜる', 6, 6, undefined, [1]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: 'そのままでも可' },
    tags: ['鶏肉', '高たんぱく', 'レンジだけ'],
  },
  {
    title: '豚こまと玉ねぎの生姜焼き',
    role: 'main',
    summary: '作り置きの中では脂質高め。カロリーを稼ぎたい週に',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['ぶたこまぎれにく', 500],
      ['たまねぎ', 300],
      ['しょうが', 20],
      ['しょうゆ', 45, '大さじ2.5'],
      ['みりん', 36, '大さじ2'],
      ['りょうりしゅ', 30, '大さじ2'],
      ['さらだあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('玉ねぎを薄切り、しょうがをすりおろす', 7, 7),
      st('豚肉を炒める', 6, 4, 'stovetop_burner', [0]),
      st('玉ねぎを加えて炒める', 5, 3, 'stovetop_burner', [1]),
      st('調味料を加えて煮からめる', 4, 2, 'stovetop_burner', [2]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['豚肉'],
  },
];

const MAINS2: SeedRecipe[] = [
  {
    title: '鮭の塩焼き',
    role: 'main',
    summary: '切り身を並べて焼くだけ。手間が最小',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['さけ', 480],
      ['しお', 4, '小さじ0.7'],
      ['りょうりしゅ', 15, '大さじ1'],
    ],
    steps: [
      st('鮭に塩をふって10分おき、水気を拭く', 3, 3),
      st('天板に並べてオーブンで焼く', 18, 0, 'oven', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで1分' },
    tags: ['魚', '高たんぱく', '放置できる'],
  },
  {
    title: 'さばの味噌煮',
    role: 'main',
    summary: '脂質が高くカロリーを稼げる。増量期向き',
    servings: 4,
    yieldFactor: 0.9,
    items: [
      ['さば', 480],
      ['みそ', 54, '大さじ3'],
      ['さとう', 18, '大さじ2'],
      ['りょうりしゅ', 45, '大さじ3'],
      ['しょうが', 15],
      ['ながねぎ', 60],
    ],
    steps: [
      st('さばに湯をかけて霜降りする', 5, 5),
      st('調味料を煮立て、さばを入れて落し蓋で煮る', 18, 3, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['魚'],
  },
  {
    title: '豚ひきと豆腐のそぼろ',
    role: 'main',
    summary: '豆腐でかさ増しして単価を下げる。ごはんに合う',
    servings: 4,
    yieldFactor: 0.75,
    items: [
      ['ぶたひきにく', 300],
      ['もめんどうふ', 300],
      ['しょうが', 15],
      ['しょうゆ', 45, '大さじ2.5'],
      ['さとう', 18, '大さじ2'],
      ['りょうりしゅ', 30, '大さじ2'],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('豆腐を水切りする', 10, 2),
      st('ひき肉を炒める', 6, 4, 'stovetop_burner'),
      st('豆腐を崩し入れ、調味料を加えて水分を飛ばす', 10, 5, 'stovetop_burner', [0, 1]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['豚肉', '節約'],
  },
  {
    title: '鶏ももとしめじの照り煮',
    role: 'main',
    summary: 'きのこでかさを増やしつつ食べごたえを出す',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['とりももにく', 500],
      ['しめじ', 200],
      ['しょうゆ', 45, '大さじ2.5'],
      ['みりん', 45, '大さじ2.5'],
      ['りょうりしゅ', 30, '大さじ2'],
    ],
    steps: [
      st('鶏ももを一口大に切る。しめじをほぐす', 6, 6),
      st('鶏を皮目から焼く', 7, 3, 'stovetop_burner', [0]),
      st('しめじと調味料を加えて煮からめる', 8, 3, 'stovetop_burner', [1]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['鶏肉'],
  },
];

const SIDES: SeedRecipe[] = [
  {
    title: 'ブロッコリーの塩ゆで',
    role: 'side',
    summary: '主菜の隣に置くだけ。たんぱく質も少し稼げる',
    servings: 5,
    yieldFactor: 1.0,
    items: [['ぶろっこりー', 400], ['しお', 3, '小さじ0.5']],
    steps: [
      st('小房に切り分ける', 5, 5),
      st('塩を入れた湯で3分ゆで、ざるに広げて冷ます', 8, 2, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['野菜', '緑'],
  },
  {
    title: 'ほうれん草のごま和え',
    role: 'side',
    summary: 'ゆでて和えるだけ。鉄分と食物繊維',
    servings: 5,
    yieldFactor: 0.8,
    items: [
      ['ほうれんそう', 400],
      ['しょうゆ', 18, '大さじ1'],
      ['さとう', 6, '小さじ2'],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('ほうれん草をゆでて冷水にとる', 7, 3, 'stovetop_burner'),
      st('水気を絞って切り、調味料で和える', 6, 6, undefined, [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['野菜', '緑'],
  },
  {
    title: 'にんじんのきんぴら',
    role: 'side',
    summary: '日持ちがよく、色が入るので弁当が締まる',
    servings: 5,
    yieldFactor: 0.85,
    items: [
      ['にんじん', 400],
      ['しょうゆ', 18, '大さじ1'],
      ['みりん', 18, '大さじ1'],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('にんじんを千切りにする', 8, 8),
      st('ごま油で炒め、調味料を加えて水分を飛ばす', 8, 5, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 4 },
    tags: ['野菜', '日持ち'],
  },
  {
    title: '切り干し大根の煮物',
    role: 'side',
    summary: '乾物なので原価が安く、食物繊維が多い',
    servings: 6,
    yieldFactor: 2.5,
    items: [
      ['きりぼしだいこん', 50],
      ['にんじん', 80],
      ['しょうゆ', 27, '大さじ1.5'],
      ['みりん', 27, '大さじ1.5'],
      ['さとう', 6, '小さじ2'],
    ],
    steps: [
      st('切り干し大根を水で戻す', 15, 2),
      st('にんじんを千切りにする', 4, 4),
      st('鍋で煮汁が少なくなるまで煮る', 15, 3, 'stovetop_burner', [0, 1]),
    ],
    storage: { location: 'fridge', keepsDays: 4 },
    tags: ['野菜', '節約', '日持ち'],
  },
];

const SIDES2: SeedRecipe[] = [
  {
    title: 'キャベツともやしのナムル',
    role: 'side',
    summary: '一番安い副菜。かさが稼げる',
    servings: 5,
    yieldFactor: 0.7,
    items: [
      ['きゃべつ', 300],
      ['もやし', 200],
      ['ごまあぶら', 8, '小さじ2'],
      ['とりがらすーぷのもと', 6, '小さじ2'],
      ['にんにく', 5],
    ],
    steps: [
      st('キャベツをざく切りにする', 4, 4),
      st('キャベツともやしをレンジで加熱', 6, 0, 'microwave', [0]),
      st('水気を切って調味料で和える', 4, 4, undefined, [1]),
    ],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['野菜', '節約', 'レンジだけ'],
  },
  {
    title: '小松菜とツナの炒め',
    role: 'side',
    summary: 'ツナ缶でたんぱく質を足せる副菜',
    servings: 5,
    yieldFactor: 0.8,
    items: [
      ['こまつな', 400],
      ['つなかん', 140],
      ['しょうゆ', 12, '小さじ2'],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('小松菜を5cm幅に切る', 5, 5),
      st('ツナと一緒に炒め、しょうゆで調味', 6, 5, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['野菜', '緑', '高たんぱく'],
  },
  {
    title: 'ゆで卵',
    role: 'side',
    summary: 'たんぱく質の調整弁。足りない週に足す',
    servings: 6,
    yieldFactor: 0.88,
    items: [['たまご', 360, '6個']],
    steps: [st('鍋で9分ゆで、冷水にとって殻をむく', 14, 6, 'stovetop_burner')],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['高たんぱく', '日持ち'],
  },
  {
    title: '大根と厚揚げの煮物',
    role: 'side',
    summary: '煮ている間は放置できるので、他の調理と並行しやすい',
    servings: 5,
    yieldFactor: 0.9,
    items: [
      ['だいこん', 500],
      ['あつあげ', 200],
      ['しょうゆ', 27, '大さじ1.5'],
      ['みりん', 27, '大さじ1.5'],
      ['りょうりしゅ', 30, '大さじ2'],
    ],
    steps: [
      st('大根を1.5cmの半月に切る。厚揚げを一口大に切る', 8, 8),
      st('鍋に入れて弱火で煮る', 25, 2, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 4 },
    tags: ['野菜', '放置できる'],
  },
];

const STAPLES: SeedRecipe[] = [
  {
    title: 'ごはん',
    role: 'staple',
    summary: '炭水化物の調整用。1食あたりの量をソルバーが決める',
    servings: 10,
    yieldFactor: 2.2,
    items: [['せいはくまい', 750, '5合']],
    steps: [st('米を研いで炊飯器にセット', 8, 6, 'rice_cooker')],
    storage: { location: 'freezer', keepsDays: 30, reheatNote: '600Wで2分' },
    tags: ['主食'],
  },
];



/**
 * パスタ。主食を兼ねる主菜なので、この日はごはんが不要になる。
 * 「今週はパスタを3日」のような希望に応えるための枠。
 */
const PASTA: SeedRecipe[] = [
  {
    title: '鶏むねとブロッコリーのペペロンチーノ',
    role: 'main',
    summary: '主食込みの一皿。たんぱく質も確保できる',
    servings: 4,
    // 乾麺は倍以上に増えるが、具は増えないか減る。全体では1.3倍ほど
    yieldFactor: 1.3,
    items: [
      ['すぱげってぃ', 320],
      ['とりむねにく', 400],
      ['ぶろっこりー', 200],
      ['にんにく', 15],
      ['あかとうがらし', 2],
      ['おりーぶおいる', 24, '大さじ2'],
      ['しお', 5, '小さじ1'],
    ],
    steps: [
      st('鶏むねを削ぎ切り、ブロッコリーを小房に、にんにくを薄切りにする', 8, 8),
      st('パスタをゆでる', 11, 2, 'stovetop_burner', [0]),
      st('にんにくと鶏を炒め、ブロッコリーを加える', 8, 6, 'stovetop_burner', [0]),
      st('ゆで汁を加えて乳化させ、パスタとあえる', 4, 4, 'stovetop_burner', [1, 2]),
    ],
    storage: { location: 'fridge', keepsDays: 2, reheatNote: '600Wで2分' },
    tags: ['パスタ', '主食込み', '鶏肉'],
  },
  {
    title: 'ツナとトマトのパスタ',
    role: 'main',
    summary: '缶詰だけで作れる。買い出しが少ない週向き',
    servings: 4,
    yieldFactor: 1.25,
    items: [
      ['すぱげってぃ', 320],
      ['つなかん', 140],
      ['かっととまとかん', 400],
      ['たまねぎ', 200],
      ['にんにく', 10],
      ['おりーぶおいる', 24, '大さじ2'],
      ['しお', 5, '小さじ1'],
    ],
    steps: [
      st('玉ねぎとにんにくをみじん切りにする', 6, 6),
      st('パスタをゆでる', 11, 2, 'stovetop_burner', [0]),
      st('玉ねぎを炒め、ツナとトマト缶を加えて煮る', 12, 5, 'stovetop_burner', [0]),
      st('パスタとあえる', 3, 3, 'stovetop_burner', [1, 2]),
    ],
    storage: { location: 'fridge', keepsDays: 2, reheatNote: '600Wで2分' },
    tags: ['パスタ', '主食込み', '節約'],
  },
  {
    title: 'ひき肉のミートソースパスタ',
    role: 'main',
    summary: 'ソースを多めに作って冷凍すれば翌週も使える',
    servings: 4,
    yieldFactor: 1.15,
    items: [
      ['すぱげってぃ', 320],
      ['ぶたひきにく', 300],
      ['たまねぎ', 200],
      ['にんじん', 100],
      ['かっととまとかん', 400],
      ['にんにく', 10],
      ['おりーぶおいる', 16, '大さじ1.5'],
      ['しお', 5, '小さじ1'],
    ],
    steps: [
      st('玉ねぎ・にんじん・にんにくをみじん切りにする', 10, 10),
      st('パスタをゆでる', 11, 2, 'stovetop_burner', [0]),
      st('野菜とひき肉を炒め、トマト缶を加えて煮込む', 18, 6, 'stovetop_burner', [0]),
      st('パスタとあえる', 3, 3, 'stovetop_burner', [1, 2]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['パスタ', '主食込み', '豚肉'],
  },
];

/**
 * 時短の主菜。手を動かす時間（hands）を8分以下に抑えたもの。
 *
 * 「時短」を選択肢に出すからには、選んだときに実際に短い献立が組めなければ
 * ならない。上限を短くしてもプールに短い料理が無ければ、ソルバーは解無しになり
 * 結局もとの時間に戻る。時短は設定ではなくレシピ側の性質。
 *
 * 短くする手口は3つだけ。
 *   1. 切らない（缶詰・もやし・こま切れ・ひき肉）
 *   2. レンジに任せる（hands=0 の時間を作る）
 *   3. 工程を2つ以内にする（持ち替えと洗い物が減る）
 */
const FAST_MAINS: SeedRecipe[] = [
  {
    title: 'さば缶とトマトの煮込み',
    role: 'main',
    summary: '缶を開けて煮るだけ。切るのはにんにくだけ',
    servings: 4,
    yieldFactor: 0.9,
    items: [
      ['さばみずになかん', 380],
      ['かっととまとかん', 400],
      ['にんにく', 8],
      ['おりーぶおいる', 8, '小さじ2'],
      ['しお', 3, '小さじ0.5'],
    ],
    steps: [
      st('にんにくを薄切りにする', 2, 2),
      st('缶を汁ごと入れ、オリーブオイルと塩を加えて煮る', 10, 2, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['魚', '高たんぱく', '時短', '放置できる'],
  },
  {
    title: '豚こまともやしのレンジ蒸し',
    role: 'main',
    summary: '包丁を使わない。皿に広げてレンジに入れるだけ',
    servings: 4,
    yieldFactor: 0.75,
    items: [
      ['ぶたこまぎれにく', 400],
      ['もやし', 400],
      ['しょうゆ', 27, '大さじ1.5'],
      ['ごまあぶら', 10, '大さじ0.8'],
      ['しょうが', 8],
    ],
    steps: [
      st('耐熱皿にもやし、豚肉の順に広げる', 4, 4),
      st('ラップをしてレンジで加熱', 9, 0, 'microwave', [0]),
      st('しょうゆとごま油、しょうがを混ぜる', 2, 2, undefined, [1]),
    ],
    storage: { location: 'fridge', keepsDays: 2, reheatNote: '600Wで2分' },
    tags: ['豚肉', '高たんぱく', '時短', 'レンジだけ'],
  },
  {
    title: 'ささみとブロッコリーのレンジ蒸し',
    role: 'main',
    summary: 'たんぱく質が最も安く取れる組合せ。副菜を兼ねる',
    servings: 4,
    yieldFactor: 0.85,
    items: [
      ['とりささみ', 400],
      ['ぶろっこりー', 300],
      ['りょうりしゅ', 20, '大さじ1.3'],
      ['しお', 3, '小さじ0.5'],
      ['おりーぶおいる', 8, '小さじ2'],
    ],
    steps: [
      st('ささみとブロッコリーを耐熱皿に入れ、酒と塩をふる', 5, 5),
      st('ラップをしてレンジで加熱', 8, 0, 'microwave', [0]),
      st('オリーブオイルを回しかける', 1, 1, undefined, [1]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: 'そのままでも可' },
    tags: ['鶏肉', '高たんぱく', '時短', 'レンジだけ', '緑'],
  },
  {
    title: '厚揚げとひき肉の甘辛煮',
    role: 'main',
    summary: '厚揚げを切るだけ。冷めても味が落ちない',
    servings: 4,
    yieldFactor: 0.9,
    items: [
      ['あつあげ', 400],
      ['ぶたひきにく', 250],
      ['しょうゆ', 27, '大さじ1.5'],
      ['みりん', 27, '大さじ1.5'],
      ['さとう', 6, '小さじ2'],
      ['しょうが', 8],
    ],
    steps: [
      st('厚揚げを一口大に切る', 4, 4),
      st('ひき肉を炒め、厚揚げと調味料を加えて煮る', 10, 4, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 4, reheatNote: '600Wで2分' },
    tags: ['豚肉', '高たんぱく', '時短', '日持ち'],
  },
  {
    title: 'ツナと卵の炒り豆腐',
    role: 'main',
    summary: '豆腐は手で崩す。原価が最も安い主菜',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['もめんどうふ', 400],
      ['つなかん', 140],
      ['たまご', 120],
      ['しょうゆ', 18, '大さじ1'],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('豆腐を手で崩しながらフライパンに入れる', 3, 3),
      st('ツナと溶き卵を加えて炒め、しょうゆで調える', 8, 6, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 2, reheatNote: '600Wで1分半' },
    tags: ['魚', '高たんぱく', '時短', '節約'],
  },
];

/** 時短の副菜。和えるだけ・レンジだけで、手を動かすのは6分以下 */
const FAST_SIDES: SeedRecipe[] = [
  {
    title: 'もやしのナムル',
    role: 'side',
    summary: '1袋40円前後。レンジで加熱して和えるだけ',
    servings: 5,
    yieldFactor: 0.75,
    items: [
      ['もやし', 400],
      ['ごまあぶら', 10, '大さじ0.8'],
      ['とりがらすーぷのもと', 4, '小さじ1.3'],
      ['にんにく', 4],
      ['しお', 2, '小さじ0.3'],
    ],
    steps: [
      st('もやしを耐熱皿に入れ、ラップをしてレンジで加熱', 5, 1, 'microwave'),
      st('水気を切り、調味料で和える', 3, 3, undefined, [0]),
    ],
    storage: { location: 'fridge', keepsDays: 2 },
    tags: ['野菜', '時短', 'レンジだけ', '節約'],
  },
  {
    title: 'わかめとツナの和え物',
    role: 'side',
    summary: '乾物と缶詰だけ。買い置きで作れる',
    servings: 5,
    yieldFactor: 2.2,
    items: [
      ['かんそうわかめ', 20],
      ['つなかん', 140],
      ['しょうゆ', 9, '小さじ1.5'],
      ['ごまあぶら', 6, '小さじ1.5'],
    ],
    steps: [
      st('わかめを水でもどす', 6, 1),
      st('水気を切り、ツナと調味料で和える', 3, 3, undefined, [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['時短', '日持ち', '節約'],
  },
  {
    title: 'トマトのオリーブオイル和え',
    role: 'side',
    summary: '切ってかけるだけ。火も電子レンジも使わない',
    servings: 5,
    yieldFactor: 1.0,
    items: [
      ['とまと', 500],
      ['おりーぶおいる', 10, '大さじ0.8'],
      ['しお', 2, '小さじ0.3'],
    ],
    steps: [st('トマトをくし形に切り、オイルと塩で和える', 5, 5)],
    storage: { location: 'fridge', keepsDays: 2 },
    tags: ['野菜', '時短'],
  },
  {
    title: 'ミックスビーンズのマリネ',
    role: 'side',
    summary: '日持ちがよく、食物繊維とたんぱく質が同時に取れる',
    servings: 5,
    yieldFactor: 1.0,
    items: [
      ['みっくすびーんず', 300],
      ['たまねぎ', 80],
      ['おりーぶおいる', 12, '大さじ1'],
      ['しお', 2, '小さじ0.3'],
      ['こしょう', 1],
    ],
    steps: [
      st('玉ねぎを薄切りにして水にさらす', 4, 4),
      st('豆と混ぜ、オイルと塩こしょうで和える', 2, 2, undefined, [0]),
    ],
    storage: { location: 'fridge', keepsDays: 5 },
    tags: ['時短', '日持ち', '節約'],
  },
  {
    title: '小松菜のレンジおひたし',
    role: 'side',
    summary: 'ゆでない。鍋も湯も使わないので後片付けが早い',
    servings: 5,
    yieldFactor: 0.75,
    items: [
      ['こまつな', 400],
      ['しょうゆ', 18, '大さじ1'],
      ['ごまあぶら', 6, '小さじ1.5'],
    ],
    steps: [
      st('小松菜を切って耐熱皿に入れ、ラップをしてレンジで加熱', 6, 3, 'microwave'),
      st('水気を絞ってしょうゆとごま油で和える', 3, 3, undefined, [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['野菜', '緑', '時短', 'レンジだけ'],
  },
  {
    title: '冷奴 ねぎしょうが',
    role: 'side',
    summary: '加熱なし。たんぱく質を足したいときの逃げ道',
    servings: 5,
    yieldFactor: 1.0,
    items: [
      ['もめんどうふ', 400],
      ['ながねぎ', 40],
      ['しょうが', 8],
      ['しょうゆ', 12, '小さじ2'],
    ],
    steps: [
      st('ねぎとしょうがを刻む', 4, 4),
      st('豆腐を切って器に分け、薬味としょうゆをのせる', 2, 2, undefined, [0]),
    ],
    storage: { location: 'fridge', keepsDays: 2 },
    tags: ['時短', '高たんぱく', '節約'],
  },
];

/**
 * 主菜の追加分。狙いは「使われていない食材を減らす」こと。
 *
 * 食材マスタにあるのにどのレシピからも参照されない食材は、
 * 買い出しにも栄養計算にも一度も出てこない。**献立の穴がそこに出る。**
 * 牛肉・なす・じゃがいも・ピーマン・カレー粉・ケチャップがそうだった。
 *
 * 牛肉はこの1品だけなので「今週の希望」のタグには出さない。
 * 選べるのに叶わない選択肢を並べるのが、いちばん質が悪い。
 */
const MAINS3: SeedRecipe[] = [
  {
    title: '牛こまとピーマンの炒めもの',
    role: 'main',
    summary: '片栗粉をまぶすと肉がかたくならない',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['ぎゅうこまぎれにく', 400],
      ['ぴーまん', 150],
      ['たまねぎ', 150],
      ['かたくりこ', 8, '大さじ1'],
      ['しょうゆ', 27, '大さじ1.5'],
      ['みりん', 27, '大さじ1.5'],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('ピーマンと玉ねぎを細切りにする', 7, 7),
      st('牛肉に片栗粉をまぶす', 2, 2),
      st('強火で炒め、調味料を加えてからめる', 8, 5, 'stovetop_burner', [0, 1]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['牛肉', '高たんぱく'],
  },
  {
    title: '鶏むねのカレー炒め',
    role: 'main',
    summary: '香りが強いので冷めてもぼやけない。弁当向き',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['とりむねにく', 600],
      ['たまねぎ', 200],
      ['かれーこ', 8, '大さじ1'],
      ['しお', 4, '小さじ0.7'],
      ['さらだあぶら', 10, '大さじ0.8'],
    ],
    steps: [
      st('鶏むねをそぎ切り、玉ねぎをくし形に切る', 8, 8),
      st('油で炒め、カレー粉と塩をふって炒め合わせる', 9, 5, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['鶏肉', '高たんぱく', '日持ち'],
  },
  {
    title: 'なすと豚こまの味噌炒め',
    role: 'main',
    summary: 'なすは油を吸うので、先に炒めてから肉を入れる',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['なす', 400],
      ['ぶたこまぎれにく', 350],
      ['みそ', 45, '大さじ2.5'],
      ['みりん', 27, '大さじ1.5'],
      ['ごまあぶら', 10, '大さじ0.8'],
    ],
    steps: [
      st('なすを乱切りにする', 6, 6),
      st('なすを油で炒め、豚肉を加えて火を通す', 9, 5, 'stovetop_burner', [0]),
      st('味噌とみりんを加えてからめる', 3, 2, 'stovetop_burner', [1]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['豚肉', '野菜'],
  },
  {
    title: '鮭のちゃんちゃん焼き',
    role: 'main',
    summary: '野菜と一緒に蒸し焼きにする。副菜がいらない量になる',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['さけ', 400],
      ['きゃべつ', 300],
      ['えのき', 150],
      ['みそ', 45, '大さじ2.5'],
      ['みりん', 27, '大さじ1.5'],
      ['さらだあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('キャベツをざく切り、えのきをほぐす', 6, 6),
      st('鮭と野菜を並べ、味噌だれをかけて蓋をして蒸し焼き', 12, 4, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 2, reheatNote: '600Wで2分' },
    tags: ['魚', '高たんぱく', '野菜'],
  },
  {
    title: '鶏ももとじゃがいもの照り煮',
    role: 'main',
    summary: '主食を減らしたい週に。じゃがいもで炭水化物を稼ぐ',
    servings: 4,
    yieldFactor: 0.85,
    items: [
      ['とりももにく', 400],
      ['じゃがいも', 400],
      ['たまねぎ', 150],
      ['にんじん', 100],
      ['しょうゆ', 36, '大さじ2'],
      ['みりん', 36, '大さじ2'],
      ['さとう', 9, '大さじ1'],
    ],
    steps: [
      st('じゃがいも・にんじん・玉ねぎを乱切りにする', 9, 9),
      st('鶏肉を焼きつけ、野菜と調味料を加えて煮る', 20, 5, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分半' },
    tags: ['鶏肉', '日持ち', '放置できる'],
  },
  {
    title: '鶏むねのケチャップ炒め',
    role: 'main',
    summary: '甘めなので、味の濃い副菜と合わせない',
    servings: 4,
    yieldFactor: 0.8,
    items: [
      ['とりむねにく', 600],
      ['たまねぎ', 150],
      ['けちゃっぷ', 60, '大さじ3'],
      ['かたくりこ', 12, '大さじ1.5'],
      ['さらだあぶら', 10, '大さじ0.8'],
    ],
    steps: [
      st('鶏むねを一口大に切り、片栗粉をまぶす', 8, 8),
      st('焼いてから玉ねぎとケチャップを加えてからめる', 9, 4, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 3, reheatNote: '600Wで2分' },
    tags: ['鶏肉', '高たんぱく'],
  },
];

/** 副菜の追加分。なす・じゃがいも・えのき・納豆・マヨネーズの受け皿 */
const SIDES3: SeedRecipe[] = [
  {
    title: '納豆とねぎ',
    role: 'side',
    summary: '混ぜるだけ。たんぱく質と発酵食品を1品で足す',
    servings: 5,
    yieldFactor: 1.0,
    items: [
      ['なっとう', 200],
      ['ながねぎ', 40],
      ['しょうゆ', 12, '小さじ2'],
    ],
    steps: [st('ねぎを刻んで納豆と混ぜ、しょうゆを加える', 3, 3)],
    storage: { location: 'fridge', keepsDays: 2 },
    tags: ['時短', '高たんぱく', '節約'],
  },
  {
    title: 'ポテトサラダ',
    role: 'side',
    summary: '炭水化物を副菜側で稼ぐ。ごはんを減らしたい週に',
    servings: 5,
    yieldFactor: 0.9,
    items: [
      ['じゃがいも', 400],
      ['にんじん', 80],
      ['たまねぎ', 60],
      ['まよねーず', 60, '大さじ4'],
      ['しお', 2, '小さじ0.3'],
      ['こしょう', 1],
    ],
    steps: [
      st('じゃがいもとにんじんを切ってゆでる', 14, 4, 'stovetop_burner'),
      st('玉ねぎを薄切りにする', 3, 3),
      st('湯を切ってつぶし、玉ねぎとマヨネーズで和える', 6, 6, undefined, [0, 1]),
    ],
    storage: { location: 'fridge', keepsDays: 3 },
    tags: ['野菜', '日持ち'],
  },
  {
    title: 'なすの煮びたし',
    role: 'side',
    summary: '冷やすと味が入る。作った翌日のほうがうまい',
    servings: 5,
    yieldFactor: 0.85,
    items: [
      ['なす', 400],
      ['しょうゆ', 27, '大さじ1.5'],
      ['みりん', 27, '大さじ1.5'],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('なすを縦半分に切って切れ目を入れる', 5, 5),
      st('ごま油で焼きつけ、調味料を加えて煮含める', 10, 2, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 4 },
    tags: ['野菜', '日持ち'],
  },
  {
    title: 'えのきとピーマンのきんぴら',
    role: 'side',
    summary: 'きのこで食物繊維、ピーマンで色。原価が低い',
    servings: 5,
    yieldFactor: 0.8,
    items: [
      ['えのき', 200],
      ['ぴーまん', 200],
      ['しょうゆ', 18, '大さじ1'],
      ['みりん', 18, '大さじ1'],
      ['ごまあぶら', 8, '小さじ2'],
    ],
    steps: [
      st('ピーマンを細切り、えのきをほぐす', 6, 6),
      st('ごま油で炒め、調味料を加えて水分を飛ばす', 7, 4, 'stovetop_burner', [0]),
    ],
    storage: { location: 'fridge', keepsDays: 4 },
    tags: ['野菜', '緑', '日持ち', '節約'],
  },
];

import { BUILTIN_RECIPES_MORE } from './recipes-more';
import { BUILTIN_RECIPES_WORLD } from './recipes-world';
import { BUILTIN_RECIPES_SNACK } from './recipes-snack';
import { BUILTIN_RECIPES_BEEF } from './recipes-beef';
import { BUILTIN_RECIPES_NOODLE } from './recipes-noodle';

export const BUILTIN_RECIPES: SeedRecipe[] = [
  ...MAINS,
  ...MAINS2,
  ...FAST_MAINS,
  ...MAINS3,
  ...PASTA,
  ...SIDES,
  ...SIDES2,
  ...FAST_SIDES,
  ...SIDES3,
  ...STAPLES,
  // 書き起こしの追加分。主菜と副菜が少ないと、14食を2〜3品で埋めることになる
  ...BUILTIN_RECIPES_MORE,
  // 洋食・中華・カレー・麺類。和食だけだと毎週同じ顔になる
  ...BUILTIN_RECIPES_WORLD,
  // 間食とパンの朝食。間食の枠に食事が入っていたのを直すために要る
  ...BUILTIN_RECIPES_SNACK,
  // 牛肉。鶏・豚に比べて数が足りず、「牛肉を2食」が組めなかった
  ...BUILTIN_RECIPES_BEEF,
  // 麺。8品のうち高たんぱくが2品しかなく、麺の週はたんぱく質が目標を割っていた
  ...BUILTIN_RECIPES_NOODLE,
];
