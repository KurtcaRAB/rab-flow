import { useEffect, type ReactNode } from 'react';

export const money = (n: number | undefined) =>
  n === undefined ? '' : n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      {onBack && (
        <button onClick={onBack} className="-ml-2 flex h-12 w-12 items-center justify-center rounded-xl text-2xl hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Back">
          ‹
        </button>
      )}
      <h1 className="flex-1 truncate text-xl font-bold">{title}</h1>
      {right}
    </header>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl dark:bg-slate-900 sm:max-w-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="h-10 w-10 rounded-full text-xl hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-200">{children}</p>;
}

export function StatusChip({ status }: { status: string | null }) {
  if (!status) return null;
  const tone = status.startsWith('Found') || status.startsWith('Data sheet')
    ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200'
    : status.startsWith('Check')
      ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
      : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
  return <span className={`chip ${tone}`}>{status}</span>;
}
