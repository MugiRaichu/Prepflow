import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  backTo,
  action,
}: {
  title: string;
  backTo?: string;
  action?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-3">
      {backTo && (
        <Link to={backTo} className="-ml-1 flex size-11 items-center justify-center" aria-label="戻る">
          <ChevronLeft className="size-5" />
        </Link>
      )}
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
      {action}
    </div>
  );
}
