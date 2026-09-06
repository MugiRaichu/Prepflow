import { useRef, useState } from 'react';
import { Camera, Check, X } from 'lucide-react';
import { db, nowIso } from '@/db/db';
import { readReceipt, ocrSupported } from './logic/ocr';
import { extractTotal, matchLine, sumMatchedYen, sumUnmatchedYen, toLines } from './logic/receipt';
import type { MatchCandidate, ReceiptLine } from './logic/receipt';
import { yen } from '@/lib/labels';
import type { ShoppingListItem } from '@/db/schema';
import { cn } from '@/lib/utils';

/**
 * レシートを撮って読み取る。
 *
 * 読み取り結果は**必ず画面に出して確認させる**。黙って採用しない。
 * 感熱紙の日本語 OCR の精度は事前に測れないので、
 * 「間違えたら気づける」形にしておくことが唯一の安全策になる（D-046）。
 *
 * 品名の照合は「今週の買い出しリストに載っている6〜8品」だけを候補にする。
 * 食材マスタ全体と照合しないので、素朴な文字列比較でも十分に当たる。
 */
export function ReceiptScan({
  items,
  onDone,
}: {
  items: ShoppingListItem[];
  onDone: (total: number | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0);
  const [lines, setLines] = useState<ReceiptLine[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async (file: File) => {
    setError(null);
    setBusy('準備しています');
    setRatio(0);
    try {
      // 食材マスタの nameKey（ひらがな）も候補に足す。照合の当たりが上がる
      const ings = await db.ingredients.bulkGet(items.map((i) => i.ingredientId));
      const cands: MatchCandidate[] = items.map((i, idx) => ({
        ingredientId: i.ingredientId,
        nameKey: ings[idx]?.nameKey ?? i.name,
        name: i.name,
      }));

      const text = await readReceipt(file, (p) => {
        setBusy(p.label);
        setRatio(p.ratio);
      });

      const rows = toLines(text);
      setTotal(extractTotal(rows));
      setLines(
        rows.map((l) => matchLine(l, cands)).filter((m) => m.ingredientId || m.priceYen != null),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み取りに失敗しました');
    } finally {
      setBusy(null);
    }
  };

  /** 確認して確定する。品目ごとの実売価格を控え、次からの見込みに使う */
  const commit = async () => {
    if (!lines) return;
    const matched = lines.filter((l) => l.ingredientId && l.priceYen != null);

    for (const m of matched) {
      const item = items.find((i) => i.ingredientId === m.ingredientId);
      if (!item) continue;
      await db.shoppingListItems.put({
        ...item,
        actualPriceYen: m.priceYen!,
        updatedAt: nowIso(),
      });

      // 1購入単位あたりの実売価格を、想定価格へ半分だけ寄せる。
      // 特売の週に一度で全部持っていかれないため
      const ing = await db.ingredients.get(m.ingredientId!);
      if (ing && item.purchaseUnits > 0) {
        const unitPrice = m.priceYen! / item.purchaseUnits;
        const next = Math.round(ing.purchase.typicalPriceYen * 0.5 + unitPrice * 0.5);
        if (next > 0 && next < ing.purchase.typicalPriceYen * 4) {
          await db.ingredients.put({
            ...ing,
            purchase: { ...ing.purchase, typicalPriceYen: next, priceUpdatedAt: nowIso() },
            updatedAt: nowIso(),
          });
        }
      }
    }
    // **レシートの合計ではなく、食材だけの合計を返す。**
    // 同じ会計で日用品を買っていても、食費の実績が汚れない
    onDone(sumMatchedYen(lines));
  };

  if (!ocrSupported()) return null;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <div className="text-sm font-medium">レシートを読み取る</div>
        <p className="text-[11px] text-muted-foreground">
          品目ごとの値段を読み取ります。初回は準備に少し時間がかかります。
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void scan(f);
        }}
      />

      {!lines && (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={Boolean(busy)}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border text-sm active:bg-accent disabled:opacity-50"
        >
          <Camera className="size-4" />
          {busy ?? 'レシートを撮る'}
        </button>
      )}

      {busy && (
        <div className="h-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-foreground transition-all"
            style={{ width: Math.round(ratio * 100) + '%' }}
          />
        </div>
      )}

      {error && <div className="text-[11px] text-foreground">読み取れませんでした: {error}</div>}

      {lines && (
        <ScanResult
          lines={lines}
          total={total}
          items={items}
          onAssign={(index, ingredientId) =>
            setLines((cur) =>
              (cur ?? []).map((l, i) =>
                i === index ? { ...l, ingredientId, score: ingredientId ? 1 : 0 } : l,
              ),
            )
          }
        />
      )}

      {lines && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setLines(null);
              setTotal(null);
            }}
            className="min-h-11 rounded-md border text-sm active:bg-accent"
          >
            <X className="mr-1 inline size-3.5" />
            撮り直す
          </button>
          <button
            onClick={commit}
            className="min-h-11 rounded-md bg-foreground text-sm font-medium text-background"
          >
            <Check className="mr-1 inline size-3.5" />
            この内容で確定
          </button>
        </div>
      )}
    </div>
  );
}

