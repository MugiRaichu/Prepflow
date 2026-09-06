/**
 * 食材マスタ（builtin）。
 *
 * 栄養値は日本食品標準成分表（八訂）の可食部100gあたりの概数。
 * 価格は2026年時点のスーパーの実勢を想定した「典型価格」で、地域差・季節差がある。
 * 実際に払った額は InventoryItem.paidPriceYen に溜まるので後で補正できる。
 *
 * yieldRatio は廃棄部＋調理ロスの合成。買うべき量 = 必要な可食部量 ÷ yieldRatio。
 * gramsPerUnit は1パック/1個あたりのグラム数。買い出しリストの丸めの根拠になる。
 */
import type { AllergenTag, Ingredient, StoreSection, Unit } from '../schema';

export type SeedIngredient = Omit<
  Ingredient,
  'id' | 'createdAt' | 'updatedAt' | 'deleted' | 'rev'
>;

interface Opts {
  aliases?: string[];
  /** 数えるときの1つあたりの重さ（卵1個=60g）。買う単位とは別 */
  perPiece?: number;
  yieldRatio?: number;
  fridge?: number;
  freezer?: number;
  pantry?: number;
  allergens?: AllergenTag[];
  staple?: boolean;
  freezeOk?: boolean;
}

/** 1行で1食材を定義するためのヘルパー */
export function ing(
  name: string,
  nameKey: string,
  section: StoreSection,
  /** 可食部100gあたり [kcal, たんぱく質g, 脂質g, 炭水化物g] */
  n: [number, number, number, number],
  /** 購入単位 [単位, 1単位のg, 典型価格] */
  p: [Unit, number, number],
  o: Opts = {},
): SeedIngredient {
  return {
    name,
    nameKey,
    aliases: o.aliases ?? [],
    section,
    nutritionPer100g: { kcal: n[0], proteinG: n[1], fatG: n[2], carbG: n[3] },
    purchase: {
      unit: p[0],
      gramsPerUnit: p[1],
      ...(o.perPiece ? { gramsPerPiece: o.perPiece } : {}),
      typicalPriceYen: p[2],
      minUnits: 1,
      unitStep: 1,
    },
    yieldRatio: o.yieldRatio ?? 1,
    shelfLife: {
      ...(o.fridge ? { fridgeDays: o.fridge } : {}),
      ...(o.freezer ? { freezerDays: o.freezer } : {}),
      ...(o.pantry ? { pantryDays: o.pantry } : {}),
    },
    allergens: o.allergens ?? [],
    isStaple: o.staple ? 1 : 0,
    freezeFriendly: o.freezeOk ?? false,
    source: 'builtin',
  };
}

// --- 精肉・鮮魚 -------------------------------------------------------------
const MEAT_FISH: SeedIngredient[] = [
  ing('鶏むね肉（皮なし）', 'とりむねにく', 'meat_fish', [105, 23.3, 1.9, 0.1], ['pack', 300, 260],
    { aliases: ['鶏胸肉', 'むね肉'], fridge: 2, freezer: 30, allergens: ['chicken'], freezeOk: true }),
  ing('鶏もも肉（皮なし）', 'とりももにく', 'meat_fish', [113, 19.0, 5.0, 0.0], ['pack', 300, 320],
    { aliases: ['もも肉'], fridge: 2, freezer: 30, allergens: ['chicken'], freezeOk: true }),
  ing('鶏ささみ', 'とりささみ', 'meat_fish', [98, 23.9, 0.8, 0.1], ['pack', 250, 300],
    { aliases: ['ささみ'], fridge: 2, freezer: 30, allergens: ['chicken'], freezeOk: true }),
  ing('豚こま切れ肉', 'ぶたこまぎれにく', 'meat_fish', [221, 18.5, 15.1, 0.2], ['pack', 300, 400],
    { aliases: ['豚こま'], fridge: 2, freezer: 21, allergens: ['pork'], freezeOk: true }),
  ing('豚ひき肉', 'ぶたひきにく', 'meat_fish', [209, 17.7, 17.2, 0.1], ['pack', 300, 380],
    { aliases: ['ひき肉'], fridge: 1, freezer: 21, allergens: ['pork'], freezeOk: true }),
  ing('牛こま切れ肉', 'ぎゅうこまぎれにく', 'meat_fish', [259, 17.1, 19.5, 0.3], ['pack', 250, 600],
    { aliases: ['牛こま'], fridge: 2, freezer: 21, allergens: ['beef'], freezeOk: true }),
  ing('鮭（切り身）', 'さけ', 'meat_fish', [124, 22.3, 4.1, 0.1], ['pack', 200, 400],
    { aliases: ['サーモン', '銀鮭'], yieldRatio: 0.9, fridge: 2, freezer: 30, allergens: ['salmon'], freezeOk: true }),
  ing('さば（切り身）', 'さば', 'meat_fish', [211, 20.6, 16.8, 0.3], ['pack', 200, 350],
    { aliases: ['サバ'], yieldRatio: 0.9, fridge: 2, freezer: 30, allergens: ['mackerel'], freezeOk: true }),
];

