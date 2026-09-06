/**
 * 食材マスタの追加分。
 *
 * 和食だけでは献立が偏る。洋・中・カレー・麺類を書くには、
 * ルー・麺・酢・小麦粉・乳製品といった土台の食材が要る。
 * ここが無いままレシピだけ足しても、作れる料理の幅は広がらない。
 *
 * 栄養値は日本食品標準成分表（八訂）の可食部100gあたりの概数。
 * 価格は2026年時点のスーパーの実勢を想定した典型価格。
 *
 * **アレルゲンは必ず入れる。**ここを抜かすと、アレルギー指定が効かないまま
 * 献立に出る。小麦粉・パン粉・麺・ルー・ソース類は特に落としやすい。
 */
import type { SeedIngredient } from './ingredients';
import { ing } from './ingredients';

/** 肉・魚。ひき肉と加工肉を足して、洋と中の主菜が組めるようにする */
const MEAT_MORE: SeedIngredient[] = [
  ing('鶏ひき肉', 'とりひきにく', 'meat_fish', [171, 17.5, 12.0, 0.0], ['pack', 300, 380], {
    aliases: ['鶏ミンチ'],
    fridge: 2,
    freezer: 30,
    freezeOk: true,
    allergens: ['chicken'],
  }),
  ing('合いびき肉', 'あいびきにく', 'meat_fish', [224, 17.0, 16.1, 0.3], ['pack', 300, 400], {
    fridge: 2,
    freezer: 30,
    freezeOk: true,
    allergens: ['beef', 'pork'],
  }),
  ing('豚バラ薄切り肉', 'ぶたばらにく', 'meat_fish', [366, 14.2, 34.6, 0.1], ['pack', 250, 420], {
    aliases: ['豚バラ'],
    fridge: 2,
    freezer: 30,
    freezeOk: true,
    allergens: ['pork'],
  }),
  ing('ベーコン', 'べーこん', 'meat_fish', [400, 12.9, 39.1, 0.3], ['pack', 100, 250], {
    fridge: 14,
    allergens: ['pork'],
  }),
  ing('むきえび', 'えび', 'meat_fish', [82, 18.4, 0.3, 0.3], ['pack', 200, 500], {
    aliases: ['えび', 'エビ'],
    fridge: 2,
    freezer: 30,
    freezeOk: true,
    allergens: ['shrimp'],
  }),
];

/** 日配。豆腐まわりと乳製品。洋食の土台になる */
const CHILLED_MORE: SeedIngredient[] = [
  ing('油揚げ', 'あぶらあげ', 'daily_chilled', [377, 23.4, 34.4, 0.4], ['pack', 90, 120], {
    perPiece: 30,
    fridge: 7,
    allergens: ['soy'],
  }),
  ing('ちくわ', 'ちくわ', 'daily_chilled', [121, 12.2, 2.0, 13.5], ['pack', 120, 130], {
    perPiece: 30,
    fridge: 10,
    allergens: ['wheat'],
  }),
  ing('スライスチーズ', 'ちーず', 'daily_chilled', [313, 22.7, 26.0, 1.3], ['pack', 126, 280], {
    aliases: ['チーズ'],
    perPiece: 18,
    fridge: 60,
    allergens: ['milk'],
  }),
  ing('しらたき', 'しらたき', 'daily_chilled', [7, 0.2, 0.0, 3.0], ['pack', 200, 90], {
    aliases: ['糸こんにゃく'],
    fridge: 20,
  }),
];

/** 野菜。中華と洋食で使うものを中心に */
const PRODUCE_MORE: SeedIngredient[] = [
  ing('白菜', 'はくさい', 'produce', [13, 0.8, 0.1, 3.2], ['piece', 800, 300], {
    yieldRatio: 0.94,
    fridge: 10,
  }),
  ing('きゅうり', 'きゅうり', 'produce', [13, 1.0, 0.1, 3.0], ['pack', 300, 180], {
    perPiece: 100,
    yieldRatio: 0.98,
    fridge: 7,
  }),
  ing('レタス', 'れたす', 'produce', [11, 0.6, 0.1, 2.8], ['piece', 300, 200], {
    yieldRatio: 0.98,
    fridge: 5,
  }),
  ing('かぼちゃ', 'かぼちゃ', 'produce', [78, 1.9, 0.3, 20.6], ['pack', 400, 300], {
    yieldRatio: 0.9,
    fridge: 10,
  }),
  ing('ごぼう', 'ごぼう', 'produce', [58, 1.8, 0.1, 15.4], ['pack', 200, 180], {
    yieldRatio: 0.9,
    fridge: 14,
  }),
  ing('れんこん', 'れんこん', 'produce', [66, 1.9, 0.1, 15.5], ['pack', 250, 250], {
    yieldRatio: 0.8,
    fridge: 10,
  }),
  ing('にら', 'にら', 'produce', [18, 1.7, 0.3, 4.0], ['bunch', 100, 150], {
    yieldRatio: 0.95,
    fridge: 4,
  }),
  ing('チンゲン菜', 'ちんげんさい', 'produce', [9, 0.6, 0.1, 2.0], ['bunch', 200, 150], {
    yieldRatio: 0.85,
    fridge: 5,
  }),
  ing('まいたけ', 'まいたけ', 'produce', [22, 3.7, 0.7, 4.4], ['pack', 100, 150], {
    yieldRatio: 0.9,
    fridge: 7,
  }),
];

