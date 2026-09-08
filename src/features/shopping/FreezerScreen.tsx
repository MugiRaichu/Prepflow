import { PageHeader } from '@/components/shared/PageHeader';
import { PreppedList } from '@/features/cook/PreppedList';

/**
 * 作り置き一覧の単独画面。
 *
 * 中身は `PreppedList` に移した。同じものを「作り置き」タブからも見せるため
 * （詰めたあと何が残っているかは、作る画面の隣にあるべきだった）。
 * こちらは今日の画面のリンクから来る入口として残す。
 */
export function FreezerScreen() {
  return (
    <div className="pb-8">
      <PageHeader title="作り置き一覧" backTo="/dashboard" />
      <div className="p-4 pt-0">
        <PreppedList />
      </div>
    </div>
  );
}
