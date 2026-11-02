import { useEffect, type ReactNode } from 'react';
import logoDark from './assets/rab-logo.png';
import logoLight from './assets/rab-logo-white.png';

/** The Rocklea Abrasive Blasting logo. Black lettering normally, white lettering in dark mode. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <>
      <img src={logoDark} alt="Rocklea Abrasive Blasting" className={`block dark:hidden ${className}`} />
      <img src={logoLight} alt="Rocklea Abrasive Blasting" className={`hidden dark:block ${className}`} />
    </>
  );
}

export const money = (n: number | undefined) =>
  n === undefined ? '' : n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export function TopBar({ title, onBack, right, logo }: { title: string; onBack?: () => void; right?: ReactNode; logo?: boolean }) {
  return (
    <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b-4 border-brand bg-white/95 px-4 backdrop-blur dark:bg-slate-950/95">
      {onBack && (
        <button onClick={onBack} className="-ml-2 flex h-12 w-12 items-center justify-center rounded-xl text-2xl hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Back">
          ‹
        </button>
      )}
      {logo && <Logo className="h-10 w-auto shrink-0" />}
      <h1 className={`flex-1 truncate text-xl font-bold ${logo ? 'border-l-2 border-slate-300 pl-3 dark:border-slate-700' : ''}`}>{title}</h1>
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
