import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Check, ClipboardPaste, Trash2, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '@/db/db';
import { PageHeader } from '@/components/shared/PageHeader';
import { Chips } from '@/components/shared/Chips';
import { Stepper } from '@/components/shared/Stepper';
import { readImageText, ocrSupported } from '@/features/shopping/logic/ocr';
import type { OcrProgress } from '@/features/shopping/logic/ocr';
import { guessStep, matchIngredient, parseAmountText, splitRecipeText } from './logic/parse';
import { addRecipe } from '@/db/repositories/userRecipes';
import { isLinkOnly, takeShared } from './logic/shared';
import { cn } from '@/lib/utils';
import type { Ingredient, RecipeRole } from '@/db/schema';

interface Row {
  key: string;
  /** 読み取った元の行 */
  raw: string;
  name: string;
  amountText: string;
  ingredientId: string | null;
  grams: number;
  uncertain: boolean;
}

const ROLE_OPTIONS: { value: RecipeRole; label: string; hint: string }[] = [
  { value: 'main', label: '主菜', hint: '肉・魚が主役' },
  { value: 'side', label: '副菜', hint: '野菜・小鉢' },
  { value: 'staple', label: '主食', hint: 'ごはん・麺' },
];

/**
 * 自分のレシピを足す。
 *
 * **外部サイトを自動で読みには行かない。**（規約・著作権。決定記録 D-073）
 * 入り口は2つだけ。画面を撮った画像と、貼り付けた文。どちらも本人の操作から始まる。
 *
 * 読み取りは当てにいくが、当たったことにはしない。
 * 全行を出して、外した行はその場で直せるようにする。
 * 栄養と原価は保存時に食材マスタから計算するので、ここで数字は聞かない。
 */
