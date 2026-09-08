import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '@/db/db';
import { ContainerGauge } from './ContainerGauge';

/**
 * 容器が足りるかを、買い出しのときに知らせる。
 *
 * 作り置きは詰める容器が無いと成立しない。当日になって足りないと分かっても、
 * その場では何もできない。**買い物に出る前が唯一の手当てできる時刻**。
 *
 * ただし**買い足しは最後の手段**にする（本人指摘）。容器は安いものではないし、
 * 置き場所も要る。足りないと分かった人がまずすべきなのは、
 * 「いま家にあるもので何とかする」方法を知ることで、買い物リストが増えることではない。
 *
 * 足りているときは何も出さない。出す意味のないものを画面に置かない（D-084）。
 */
export function ContainerCheck() {
  const plan = useLiveQuery(
    async () => (await db.weekPlans.where('deleted').equals(0).reverse().sortBy('weekStart'))[0],
    [],
  );
  const need = useLiveQuery(
    async () =>
      plan
        ? (await db.containerAssignments.where('weekPlanId').equals(plan.id).toArray()).filter(
            (a) => a.deleted === 0 && a.packed === 0,
          )
        : [],
    [plan?.id],
  );
  const containers = useLiveQuery(
    () => db.containers.where('deleted').equals(0).toArray(),
    [],
  );

  if (!need || !containers || need.length === 0) return null;

  const have = containers
    .filter((c) => c.isAvailable === 1)
    .reduce((n, c) => n + c.count, 0);
  const short = need.length - have;
  if (short <= 0) return null;

  // いちばん量の多い1食。まとめ詰めや買い足しの目安になる
  const maxGrams = Math.max(...need.map((a) => a.grams));
  // 詰めるものの半分以上が冷凍なら、皿にラップという逃げ道は使えない
  const freezerShare = need.filter((a) => a.storage === 'freezer').length / need.length;

  return (
    <div className="space-y-2 rounded-lg border p-4">
      {/*
        **数だけ言わない。**「容器が7個足りません」と出していたが、
        7を「今週の食事のうち7食ぶん」に翻訳し、そこから「皿を7枚出す」まで
        持っていく作業を人にやらせていた（本人指摘）。
        升が順に埋まり、足りない側に皿が出てくる絵にする。
      */}
      <ContainerGauge need={need.length} have={have} />

      <p className="text-xs leading-relaxed text-muted-foreground">
        買い足さなくても回せます。上から順に試してください。
      </p>

      <ol className="space-y-1.5 text-xs leading-relaxed">
        <li className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">1.</span>
          <span>
            <b>大きい容器にまとめて詰める。</b>
            同じ料理を1つにまとめ、食べるときに取り分けます。ラベルは1枚で足ります。
          </span>
        </li>
        {freezerShare < 1 && (
          <li className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">2.</span>
            <span>
              <b>皿に盛ってラップをかける。</b>
              冷蔵で2日以内に食べるぶんなら、これで足ります。
              {freezerShare > 0 && '冷凍するぶんには使えません。'}
            </span>
          </li>
        )}
        <li className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">{freezerShare < 1 ? '3.' : '2.'}</span>
          <span>
            <b>作る量を減らす。</b>
            献立の「何日分」を1日減らすと、容器も1日分減ります。
          </span>
        </li>
      </ol>

      <p className="text-xs leading-relaxed text-muted-foreground">
        それでも足りず、買い足すなら {maxGrams >= 400 ? '700ml' : '500ml'}{' '}
        以上が使いやすいです（いちばん多い1食が {Math.round(maxGrams)}g）。
      </p>

      <Link
        to="/settings/containers"
        className="flex min-h-11 w-full items-center justify-center rounded-md border text-xs active:bg-accent"
      >
        持っている数を直す
      </Link>
    </div>
  );
}
