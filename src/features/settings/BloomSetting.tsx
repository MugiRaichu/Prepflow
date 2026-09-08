import { useEffect, useState } from 'react';
import { Chips } from '@/components/shared/Chips';

/**
 * 起動の絵を出すかどうか。
 *
 * **小さい丸や粒が並ぶ絵が苦手な人がいる。**集合体恐怖症
 * （トライポフォビア）は、小さい丸が密に集まった形で起きる。
 * 粉雪・星あかり・蛍のような絵は、その形そのものになりうる。
 *
 * 動きが苦手な人向けの端末設定（`prefers-reduced-motion`）とは別の話で、
 * そちらを入れていない人にも起きる。**別に切れるようにする。**
 * 探して見つからないと諦めることになるので、設定の一覧に出す。
 *
 * 置き場所は localStorage。この判断は**本体より先に要る**（DB を待つと、
 * 待っているあいだに絵が出てしまう）。端末ごとの見た目の設定なので、
 * 書き出しに含める必要もない。
 */
const KEY = 'pf-bloom';
type Mode = 'on' | 'still' | 'off';

const HINT: Record<Mode, string> = {
  on: '起動のたびに、季節の絵が動きます。背景にも薄く残ります',
  still: '動きません。背景に薄い柄だけが残ります',
  off: '何も出しません。無地の起動画面になります',
};

export function BloomSetting() {
  const [mode, setMode] = useState<Mode>('on');

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'still' || v === 'off') setMode(v);
    } catch {
      // 読めない端末（プライベートモードなど）では既定のまま
    }
  }, []);

  const change = (v: Mode) => {
    setMode(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // 保存できなくても、この画面の見た目は変えておく
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">起動のときの絵</div>
      <Chips
        options={[
          { value: 'on', label: '動かす' },
          { value: 'still', label: '止める' },
          { value: 'off', label: '出さない' },
        ]}
        value={mode}
        onChange={change}
        columns={3}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">{HINT[mode]}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        小さい粒がたくさん並ぶのが苦手な方は、「出さない」を選んでください。
        次に開いたときから変わります。
      </p>
    </div>
  );
}