// --- 日配品 -----------------------------------------------------------------
const DAILY: SeedIngredient[] = [
  ing('卵', 'たまご', 'daily_chilled', [142, 12.2, 10.2, 0.4], ['pack', 600, 280],
    { perPiece: 60, aliases: ['鶏卵'], yieldRatio: 0.86, fridge: 14, allergens: ['egg'] }),
  ing('木綿豆腐', 'もめんどうふ', 'daily_chilled', [73, 7.0, 4.9, 1.5], ['pack', 300, 60],
    { perPiece: 300, aliases: ['豆腐'], fridge: 3, allergens: ['soy'] }),
  ing('厚揚げ', 'あつあげ', 'daily_chilled', [143, 10.7, 11.3, 0.9], ['pack', 200, 100],
    { perPiece: 100, aliases: ['生揚げ'], fridge: 3, allergens: ['soy'] }),
  ing('納豆', 'なっとう', 'daily_chilled', [190, 16.5, 10.0, 12.1], ['pack', 135, 110],
    { fridge: 7, allergens: ['soy'] }),
  ing('プレーンヨーグルト', 'よーぐると', 'daily_chilled', [56, 3.6, 3.0, 4.9], ['pack', 400, 160],
    { fridge: 10, allergens: ['milk'] }),
];

// --- 野菜 -------------------------------------------------------------------
const PRODUCE: SeedIngredient[] = [
  ing('ブロッコリー', 'ぶろっこりー', 'produce', [37, 5.4, 0.6, 6.6], ['piece', 250, 200],
    { yieldRatio: 0.65, fridge: 4, freezer: 30, freezeOk: true }),
  ing('玉ねぎ', 'たまねぎ', 'produce', [33, 1.0, 0.1, 8.4], ['piece', 200, 50],
    { aliases: ['タマネギ'], yieldRatio: 0.94, pantry: 30, freezeOk: true }),
  ing('にんじん', 'にんじん', 'produce', [35, 0.7, 0.2, 9.3], ['piece', 150, 50],
    { aliases: ['人参'], yieldRatio: 0.9, fridge: 14, freezeOk: true }),
  ing('キャベツ', 'きゃべつ', 'produce', [21, 1.3, 0.2, 5.2], ['piece', 1000, 200],
    { yieldRatio: 0.85, fridge: 7 }),
  ing('ピーマン', 'ぴーまん', 'produce', [20, 0.9, 0.2, 5.1], ['pack', 150, 150],
    { perPiece: 35, yieldRatio: 0.85, fridge: 7, freezeOk: true }),
  ing('もやし', 'もやし', 'produce', [15, 1.7, 0.1, 2.6], ['pack', 200, 40], { fridge: 2 }),
  ing('ほうれん草', 'ほうれんそう', 'produce', [18, 2.2, 0.4, 3.1], ['bunch', 200, 180],
    { yieldRatio: 0.9, fridge: 4, freezer: 30, freezeOk: true }),
  ing('小松菜', 'こまつな', 'produce', [13, 1.5, 0.2, 2.4], ['bunch', 250, 150],
    { yieldRatio: 0.85, fridge: 4, freezeOk: true }),
  ing('じゃがいも', 'じゃがいも', 'produce', [59, 1.8, 0.1, 17.3], ['piece', 130, 60],
    { aliases: ['ポテト'], yieldRatio: 0.9, pantry: 30 }),
  ing('大根', 'だいこん', 'produce', [15, 0.4, 0.1, 4.1], ['piece', 900, 160],
    { yieldRatio: 0.85, fridge: 10 }),
  ing('なす', 'なす', 'produce', [18, 1.1, 0.1, 5.1], ['pack', 250, 180],
    { perPiece: 80, aliases: ['茄子'], yieldRatio: 0.9, fridge: 5 }),
  ing('しめじ', 'しめじ', 'produce', [22, 2.7, 0.6, 4.8], ['pack', 100, 100],
    { yieldRatio: 0.9, fridge: 5, freezeOk: true }),
  ing('えのき', 'えのき', 'produce', [34, 2.7, 0.2, 7.6], ['pack', 200, 90],
    { yieldRatio: 0.85, fridge: 5, freezeOk: true }),
  ing('長ねぎ', 'ながねぎ', 'produce', [35, 1.4, 0.1, 8.3], ['piece', 120, 100],
    { aliases: ['ねぎ'], yieldRatio: 0.6, fridge: 7 }),
  ing('トマト', 'とまと', 'produce', [20, 0.7, 0.1, 4.7], ['piece', 150, 100],
    { yieldRatio: 0.97, fridge: 5 }),
  ing('にんにく', 'にんにく', 'produce', [129, 6.4, 0.9, 27.5], ['piece', 50, 120],
    { yieldRatio: 0.9, pantry: 30, staple: true }),
  ing('しょうが', 'しょうが', 'produce', [28, 0.9, 0.3, 6.6], ['piece', 60, 100],
    { aliases: ['生姜'], yieldRatio: 0.8, fridge: 14, staple: true }),
];