export function RecipeImport() {
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [params] = useSearchParams();

  const [text, setText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState<OcrProgress | null>(null);
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<RecipeRole>('main');
  const [servings, setServings] = useState(2);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 共有で URL だけが来たとき、次に何をすればよいかを出す */
  const [sharedLink, setSharedLink] = useState<string | null>(null);

  const pool = useLiveQuery(() => db.ingredients.where('deleted').equals(0).toArray(), []);

  const byId = useMemo(
    () => new Map((pool ?? []).map((i) => [i.id, i])),
    [pool],
  );

  /** 読み取った文を解析して、直せる表にする */
  const analyze = (src: string) => {
    const list = pool ?? [];
    const parsed = splitRecipeText(src);

    const next: Row[] = parsed.items.map((it, i) => {
      const m = matchIngredient(it.name, list);
      const amt = parseAmountText(it.amountText, m.ingredient ?? undefined);
      return {
        key: 'r' + i,
        raw: it.raw,
        name: it.name,
        amountText: it.amountText,
        ingredientId: m.ingredient?.id ?? null,
        grams: Math.round(amt.grams ?? 0),
        uncertain: m.uncertain || amt.grams == null,
      };
    });

    setRows(next);
    setSteps(parsed.steps);
    if (parsed.servings) setServings(parsed.servings);
    // 最初の行がタイトルらしければ拾う（材料にも手順にもならなかった短い行）
    const head = src.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (head && head.length <= 30 && !title) setTitle(head);
  };

  const onImage = async (file: File) => {
    setError(null);
    setBusy({ ratio: 0, label: '準備しています' });
    try {
      const read = await readImageText(file, setBusy);
      setText(read);
      analyze(read);
    } catch {
      setError('画像を読めませんでした。明るいところで撮り直すか、文字を貼り付けてください');
    } finally {
      setBusy(null);
      // 画像は保存しない。1枚でレシピ数百件ぶんの容量になる
    }
  };

  /*
   * 共有シートから飛んできたときの受け取り。
   *
   * 画像なら文字認識にかけ、文なら解析にかける。どちらも本人が「共有」を
   * 押した結果なので、開いた瞬間に始めてよい。手数を1つでも減らす。
   */
  const took = useRef(false);
  useEffect(() => {
    // 食材マスタの読み込みを待つ。共有から来たときは画面が開いた瞬間に
    // 解析が走るので、待たないと**全行が「未選択」になる**（照合先が空のまま）
    if (params.get('shared') !== '1' || !pool || took.current) return;
    took.current = true;
    void (async () => {
      const got = await takeShared();
      if (got.file) {
        if (got.text && !isLinkOnly(got.text)) setTitle(got.text.split(/\r?\n/)[0].slice(0, 30));
        await onImage(got.file);
        return;
      }
      if (!got.text) return;
      if (isLinkOnly(got.text)) {
        // ページの中身は取りに行かない（規約・著作権）。何をすれば進むかだけ言う
        setSharedLink(got.text.split(/\r?\n/).find((l) => /^https?:/.test(l.trim())) ?? null);
        setTitle(got.text.split(/\r?\n/).find((l) => !/^https?:/.test(l.trim()))?.slice(0, 30) ?? '');
        return;
      }
      setText(got.text);
      analyze(got.text);
    })();
    // 受け取りは開いたとき1回だけ。params が変わっても繰り返さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, pool]);

  const save = async () => {
    if (!rows) return;
    setError(null);
    try {
      const r = await addRecipe({
        title,
        role,
        servings,
        items: rows
          .filter((x) => x.ingredientId && x.grams > 0)
          .map((x) => ({
            ingredientId: x.ingredientId!,
            grams: x.grams,
            ...(x.amountText ? { display: x.amountText } : {}),
          })),
        steps: steps.map(guessStep),
        keepsDays: 3,
        tags: ['自作'],
      });
      nav('/recipes', { state: { added: r.title } });
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした');
    }
  };

  const resolved = (rows ?? []).filter((r) => r.ingredientId && r.grams > 0).length;

  return (
    <div className="pb-8">
      <PageHeader title="レシピを足す" backTo="/recipes" />

      <div className="space-y-4 p-4">
        {!rows && sharedLink && (
          <div className="pf-rise space-y-2 rounded-lg border p-3">
            <div className="text-xs font-medium">ページを受け取りました</div>
            <div className="truncate text-[10px] text-muted-foreground">{sharedLink}</div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              中身は自動では読みません。材料の部分を長押しで選んでもう一度共有するか、
              その画面を撮って共有すると、そのまま取り込めます。
            </p>
          </div>
        )}

        {!rows && (
          <>
            {/* 主役は1つ。画像を撮って選ぶだけで終わる。文の貼り付けは脇に置く */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImage(f);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!ocrSupported() || Boolean(busy)}
              className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-lg bg-foreground text-base font-semibold text-background disabled:opacity-50"
            >
              <Camera className="size-6" />
              レシピの画面を撮った画像を選ぶ
            </button>

            {busy && (
              <div className="space-y-1.5 rounded-lg border p-3">
                <div className="text-xs">{busy.label}</div>
                <div className="h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-foreground transition-all"
                    style={{ width: Math.round(busy.ratio * 100) + '%' }}
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">
                  初回だけ読み取りエンジンを取得します（約5MB）。次からは通信なしで動きます。
                </div>
              </div>
            )}

            {!pasting ? (
              <button
                onClick={async () => {
                  setPasting(true);
                  try {
                    const t = await navigator.clipboard.readText();
                    if (t.trim()) {
                      setText(t);
                      analyze(t);
                    }
                  } catch {
                    // 許可が無い環境では欄に貼ってもらう
                  }
                }}
                className="flex min-h-10 w-full items-center justify-center gap-1.5 text-xs text-muted-foreground"
              >
                <ClipboardPaste className="size-3.5" />
                文をコピーしてある場合はこちら
              </button>
            ) : (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'鶏むね肉 300g\nしょうゆ 大さじ2\n…'}
                  rows={8}
                  autoFocus
                  className="w-full rounded-md border border-input bg-transparent p-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <button
                  onClick={() => analyze(text)}
                  disabled={!text.trim()}
                  className="min-h-11 w-full rounded-md border text-sm active:bg-accent disabled:opacity-50"
                >
                  読み取る
                </button>
              </>
            )}
          </>
        )}

        {rows && (
          <>
            <div className="space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="レシピの名前"
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Chips options={ROLE_OPTIONS} value={role} onChange={setRole} columns={3} />
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">何食分できるか</span>
                <Stepper value={servings} onChange={setServings} step={1} min={1} max={12} suffix="食" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">材料</span>
                <span className="text-[10px] text-muted-foreground">
                  {resolved} / {rows.length} 件が決まっています
                </span>
              </div>
              {rows.map((r) => (
                <ItemRow
                  key={r.key}
                  row={r}
                  pool={pool ?? []}
                  ingredient={r.ingredientId ? byId.get(r.ingredientId) : undefined}
                  onChange={(next) =>
                    setRows((cur) => (cur ?? []).map((x) => (x.key === r.key ? next : x)))
                  }
                  onRemove={() => setRows((cur) => (cur ?? []).filter((x) => x.key !== r.key))}
                />
              ))}
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">作り方</span>
              {steps.map((s, i) => {
                return (
                  <div key={i} className="flex gap-2 rounded-md border p-2.5">
                    <span className="w-4 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <textarea
                        value={s}
                        onChange={(e) =>
                          setSteps((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))
                        }
                        rows={2}
                        className="w-full resize-none bg-transparent text-xs outline-none"
                      />
                    </div>
                    <button
                      onClick={() => setSteps((cur) => cur.filter((_, j) => j !== i))}
                      className="shrink-0 self-start p-1 text-muted-foreground"
                      aria-label="この手順を消す"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              <button
                onClick={() => setSteps((cur) => [...cur, ''])}
                className="min-h-9 w-full rounded-md border text-[11px] text-muted-foreground active:bg-accent"
              >
                手順を足す
              </button>
              {/* 手順ごとの分数は出さない。直せるものではなく、合計だけ分かればよい */}
              <div className="text-[10px] tabular-nums text-muted-foreground">
                手を動かす時間の見込み {steps.reduce((n, s) => n + guessStep(s).hands, 0)} 分
              </div>
            </div>

            {error && <div className="rounded-md border border-foreground/40 p-3 text-xs">{error}</div>}

            <div className="space-y-2">
              <button
                onClick={save}
                disabled={resolved === 0 || !title.trim()}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-semibold text-background disabled:opacity-50"
              >
                <Check className="size-4" />
                保存する
              </button>
              <button
                onClick={() => {
                  setRows(null);
                  setSteps([]);
                  setPasting(false);
                }}
                className="min-h-10 w-full rounded-md border text-xs active:bg-accent"
              >
                読み取り直す
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 材料1行。読み取りが外れているところをここで直す。
 *
 * 食材が決まらない行は、グラム数を入れても栄養に反映されない。
 * それが分かるように、決まっていない行は枠を強調して先頭に理由を出す。
 */
function ItemRow({
  row,
  pool,
  ingredient,
  onChange,
  onRemove,
}: {
  row: Row;
  pool: Ingredient[];
  ingredient?: Ingredient;
  onChange: (r: Row) => void;
  onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState(row.name);

  const hits = useMemo(() => {
    const s = q.trim();
    if (!s) return pool.slice(0, 12);
    return pool
      .filter((i) => i.name.includes(s) || i.nameKey.includes(s) || i.aliases.some((a) => a.includes(s)))
      .slice(0, 12);
  }, [q, pool]);

  const unresolved = !row.ingredientId || row.grams <= 0;

  return (
    <div className={cn('rounded-md border p-2.5', unresolved && 'border-foreground/50')}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => setPicking(!picking)}
            className="block max-w-full truncate text-left text-sm font-medium"
          >
            {ingredient?.name ?? row.name}
            {!ingredient && <span className="ml-1 text-[10px] text-muted-foreground">（未選択）</span>}
          </button>
          <div className="truncate text-[10px] text-muted-foreground">{row.raw}</div>
        </div>
        <Stepper
          value={row.grams}
          onChange={(v) => onChange({ ...row, grams: v })}
          step={row.grams >= 100 ? 10 : 1}
          min={0}
          max={3000}
          suffix="g"
        />
        <button onClick={onRemove} className="shrink-0 p-1 text-muted-foreground" aria-label="消す">
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {picking && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="食材をさがす"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-xs outline-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {hits.map((i) => (
              <button
                key={i.id}
                onClick={() => {
                  // 食材が変わると1杯の重さも変わるので、分量を読み直す
                  const amt = parseAmountText(row.amountText, i);
                  onChange({
                    ...row,
                    ingredientId: i.id,
                    grams: Math.round(amt.grams ?? row.grams),
                    uncertain: false,
                  });
                  setPicking(false);
                }}
                className="min-h-9 rounded-md border px-2.5 text-[11px] active:bg-accent"
              >
                {i.name}
              </button>
            ))}
            {hits.length === 0 && (
              <span className="text-[10px] text-muted-foreground">
                見つかりません。設定 → 食材を足す から登録してください
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