function ScanResult({
  lines,
  total,
  items,
  onAssign,
}: {
  lines: ReceiptLine[];
  total: number | null;
  items: ShoppingListItem[];
  onAssign: (index: number, ingredientId: string | null) => void;
}) {
  const nameOf = (id: string | null) =>
    id ? (items.find((i) => i.ingredientId === id)?.name ?? null) : null;

  // 行の位置を保ったまま拾う。割り当ては index で書き戻す
  const matched = lines.map((l, i) => ({ l, i })).filter((x) => x.l.ingredientId);
  const unmatched = lines.map((l, i) => ({ l, i })).filter((x) => !x.l.ingredientId && x.l.priceYen != null);

  /*
   * まだ見つかっていない買い出しの品。
   *
   * **これが空なら、残りの行は日用品とみなして何も聞かない。**
   * レシートの大半は食材以外なので、全部について尋ねると作業になる。
   * 「買ったはずなのに読み取れなかった食材」が残っているときだけ拾わせる。
   */
  const takenIds = new Set(matched.map((x) => x.l.ingredientId));
  const missing = items.filter((i) => !takenIds.has(i.ingredientId));
  const foodYen = sumMatchedYen(lines);
  const otherYen = sumUnmatchedYen(lines);

  return (
    <div className="space-y-3">
      {/*
        出すのは**食材だけの合計**。レシート全体の額は参考として小さく添える。
        同じ会計で洗剤やティッシュを買っても、食費の実績には入れない
      */}
      <div className="rounded-md border p-3">
        <div className="text-[10px] text-muted-foreground">今回の食材だけの合計</div>
        <div className="text-lg font-semibold tabular-nums">{yen(foodYen)}</div>
        <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {total != null && <>レシート全体は {yen(total)}。</>}
          {otherYen > 0 && <> 食材と判断できなかった {yen(otherYen)} は数えていません。</>}
          {foodYen === 0 && '1件も読み取れませんでした。下の欄に手で入れてください。'}
        </div>
      </div>

      {matched.length > 0 && (
        <div className="overflow-hidden rounded-md border">
          {matched.map(({ l, i }, n) => (
            <div key={i} className={cn('flex items-center gap-2 px-3 py-2', n > 0 && 'border-t')}>
              <span className="min-w-0 flex-1 truncate text-xs">{nameOf(l.ingredientId)}</span>
              <span
                className={cn(
                  'shrink-0 text-[9px]',
                  l.score >= 0.6 ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {l.score >= 0.6 ? '' : '要確認'}
              </span>
              <span className="shrink-0 text-xs tabular-nums">{yen(l.priceYen ?? 0)}</span>
              {/* 違うものに当てていたら外せる。外すと下の「これは？」に戻る */}
              <button
                onClick={() => onAssign(i, null)}
                aria-label="外す"
                className="shrink-0 p-1 text-muted-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/*
        読み取れなかった食材が残っているときだけ、拾う手を出す。
        全部見つかっていれば、残りの行は日用品なので触らせない
      */}
      {missing.length > 0 && unmatched.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-[10px] leading-relaxed text-muted-foreground">
            {missing.map((i) => i.name).join('・')} が見つかりませんでした。
            この中にあれば押してください。無ければそのままで構いません
            （日用品は数えません）。
          </div>
          {unmatched.map(({ l, i }) => (
            <div key={i} className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[11px]">{l.raw}</span>
                <span className="shrink-0 text-[11px] tabular-nums">{yen(l.priceYen ?? 0)}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {missing.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onAssign(i, m.ingredientId)}
                    className="min-h-8 rounded border px-2 text-[11px] active:bg-accent"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">違っていたら撮り直してください。</p>
    </div>
  );
}