// --- 乾物・米・麺 -----------------------------------------------------------
const DRY: SeedIngredient[] = [
  ing('精白米', 'せいはくまい', 'dry_grocery', [342, 6.1, 0.9, 77.6], ['pack', 5000, 2600],
    { aliases: ['米', '白米'], pantry: 60, staple: true, freezeOk: true }),
  ing('オートミール', 'おーとみーる', 'dry_grocery', [350, 13.7, 5.7, 69.1], ['pack', 500, 400],
    { pantry: 180, allergens: ['wheat'] }),
  ing('スパゲッティ', 'すぱげってぃ', 'dry_grocery', [347, 12.9, 1.8, 73.1], ['pack', 500, 300],
    { aliases: ['パスタ'], pantry: 365, allergens: ['wheat'], staple: true }),
  ing('ツナ缶（水煮）', 'つなかん', 'dry_grocery', [70, 16.0, 0.7, 0.2], ['can', 70, 130],
    { aliases: ['シーチキン'], pantry: 365 }),
  ing('さば水煮缶', 'さばみずになかん', 'dry_grocery', [174, 20.9, 10.7, 0.2], ['can', 190, 220],
    { pantry: 365, allergens: ['mackerel'] }),
  ing('乾燥わかめ', 'かんそうわかめ', 'dry_grocery', [117, 13.6, 1.6, 41.3], ['pack', 30, 200],
    { pantry: 365, staple: true }),
  ing('切り干し大根', 'きりぼしだいこん', 'dry_grocery', [280, 9.7, 0.8, 69.7], ['pack', 50, 150],
    { pantry: 180 }),
  ing('ミックスビーンズ', 'みっくすびーんず', 'dry_grocery', [131, 8.1, 1.2, 22.0], ['pack', 100, 130],
    { pantry: 365, allergens: ['soy'] }),
  ing('カットトマト缶', 'かっととまとかん', 'dry_grocery', [21, 0.9, 0.2, 4.4], ['can', 400, 130],
    { aliases: ['トマト缶'], pantry: 365 }),
  ing('赤唐辛子', 'あかとうがらし', 'dry_grocery', [345, 14.7, 12.0, 58.4], ['pack', 10, 150],
    { aliases: ['鷹の爪'], pantry: 365, staple: true }),
];

// --- 調味料（既定では買い出しリストに載せない） -----------------------------
const SEASONING: SeedIngredient[] = [
  ing('しょうゆ', 'しょうゆ', 'seasoning', [77, 7.7, 0.0, 7.9], ['pack', 1000, 300],
    { aliases: ['醤油'], pantry: 365, staple: true, allergens: ['wheat', 'soy'] }),
  ing('みそ', 'みそ', 'seasoning', [182, 12.5, 6.0, 21.9], ['pack', 750, 350],
    { aliases: ['味噌'], fridge: 180, staple: true, allergens: ['soy'] }),
  ing('みりん', 'みりん', 'seasoning', [241, 0.3, 0.0, 43.2], ['pack', 500, 300],
    { pantry: 365, staple: true }),
  ing('料理酒', 'りょうりしゅ', 'seasoning', [88, 0.2, 0.0, 4.7], ['pack', 500, 250],
    { aliases: ['酒'], pantry: 365, staple: true }),
  ing('砂糖', 'さとう', 'seasoning', [391, 0.0, 0.0, 99.2], ['pack', 1000, 250],
    { pantry: 365, staple: true }),
  ing('塩', 'しお', 'seasoning', [0, 0.0, 0.0, 0.0], ['pack', 1000, 150],
    { pantry: 365, staple: true }),
  ing('サラダ油', 'さらだあぶら', 'seasoning', [886, 0.0, 100.0, 0.0], ['pack', 1000, 500],
    { aliases: ['油'], pantry: 365, staple: true }),
  ing('ごま油', 'ごまあぶら', 'seasoning', [890, 0.0, 100.0, 0.0], ['pack', 200, 400],
    { pantry: 365, staple: true, allergens: ['sesame'] }),
  ing('オリーブオイル', 'おりーぶおいる', 'seasoning', [894, 0.0, 100.0, 0.0], ['pack', 500, 700],
    { pantry: 365, staple: true }),
  ing('鶏がらスープの素', 'とりがらすーぷのもと', 'seasoning', [212, 12.0, 1.4, 35.4], ['pack', 120, 300],
    { pantry: 365, staple: true, allergens: ['chicken', 'soy'] }),
  ing('カレー粉', 'かれーこ', 'seasoning', [338, 13.0, 12.2, 63.3], ['pack', 100, 400],
    { pantry: 365, staple: true }),
  ing('こしょう', 'こしょう', 'seasoning', [362, 11.0, 6.0, 66.6], ['pack', 50, 200],
    { pantry: 365, staple: true }),
  ing('片栗粉', 'かたくりこ', 'seasoning', [338, 0.1, 0.1, 81.6], ['pack', 200, 150],
    { pantry: 365, staple: true }),
  ing('マヨネーズ', 'まよねーず', 'seasoning', [668, 1.4, 72.5, 3.6], ['pack', 400, 350],
    { fridge: 180, staple: true, allergens: ['egg'] }),
  ing('ケチャップ', 'けちゃっぷ', 'seasoning', [106, 1.6, 0.2, 27.6], ['pack', 500, 250],
    { fridge: 180, staple: true }),
];


