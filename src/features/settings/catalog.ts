/**
 * 設定の目次。**どこに何があるかを、開かずに引けるようにする。**
 *
 * 設定の入口は13行だが、実際に触れる項目は30以上ある。それらは
 * 「作り方」「食べる人」のような画面名の下に入っていて、さらに一部は
 * 画面の中の `細かい設定` に畳まれている。
 *
 * つまり **項目名を知っていても、どの画面かは推測するしかなかった**（本人指摘）。
 *   ごはんの量 → 作り方？　炊飯時間 → 調理器具
 *   アレルギー → 食べる人　　好き嫌い → 食べる人
 *   賞味期限   → 作り方 > 細かい設定
 * 画面名を並べ替えても、この推測は無くならない。名前で引けるようにする。
 *
 * ここは**索引であって設定そのものではない**。値はそれぞれの画面が持つ。
 * 項目を足したり画面を分けたりしたら、ここも直す。
 */
export interface SettingEntry {
  /** 画面に出ている見出し。人が探すときに思い浮かべる言葉 */
  label: string;
  /** どの画面にあるか。行き先ではなく「場所の説明」 */
  where: string;
  to: string;
  /**
   * 別の言い方。**画面に出ていない言葉こそ入れる。**
   * 人は「賞味期限」で探すが、画面の見出しは「冷蔵で置く上限」になっている。
   */
  aliases?: string[];
  /** 画面の中でさらに畳まれている項目。開いてから探すことになるので伝える */
  folded?: boolean;
}

