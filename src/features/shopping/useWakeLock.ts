import { useEffect, useState } from 'react';

/**
 * 買い出し中・調理中に画面が消えないようにする（D-015）。
 * カゴを持って歩いている間にスリープするのが、この用途で最大のストレスになる。
 *
 * Screen Wake Lock API は iOS 16.4+ / Chrome で使える。
 * 非対応でもアプリは普通に動くので、失敗は握りつぶしてよい種類の機能。
 * ただしタブが背面に回ると自動で解除されるので、復帰時に取り直す。
 */
export function useWakeLock(enabled: boolean): { supported: boolean; active: boolean } {
  const [active, setActive] = useState(false);
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  useEffect(() => {
    if (!enabled || !supported) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await sentinel.release();
          return;
        }
        setActive(true);
        sentinel.addEventListener('release', () => setActive(false));
      } catch {
        // 権限やバッテリーセーバーで拒否されることがある。機能なしで続行する
        setActive(false);
      }
    };

    // タブが前面に戻ったら取り直す（背面に回ると自動解除される）
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
      setActive(false);
    };
  }, [enabled, supported]);

  return { supported, active };
}
