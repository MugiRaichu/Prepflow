import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/shared/AppShell';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { SettingsHome } from '@/features/settings/SettingsHome';
import { ProfileSettings } from '@/features/settings/ProfileSettings';
import { CookingSettings, ShoppingSettings } from '@/features/settings/ShoppingSettings';
import { KitchenSettings } from '@/features/settings/EquipmentSettings';
import { NotifySettings } from '@/features/settings/NotifySettings';
import { DataSettings } from '@/features/settings/DataSettings';
import { IngredientSettings } from '@/features/settings/IngredientSettings';
import { PlanScreen } from '@/features/planner/PlanScreen';
import { WeekOverview } from '@/features/planner/WeekOverview';
import { RhythmScreen } from '@/features/rhythm/RhythmScreen';
import { CookScreen } from '@/features/cook/CookScreen';
import { HouseholdScreen } from '@/features/household/HouseholdScreen';
import { ShoppingScreen } from '@/features/shopping/ShoppingScreen';
import { StockScreen } from '@/features/shopping/StockScreen';
import { FreezerScreen } from '@/features/shopping/FreezerScreen';
import { RecipeList } from '@/features/recipes/RecipeList';
import { RecipeImport } from '@/features/recipes/RecipeImport';
import { db } from '@/db/db';

export default function App() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), []);

  // 設定の読み込み前は何も描かない（オンボーディングが一瞬見える事故を防ぐ）
  if (settings === undefined) return null;

  const onboarded = Boolean(settings?.onboardedAt);

  // React Router は順序ではなく一致度でルートを選ぶ。
  // 未オンボーディングの分岐を Routes の中に混ぜると /dashboard のほうが
  // 具体的なので勝ってしまう。ツリーごと分ける。
  // GitHub Pages のようにサブパスへ置かれても動くよう、配信パスを基準にする
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {onboarded ? <MainRoutes /> : <OnboardingRoutes />}
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
        <Route path="/household" element={<HouseholdScreen />} />
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
        <Route path="/settings/data" element={<DataSettings />} />
        <Route path="/settings/ingredients" element={<IngredientSettings />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