export const SETTING_CATALOG: SettingEntry[] = [
  // --- 自分のこと -----------------------------------------------------------
  {
    label: '目的（減量・維持・増量）',
    where: '食べる人',
    to: '/settings/profiles',
    aliases: ['ダイエット', '減量', '増量', '維持', 'ゴール', '目標'],
  },
  {
    label: '身長・体重・年齢・性別',
    where: '食べる人',
    to: '/settings/profiles',
    aliases: ['体格', 'たいかく', '体重', '身長', '年齢', '性別', 'BMI'],
  },
  {
    label: '活動量',
    where: '食べる人',
    to: '/settings/profiles',
    aliases: ['運動', '仕事', 'デスクワーク', '消費カロリー'],
  },
  {
    label: '目標体重・いつまでに',
    where: '食べる人',
    to: '/settings/profiles',
    aliases: ['何kg', '期限', '減量ペース', 'ダイエット'],
  },
  {
    label: 'アレルギー',
    where: '食べる人',
    to: '/settings/profiles',
    aliases: ['アレルゲン', 'あれるぎー', '卵', '乳', '小麦', 'そば', 'えび', 'かに', 'food allergy'],
  },
  {
    label: '好き嫌い（苦手な食材）',
    where: '食べる人',
    to: '/settings/profiles',
    aliases: ['嫌い', '苦手', '避けたい', '食べられない', 'にがて'],
  },
  {
    label: '食べる人を増やす・減らす',
    where: '食べる人',
    to: '/settings/profiles',
    aliases: ['人数', '家族', '2人分', '同居', 'プロフィール'],
  },
  {
    label: 'いまの暮らし',
    where: '作り方',
    to: '/settings/cooking',
    folded: true,
    aliases: ['一人暮らし', '共働き', '育休', '子ども', 'ライフステージ', '世帯'],
  },
  {
    label: '起きる時間・寝る時間',
    where: '1日の流れ',
    to: '/rhythm',
    aliases: ['起床', '就寝', '睡眠', '食事の時刻', '朝食の時間'],
  },
  {
    label: '毎週きまった予定（仕事・運動）',
    where: '1日の流れ',
    to: '/rhythm',
    aliases: ['習慣', 'ジム', 'トレーニング', '通勤', '予定'],
  },

  // --- 作ると買う -----------------------------------------------------------
  {
    label: '週に何回作るか',
    where: '作り方',
    to: '/settings/cooking',
    aliases: ['頻度', 'まとめて作る', '毎日作る', '作り置き', '回数'],
  },
  {
    label: '何日分つくるか',
    where: '作り方',
    to: '/settings/cooking',
    aliases: ['日数', '5日分', '平日', 'カバー'],
  },
  {
    label: 'どの食事を作るか（朝・昼・夕）',
    where: '作り方',
    to: '/settings/cooking',
    aliases: ['朝食', '昼食', '夕食', '弁当', '食事枠'],
  },
  {
    label: '1食のごはんの量',
    where: '作り方',
    to: '/settings/cooking',
    aliases: ['ごはん', '白米', '米', '糖質', '炭水化物', '主食', '食べない'],
  },
  {
    label: 'ごはんを炊く日',
    where: '作り方',
    to: '/settings/cooking',
    aliases: ['炊く', 'ごはん', '冷凍', 'まとめて炊く', '当日'],
  },
  {
    label: '作り置きをする曜日',
    where: '作り方',
    to: '/settings/cooking',
    folded: true,
    aliases: ['仕込み', '日曜', '曜日'],
  },
  {
    label: '1回の調理に使える時間',
    where: '作り方',
    to: '/settings/cooking',
    folded: true,
    aliases: ['時間', '何分', '忙しい', '時短'],
  },
  {
    label: '冷蔵で置く上限（賞味期限の決め方）',
    where: '作り方',
    to: '/settings/cooking',
    folded: true,
    aliases: ['賞味期限', '消費期限', '日持ち', '何日もつ', '冷凍', 'れいとう', '冷蔵', '保存', '傷む'],
  },
  {
    label: '同じ料理が続いてよい回数',
    where: '作り方',
    to: '/settings/cooking',
    folded: true,
    aliases: ['飽き', '同じもの', 'バリエーション', '品数'],
  },
  {
    label: '1週間の食費',
    where: '買い物と予算',
    to: '/settings/shopping',
    aliases: ['予算', '金額', 'お金', '節約', '円'],
  },
  {
    label: '買い出しの曜日',
    where: '買い物と予算',
    to: '/settings/shopping',
    aliases: ['買い物', 'スーパー', '曜日'],
  },
  {
    label: 'よく行く店の価格帯',
    where: '買い物と予算',
    to: '/settings/shopping',
    aliases: ['店', 'スーパー', '安い', '高い', '見込み金額', '値段'],
  },
  {
    label: '持っている調理器具',
    where: '台所の道具',
    to: '/settings/kitchen',
    aliases: ['コンロ', 'こんろ', 'レンジ', 'れんじ', '電子レンジ', 'オーブン', '炊飯器', 'すいはんき', '道具', '口数', '鍋'],
  },
  {
    label: 'ごはんが炊き上がるまでの時間',
    where: '台所の道具',
    to: '/settings/kitchen',
    aliases: ['炊飯', '炊飯器', '早炊き', '土鍋', '何分'],
  },
  {
    label: '保存容器の数と大きさ',
    where: '台所の道具',
    to: '/settings/kitchen',
    aliases: ['タッパー', 'たっぱー', '容器', '詰める', 'ふた', '保存容器'],
  },

  // --- 材料 -----------------------------------------------------------------
  {
    label: 'レシピを見る・自分で足す',
    where: 'レシピ',
    to: '/recipes',
    aliases: ['料理', '献立', '取り込み', 'インポート', '写真'],
  },
  {
    label: '食材とプロテインの値段・栄養',
    where: '食材・プロテイン',
    to: '/settings/ingredients',
    aliases: ['食材', '値段', '単価', 'プロテイン', '栄養', '調味料', '味噌', 'みそ', 'しょうゆ', '醤油', '油', 'カロリー'],
  },
  {
    label: '家にあるもの（棚卸し）',
    where: '家にあるもの',
    to: '/stock',
    aliases: ['在庫', '冷蔵庫', '残り', '棚卸し', '使い切り'],
  },

  // --- アプリ ---------------------------------------------------------------
  {
    label: 'LINE に今日の食事を送る',
    where: '外とつなぐ',
    to: '/settings/notify',
    aliases: ['通知', 'つうち', 'LINE', 'line', 'ライン', 'お知らせ', 'リマインド'],
  },
  {
    label: 'Google カレンダー連携',
    where: '外とつなぐ',
    to: '/settings/notify',
    aliases: ['カレンダー', '予定', 'Google', '同期'],
  },
  {
    label: 'iPhone ヘルスケア連携（歩数）',
    where: '外とつなぐ',
    to: '/settings/notify',
    aliases: ['歩数', 'ヘルスケア', 'Apple', 'ショートカット', '消費カロリー'],
  },
  {
    label: 'データの書き出し・戻す',
    where: 'データの保存',
    to: '/settings/data',
    aliases: ['バックアップ', 'エクスポート', '移行', '機種変更', '保存'],
  },
  {
    label: '最初から設定し直す',
    where: 'データの保存',
    to: '/settings/data',
    aliases: ['リセット', '初期化', '消す', 'やり直し', 'チュートリアル'],
  },
];

/**
 * 名前で引く。見出しと別名の両方を見る。
 *
 * 前方一致にしない。人は「賞味」からでも「期限」からでも探すので、
 * どこに含まれていても拾う。ひらがな・カタカナの違いまでは吸収しない
 * （そこまでやると誤爆が増える。別名で足すほうが確実）。
 */
export function searchSettings(query: string): SettingEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTING_CATALOG.filter(
    (e) =>
      e.label.toLowerCase().includes(q) ||
      e.where.toLowerCase().includes(q) ||
      (e.aliases ?? []).some((a) => a.toLowerCase().includes(q)),
  );
}
