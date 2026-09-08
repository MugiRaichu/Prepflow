import { useEffect, useState } from 'react';
import { joinFamily, readInvite } from '@/family/share';

/**
 * 招待リンクで開かれたときに出す。
 *
 * **押すのは1回。入力は無い。**
 * URLも合言葉もリンクの中に入っているので、この画面に打つものはない。
 * スマホに慣れていない人が家族から呼ばれる場面を、ここまで短くする。
 *
 * 断る道も同じ大きさで置く。リンクは誤って開かれることがある。
 */
export function JoinFamily() {
  const [invite, setInvite] = useState<{ url: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setInvite(readInvite());
  }, []);

  if (!invite) return null;

  const join = async () => {
    setBusy(true);
    setError(null);
    const r = await joinFamily(invite.url, invite.token);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? '入れませんでした');
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-foreground/40 p-4">
      <div className="w-full space-y-3 rounded-xl bg-card p-5 shadow-lg">
        {done ? (
          <>
            <div className="text-base font-medium">入りました</div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              買い出しリストと家にある食材が、家族と同じになりました。
              体重や目標は共有されません。
            </p>
            <button
              onClick={() => setInvite(null)}
              className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background"
            >
              はじめる
            </button>
          </>
        ) : (
          <>
            <div className="text-base font-medium">家族の共有に入りますか</div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              買い出しリスト・家にある食材・作り置き・週の献立が、家族と同じになります。
              <b className="text-foreground">体重や目標は共有されません。</b>
            </p>
            {error && <p className="text-sm text-foreground">{error}</p>}
            <button
              onClick={() => void join()}
              disabled={busy}
              className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background disabled:opacity-40"
            >
              {busy ? '入っています…' : '入る'}
            </button>
            {/* 断る道を同じ大きさで置く。リンクは誤って開かれることがある */}
            <button
              onClick={() => {
                history.replaceState(null, '', location.pathname + location.search);
                setInvite(null);
              }}
              className="min-h-12 w-full rounded-lg border text-sm"
            >
              入らない
            </button>
          </>
        )}
      </div>
    </div>
  );
}
