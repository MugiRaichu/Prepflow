import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/shared/AppShell';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { SettingsHome } from '@/features/settings/SettingsHome';
import { ProfileSettings } from '@/features/settings/ProfileSettings';
import { CookingSettings, ShoppingSettings } from '@/features/settings/ShoppingSettings';
import { KitchenSettings } from '@/features/settings/EquipmentSettings';
import { NotifySettings } from '@/features/settings/NotifySettings';
import { DataSettings } from '@/features/settings/DataSettings';
import { FamilyScreen } from '@/features/family/FamilyScreen';
import { JoinFamily } from '@/features/family/JoinFamily';
import { IngredientSettings } from '@/features/settings/IngredientSettings';
import { PlanScreen } from '@/features/planner/PlanScreen';
import { WeekOverview } from '@/features/planner/WeekOverview';
import { RhythmScreen } from '@/features/rhythm/RhythmScreen';
import { CookScreen } from '@/features/cook/CookScreen';
import { ShoppingScreen } from '@/features/shopping/ShoppingScreen';
import { StockScreen } from '@/features/shopping/StockScreen';
import { FreezerScreen } from '@/features/shopping/FreezerScreen';
import { RecipeList } from '@/features/recipes/RecipeList';
import { RecipeImport } from '@/features/recipes/RecipeImport';
import { db } from '@/db/db';

export default function App() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);
  /*
   * 読み込みが**終わらないとき**に、白い画面のまま置かない。
   *
   * 設定が読めるまで何も描かないのは、オンボーディングが一瞬見える事故を
   * 防ぐため。ふつうは一瞬で終わる。
   *
   * ただし IndexedDB は待たされることがある——別のタブが開いていて
   * スキーマの入れ替えを待っている、端末の空きが無い、といったとき。
   * そのあいだ `useLiveQuery` は undefined のままなので、**永遠に白い**。
   * 使う側からは「押したら真っ白になった」としか見えない。
   */
  const [slow, setSlow] = useState(false);
  /*
   * 待っている理由が分かっているなら、そう書く。
   * 「別のタブが古い版を開いたままで、入れ替えを待っている」は main.tsx が印を付ける
   */
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 4000);
    const b = window.setInterval(() => {
      if (document.documentElement.dataset['pfBlocked'] === '1') {
        setBlocked(true);
        setSlow(true);
      }
    }, 500);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(b);
    };
  }, []);

  if (settings === undefined) {
    if (!slow) return null;
    /*
      **`.pf-shell` に乗せる。**素の div のままだと、上端が時刻に重なる
      （避けるぶんを持っているのは外枠だけ）。ここも画面いっぱいの枠なので、
      同じものを使う
    */
    return (
      <div className="pf-shell overflow-y-auto bg-background text-foreground">
        <div className="mx-auto max-w-md space-y-4 p-6">
          <h1 className="text-xl font-semibold">
            {blocked ? 'ほかの画面で開いたままです' : '開くのに時間がかかっています'}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {blocked
              ? '別のタブかウィンドウで Prepflow が開いています。そちらを閉じると、こちらが動き出します。'
              : 'ほかの画面で Prepflow を開いたままだと、ここで待つことがあります。そちらを閉じてから、開き直してください。'}
          </p>
          <button
            onClick={() => location.reload()}
            className="min-h-12 w-full rounded-lg bg-foreground text-sm font-semibold text-background"
          >
            開き直す
          </button>
        </div>
      </div>
    );
  }

  const onboarded = Boolean(settings?.onboardedAt);

  // React Router は順序ではなく一致度でルートを選ぶ。
  // 未オンボーディングの分岐を Routes の中に混ぜると /dashboard のほうが
  // 具体的なので勝ってしまう。ツリーごと分ける。
  // GitHub Pages のようにサブパスへ置かれても動くよう、配信パスを基準にする
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {/*
        招待リンクで開かれたら、いちばん先に「入りますか」を出す。
        設定を済ませる前でも入れる——**先に家族に呼ばれた人**は、
        自分の設定より前に、みんなの買い出しリストを見たいはず
      */}
      <JoinFamily />
      {/*
        1画面が落ちてもアプリごと消えないように受け止める。
        受け止める場所が無いと、React は枝ごと消して**白い紙だけ**が残る
      */}
      <ErrorBoundary>{onboarded ? <MainRoutes /> : <OnboardingRoutes />}</ErrorBoundary>
    </BrowserRouter>
  );
}

function OnboardingRoutes() {
  return (
    <Routes>
      <Route path="*" element={<Onboarding />} />
    </Routes>
  );
}

function MainRoutes() {
  return (
    <Routes>
      <Route path="/welcome" element={<Onboarding />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/plan" element={<PlanScreen />} />
        <Route path="/week" element={<WeekOverview />} />
        <Route path="/shopping" element={<ShoppingScreen />} />
        <Route path="/stock" element={<StockScreen />} />
        <Route path="/freezer" element={<FreezerScreen />} />
        <Route path="/cook" element={<CookScreen />} />
        <Route path="/rhythm" element={<RhythmScreen />} />
        {/* 暮らしのひな形はやめた。自分で決めるほうが早い（本人判断） */}
        <Route path="/household" element={<Navigate to="/settings/cooking" replace />} />
        <Route path="/recipes" element={<RecipeList />} />
        <Route path="/recipes/new" element={<RecipeImport />} />
        <Route path="/settings" element={<SettingsHome />} />
        <Route path="/settings/profiles" element={<ProfileSettings />} />
        {/* 調理器具と保存容器は「台所の道具」に統合した */}
        <Route path="/settings/kitchen" element={<KitchenSettings />} />
        <Route path="/settings/equipment" element={<Navigate to="/settings/kitchen" replace />} />
        <Route path="/settings/containers" element={<Navigate to="/settings/kitchen" replace />} />
        <Route path="/settings/shopping" element={<ShoppingSettings />} />
        <Route path="/settings/cooking" element={<CookingSettings />} />
        <Route path="/settings/notify" element={<NotifySettings />} />
        {/* 「外とつなぐ」に統合した。古いリンクのために残す */}
        <Route path="/settings/health" element={<Navigate to="/settings/notify" replace />} />
        <Route path="/settings/family" element={<FamilyScreen />} />
        <Route path="/settings/data" element={<DataSettings />} />
        <Route path="/settings/ingredients" element={<IngredientSettings />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