/** 乾物・缶・麺。麺類とカレーの土台 */
const DRY_MORE: SeedIngredient[] = [
  ing('うどん（ゆで）', 'うどん', 'dry_grocery', [95, 2.6, 0.4, 21.6], ['pack', 600, 240], {
    aliases: ['ゆでうどん'],
    perPiece: 200,
    pantry: 60,
    allergens: ['wheat'],
  }),
  ing('中華麺（蒸し）', 'ちゅうかめん', 'dry_grocery', [162, 4.9, 1.7, 32.3], ['pack', 450, 240], {
    aliases: ['焼きそば麺', 'ラーメン'],
    perPiece: 150,
    pantry: 20,
    allergens: ['wheat', 'egg'],
  }),
  ing('そば（乾）', 'そば', 'dry_grocery', [344, 14.0, 2.3, 66.7], ['pack', 300, 260], {
    pantry: 365,
    allergens: ['buckwheat', 'wheat'],
  }),
  ing('春雨', 'はるさめ', 'dry_grocery', [346, 0.0, 0.2, 86.4], ['pack', 100, 180], {
    pantry: 365,
  }),
  ing('コーン缶', 'こーんかん', 'dry_grocery', [82, 2.3, 0.5, 18.6], ['can', 190, 130], {
    aliases: ['スイートコーン'],
    pantry: 720,
  }),
  ing('パン粉', 'ぱんこ', 'dry_grocery', [369, 14.6, 6.8, 63.4], ['pack', 200, 130], {
    pantry: 180,
    staple: true,
    allergens: ['wheat'],
  }),
  ing('食パン', 'しょくぱん', 'bakery', [248, 8.9, 4.1, 46.4], ['pack', 340, 180], {
    perPiece: 60,
    pantry: 4,
    freezer: 30,
    freezeOk: true,
    allergens: ['wheat', 'milk'],
  }),
];

/** 調味料。ここが無いと洋・中・カレーが一つも書けない */
const SEASONING_MORE: SeedIngredient[] = [
  ing('小麦粉', 'こむぎこ', 'seasoning', [349, 8.3, 1.5, 75.8], ['pack', 1000, 300], {
    aliases: ['薄力粉'],
    pantry: 365,
    staple: true,
    allergens: ['wheat'],
  }),
  ing('酢', 'す', 'seasoning', [37, 0.1, 0.0, 2.4], ['pack', 500, 200], {
    aliases: ['米酢', '穀物酢'],
    pantry: 720,
    staple: true,
  }),
  ing('バター', 'ばたー', 'seasoning', [700, 0.6, 81.0, 0.2], ['pack', 200, 500], {
    fridge: 120,
    staple: true,
    allergens: ['milk'],
  }),
  ing('ウスターソース', 'そーす', 'seasoning', [117, 1.0, 0.1, 27.1], ['pack', 500, 250], {
    aliases: ['ソース', '中濃ソース'],
    pantry: 365,
    staple: true,
    allergens: ['soy', 'wheat', 'apple'],
  }),
  ing('オイスターソース', 'おいすたーそーす', 'seasoning', [105, 7.7, 0.3, 18.3], ['pack', 250, 320], {
    pantry: 365,
    staple: true,
    allergens: ['soy', 'wheat'],
  }),
  ing('豆板醤', 'とうばんじゃん', 'seasoning', [60, 2.0, 2.3, 7.9], ['pack', 100, 250], {
    pantry: 365,
    staple: true,
    allergens: ['soy'],
  }),
  ing('カレールー', 'かれーるー', 'seasoning', [474, 6.5, 34.1, 44.7], ['pack', 200, 250], {
    aliases: ['カレールウ'],
    pantry: 365,
    allergens: ['wheat', 'milk', 'soy'],
  }),
  ing('顆粒コンソメ', 'こんそめ', 'seasoning', [233, 12.2, 4.3, 41.8], ['pack', 100, 250], {
    aliases: ['コンソメ'],
    pantry: 365,
    staple: true,
    allergens: ['soy', 'wheat', 'milk', 'chicken', 'beef'],
  }),
  ing('白すりごま', 'すりごま', 'seasoning', [605, 20.3, 54.2, 18.5], ['pack', 80, 200], {
    aliases: ['すりごま', 'ごま'],
    pantry: 180,
    staple: true,
    allergens: ['sesame'],
  }),
];

export const BUILTIN_INGREDIENTS_MORE: SeedIngredient[] = [
  ...MEAT_MORE,
  ...CHILLED_MORE,
  ...PRODUCE_MORE,
  ...DRY_MORE,
  ...SEASONING_MORE,
];