/**
 * 間食・増量向け。
 *
 * 増量は1日の目標が3食に収まらない。TDEE+300〜500 kcal を3食だけで詰めると
 * 1食が重くなりすぎて食べきれないので、間食が要る。
 * ここは「手をかけずにカロリーとたんぱく質を足せるもの」を集めている。
 *
 * プロテインは商品ごとに成分が違う（1食25gのものも20gのものもある）ので、
 * ここに置くのは代表値。自分の製品は設定から登録して差し替える。
 */
const SNACK_PROTEIN: SeedIngredient[] = [
  ing('牛乳', 'ぎゅうにゅう', 'daily_chilled', [61, 3.3, 3.8, 4.8], ['pack', 1000, 230],
    { aliases: ['ミルク'], fridge: 7, allergens: ['milk'] }),
  ing('無調整豆乳', 'とうにゅう', 'daily_chilled', [44, 3.6, 2.0, 3.1], ['pack', 1000, 220],
    { aliases: ['豆乳'], fridge: 7, allergens: ['soy'] }),
  ing('ギリシャヨーグルト', 'ぎりしゃよーぐると', 'daily_chilled', [59, 10.0, 0.2, 4.2], ['pack', 400, 400],
    { aliases: ['高たんぱくヨーグルト'], fridge: 10, allergens: ['milk'] }),
  ing('ホエイプロテイン', 'ほえいぷろていん', 'other', [396, 75.0, 5.0, 10.0], ['pack', 1000, 4500],
    { aliases: ['プロテイン', 'プロテインパウダー'], pantry: 540, allergens: ['milk'], staple: true }),
  ing('バナナ', 'ばなな', 'produce', [93, 1.1, 0.2, 22.5], ['bunch', 500, 200],
    { perPiece: 100, yieldRatio: 0.6, pantry: 5, allergens: ['banana'] }),
  ing('アーモンド', 'あーもんど', 'other', [609, 19.6, 51.8, 20.9], ['pack', 200, 500],
    { aliases: ['素焼きアーモンド'], pantry: 180, allergens: ['almond'], staple: true }),
  ing('はちみつ', 'はちみつ', 'seasoning', [329, 0.3, 0.0, 81.9], ['pack', 500, 700],
    { pantry: 720, staple: true }),
  ing('きなこ', 'きなこ', 'dry_grocery', [451, 36.7, 25.7, 28.5], ['pack', 200, 250],
    { pantry: 180, allergens: ['soy'], staple: true }),
  ing('切り餅', 'きりもち', 'dry_grocery', [223, 4.0, 0.6, 50.3], ['pack', 400, 400],
    { perPiece: 50, aliases: ['餅'], pantry: 180 }),
  ing('冷凍ブルーベリー', 'ぶるーべりー', 'frozen', [48, 0.5, 0.1, 12.9], ['pack', 300, 400],
    { freezer: 365, freezeOk: true }),
];

import { BUILTIN_INGREDIENTS_MORE } from './ingredients-more';

export const BUILTIN_INGREDIENTS: SeedIngredient[] = [
  ...SNACK_PROTEIN,
  ...MEAT_FISH,
  ...DAILY,
  ...PRODUCE,
  ...DRY,
  ...SEASONING,
  // 洋・中・カレー・麺類の土台。ここが無いと和食しか書けない
  ...BUILTIN_INGREDIENTS_MORE,
];
