/**
 * スケジュールの根拠になる知見。
 *
 * ここは静的なテキストとして持つ。端末内AIに「説明させる」のではなく、
 * 説明はここに書いたものを出す。理由は2つある。
 *
 *  1. 小さなローカルモデルは、学習データに大量に含まれる俗説
 *     （「トレ後30分」「睡眠は22時〜2時」）をそのまま自信を持って答える。
 *     この2つはどちらも否定されている知見で、AIに語らせると害になる。
 *  2. 出典を添えられない。ここでは出典を並記する。
 *
 * 端末内AIの役割は「事実の生成」ではなく「この文章を本人の状況に合わせて言い換える」こと。
 *
 * 注意: 一般的な目安であって、個別の医学的助言ではない。
 * 断定を避け、体調や持病がある場合は専門家に相談する前提で書く。
 */

export interface KnowledgeEntry {
  id: string;
  /** 見出し。UI の「なぜ？」に出す */
  title: string;
  /** 2〜4行の本文 */
  body: string;
  /** よく信じられている誤り。あれば必ず併記する */
  myth?: string;
  /** 出典（著者・年・媒体）。リンクは貼らずテキストで持つ */
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
}

export const KNOWLEDGE: Record<string, KnowledgeEntry> = {
  protein_timing: {
    id: 'protein_timing',
    title: 'トレーニング後のタンパク質',
    body:
      '運動の前後どちらで摂っても差はほとんど出ません。効くのは1日の合計量のほうで、' +
      'タイミングの寄与は総量を揃えると消えます。' +
      '目安として、トレーニングの前後4〜6時間の間に通常の食事が入っていれば足ります。',
    myth:
      '「トレ後30分以内に摂らないと効果が消える（アナボリックウィンドウ）」は、' +
      '2013年以降の再検証で否定されています。急いで飲む必要はありません。',
    sources: [
      'Aragon & Schoenfeld (2013) Nutrient timing revisited: is there a post-exercise anabolic window? JISSN',
      'Schoenfeld, Aragon & Krieger (2013) The effect of protein timing on muscle strength and hypertrophy: a meta-analysis. JISSN',
    ],
    confidence: 'high',
  },

  sleep_golden_time: {
    id: 'sleep_golden_time',
    title: '睡眠と成長ホルモン',
    body:
      '成長ホルモンは時刻ではなく、入眠してから最初に訪れる深い眠り（ノンレム睡眠）で多く出ます。' +
      'これは入眠のおよそ60〜90分後に来るので、何時に寝ても訪れます。' +
      '効くのは「何時に寝るか」より「毎日ほぼ同じ時刻に寝て、最初の90分を邪魔しないこと」です。',
    myth:
      '「22時〜2時が睡眠のゴールデンタイム」は日本で広まった俗説です。' +
      '全員の体内時計が同じ時刻に揃っているわけではありません。',
    sources: [
      '成長ホルモン分泌と徐波睡眠（slow-wave sleep）の対応に関する睡眠生理学の一般的知見',
    ],
    confidence: 'high',
  },

  pre_sleep_protein: {
    id: 'pre_sleep_protein',
    title: '就寝前のタンパク質',
    body:
      '就寝の30〜60分前に消化の遅いタンパク質（乳製品など）を摂ると、' +
      '睡眠中の筋タンパク質合成が高まるという報告があります。' +
      'ただしこれは1日の合計量に足すのではなく、合計量の中で配分し直す話です。',
    sources: ['Res et al. (2012) Protein ingestion before sleep improves postexercise overnight recovery. MSSE'],
    confidence: 'medium',
  },

  dinner_before_sleep: {
    id: 'dinner_before_sleep',
    title: '夕食と就寝の間隔',
    body:
      '就寝直前に大きな食事を摂ると、消化のため深い眠りに入りにくくなります。' +
      '目安として就寝の2〜3時間前までに食べ終えると、最初の90分の眠りを妨げにくくなります。',
    sources: ['就寝前の食事と睡眠の質に関する一般的な生活指導'],
    confidence: 'medium',
  },

  caffeine_cutoff: {
    id: 'caffeine_cutoff',
    title: 'カフェインの締切',
    body:
      'カフェインは体内で半分に減るまで、おおよそ5〜6時間かかります。' +
      '夕方に飲んだぶんは就寝時にもまだ残っています。' +
      '就寝の6〜8時間前を最後にすると、寝つきと深い眠りへの影響を抑えられます。',
    sources: ['Drake et al. (2013) Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed. J Clin Sleep Med'],
    confidence: 'high',
  },

  meal_regularity: {
    id: 'meal_regularity',
    title: '食事の時刻を揃える',
    body:
      '食事の時刻が毎日ばらつくと、体内時計が乱れて食欲や睡眠に影響します。' +
      'とくに朝食の時刻は体内時計を合わせる手がかりになります。' +
      '完璧である必要はなく、だいたい同じ時間帯に固定するだけで効きます。',
    sources: ['末梢時計と摂食タイミングに関する時間栄養学の一般的知見'],
    confidence: 'medium',
  },

  training_fasted: {
    id: 'training_fasted',
    title: '空腹でのトレーニング',
    body:
      '直前の食事から時間が空いた状態でトレーニングした場合は、' +
      '終わってから比較的早めに食事を入れる意味があります。' +
      '逆に、トレーニング前に食事を摂っているなら急ぐ必要はありません。',
    sources: ['Aragon & Schoenfeld (2013) JISSN'],
    confidence: 'medium',
  },

  exercise_calories: {
    id: 'exercise_calories',
    title: '運動の消費カロリーは正確に出せません',
    body:
      '出しているのは METs という「平均的な人の値」からの概算です。体格・筋肉量・動作の速さ・' +
      '休憩の取り方で実際は大きく変わります。目安として ±30% の幅で見てください。' +
      'とくに筋トレは、動いている時間より休んでいる時間のほうが長いので推定が外れやすい種目です。' +
      '頼りになるのは推定値ではなく、2〜4週間の体重の推移のほうです。',
    myth:
      '「スマートウォッチが出す消費カロリーは正確」ではありません。' +
      '主要機種を比べた研究では、最も正確な機種でも誤差の中央値が約27%、' +
      '悪い機種は9割を超えました。心拍数は正確でも、消費カロリーは別の話です。',
    sources: [
      'Ainsworth et al. Compendium of Physical Activities (2011 update)',
      'Shcherbina et al. (2017) Accuracy in wrist-worn, sensor-based measurements of heart rate and energy expenditure in a diverse cohort. J Pers Med',
    ],
    confidence: 'high',
  },

  winddown: {
    id: 'winddown',
    title: '寝る前の1時間',
    body:
      '就寝前に強い光や刺激を受けると、寝つきが遅くなり最初の深い眠りが後ろへずれます。' +
      '就寝の60分前から照明を落とすと、入眠までの時間が短くなりやすくなります。',
    sources: ['就寝前の光曝露と入眠潜時に関する一般的な睡眠衛生指導'],
    confidence: 'medium',
  },
};

export const knowledgeOf = (id: string | undefined): KnowledgeEntry | undefined =>
  id ? KNOWLEDGE[id] : undefined;
