// Shared pieces for the job screens: stage colours, photo picker, customer picker.
import { useEffect, useMemo, useRef, useState } from 'react';
import { shrinkPhoto } from './lib/photos';
import type { Customer, JobStatus } from './lib/types';

// One colour per status so a job's stage reads at a glance across the yard board.
const STATUS_TONE: Record<JobStatus, string> = {
  'Booked in': 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  'Wash Bay': 'bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100',
  'Blast Room': 'bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-50',
  Handling: 'bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100',
  Prep: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-800 dark:text-yellow-50',
  Prime: 'bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100',
  Paint: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
  QA: 'bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100',
  'Ready for pickup': 'bg-green-600 text-white dark:bg-green-700',
  Collected: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const STATUS_ICON: Record<JobStatus, string> = {
  'Booked in': '📥', 'Wash Bay': '💧', 'Blast Room': '💨', Handling: '🏗️', Prep: '🧰',
  Prime: '🖌️', Paint: '🎨', QA: '🔍', 'Ready for pickup': '✅', Collected: '🚚',
};

export function JobStatusChip({ status, big }: { status: JobStatus; big?: boolean }) {
  return (
    <span className={`chip ${big ? 'px-3 py-1 text-sm' : ''} ${STATUS_TONE[status]}`}>
      <span aria-hidden className="mr-1">{STATUS_ICON[status]}</span>{status}
    </span>
  );
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Camera / gallery button plus thumbnails of the picked photos. Photos are shrunk on pick. */
type Update<T> = (fn: (prev: T) => T) => void;

export function PhotoPicker({ photos, onChange, label = 'Take photo' }: {
  photos: Blob[]; onChange: Update<Blob[]>; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const urls = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  async function picked(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const small = await Promise.all([...files].map((f) => shrinkPhoto(f)));
    onChange((prev) => [...prev, ...small]);
    setBusy(false);
    if (input.current) input.current.value = '';
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <div key={u} className="relative">
            <img src={u} alt="" className="h-20 w-20 rounded-xl object-cover" />
            <button type="button" aria-label="Remove photo"
              className="absolute -right-2 -top-2 h-8 w-8 rounded-full bg-slate-900 text-white shadow"
              onClick={() => onChange((prev) => prev.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="btn-ghost h-20 min-w-20 flex-col gap-0 px-3 text-sm" disabled={busy}
          onClick={() => input.current?.click()}>
          <span className="text-2xl" aria-hidden>📷</span>{busy ? 'Adding…' : label}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => picked(e.target.files)} />
    </div>
  );
}

/** Type-to-search customer list; 300+ customers is too many for a plain dropdown on a phone. */
export function CustomerPicker({ customers, value, onChange }: {
  customers: Customer[]; value: number | null; onChange: (id: number | null) => void;
}) {
  const [q, setQ] = useState('');
  const chosen = customers.find((c) => c.id === value);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const starts = customers.filter((c) => c.name.toLowerCase().startsWith(t));
    const has = customers.filter((c) => !c.name.toLowerCase().startsWith(t) && c.name.toLowerCase().includes(t));
    return [...starts, ...has].slice(0, 8);
  }, [customers, q]);

  if (chosen) {
    return (
      <div className="flex items-center gap-2">
        <div className="input flex items-center font-semibold">{chosen.name}</div>
        <button type="button" className="btn-ghost shrink-0" onClick={() => { onChange(null); setQ(''); }}>Change</button>
      </div>
    );
  }
  return (
    <div>
      <input className="input" placeholder="Start typing the customer name" value={q} autoComplete="off"
        onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <ul className="card mt-2 divide-y divide-slate-200 dark:divide-slate-800">
          {matches.map((c) => (
            <li key={c.id}>
              <button type="button" className="min-h-12 w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                onClick={() => onChange(c.id!)}>{c.name}</button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && matches.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">No customer matches. Office can add new customers in Settings.</p>
      )}
    </div>
  );
}

/** Tick the stages a job needs. Unticked stages are skipped. */
export function StagePicker({ stages, value, onChange }: {
  stages: { id: number; name: string }[]; value: number[]; onChange: (ids: number[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {stages.map((s) => {
        const on = value.includes(s.id);
        return (
          <button key={s.id} type="button" aria-pressed={on}
            className={`${on ? 'btn-primary' : 'btn-ghost'} min-h-12 px-4`}
            onClick={() => onChange(on ? value.filter((x) => x !== s.id) : [...value, s.id])}>
            {on ? '✓ ' : ''}{s.name}
          </button>
        );
      })}
    </div>
  );
}
