import { useEffect, useMemo, useState } from 'react';
import type { Go } from '../App';
import { JobStatusChip, shortDate } from '../jobUi';
import { api } from '../lib/api';
import { GROUP_LABELS, JOB_STATUSES, type JobCard, type Staff } from '../lib/types';
import { TopBar } from '../ui';

const FILTER_KEY = 'rabflow-board-filters';

interface Filters { q: string; status: string; location: string; customer: string; collected: boolean }
const NO_FILTERS: Filters = { q: '', status: '', location: '', customer: '', collected: false };

function loadFilters(): Filters {
  try { return { ...NO_FILTERS, ...JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}') }; } catch { return NO_FILTERS; }
}

/** Home is the yard board: every job in the yard, newest first, with search and filters. */
export default function Home({ me, go, onSignOut }: { me: Staff; go: Go; onSignOut: () => void }) {
  const isOffice = me.groups.includes('office');
  const [jobs, setJobs] = useState<JobCard[] | null>(null);
  const [error, setError] = useState('');
  const [f, setF] = useState<Filters>(loadFilters);
  const set = (patch: Partial<Filters>) => setF((x) => {
    const next = { ...x, ...patch };
    try { sessionStorage.setItem(FILTER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  useEffect(() => {
    setJobs(null);
    api.jobs({ includeCollected: f.collected }).then(setJobs).catch((e) => setError((e as Error).message));
  }, [f.collected]);

  const locations = useMemo(() => [...new Set((jobs ?? []).map((j) => j.location_name).filter(Boolean))].sort() as string[], [jobs]);
  const customers = useMemo(() => [...new Set((jobs ?? []).map((j) => j.customer_name))].sort(), [jobs]);

  const shown = useMemo(() => {
    const t = f.q.trim().toLowerCase();
    return (jobs ?? []).filter((j) =>
      (!f.status || j.status === f.status)
      && (!f.location || j.location_name === f.location)
      && (!f.customer || j.customer_name === f.customer)
      && (!t || [j.job_number, j.quote_number, j.po_number, j.customer_name,
        ...j.items.flatMap((i) => [i.serial_number, i.description])]
        .some((v) => v?.toLowerCase().includes(t))));
  }, [jobs, f]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    (jobs ?? []).forEach((j) => c.set(j.status, (c.get(j.status) ?? 0) + 1));
    return c;
  }, [jobs]);
  const filtered = f.status || f.location || f.customer || f.q;

  return (
    <>
      <TopBar title="Yard board" logo right={
        <details className="relative">
          <summary className="btn-ghost min-h-10 cursor-pointer list-none px-4 text-sm">{me.name.split(' ')[0]} ▾</summary>
          <div className="card absolute right-0 z-20 mt-2 w-60 space-y-1 p-2 shadow-lg">
            <p className="px-3 py-2 text-sm text-slate-500">{me.groups.map((g) => GROUP_LABELS[g]).join(' · ')}</p>
            <button className="w-full rounded-lg px-3 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => go({ to: 'datasheets' })}>Data sheets</button>
            {isOffice && <button className="w-full rounded-lg px-3 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => go({ to: 'reports' })}>Reports</button>}
            {isOffice && <button className="w-full rounded-lg px-3 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => go({ to: 'settings' })}>Settings</button>}
            <button className="w-full rounded-lg px-3 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onSignOut}>Sign out</button>
          </div>
        </details>
      } />
      <main className="mx-auto max-w-5xl space-y-4 p-4 pb-28">
        <input className="input" type="search" placeholder="Search job, serial, quote, PO or customer"
          value={f.q} onChange={(e) => set({ q: e.target.value })} />

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button className={`${!f.status ? 'btn-primary' : 'btn-ghost'} min-h-10 shrink-0 px-4 text-sm`} onClick={() => set({ status: '' })}>
            All {jobs ? `(${jobs.length})` : ''}
          </button>
          {JOB_STATUSES.filter((s) => counts.has(s) || f.status === s).map((s) => (
            <button key={s} className={`${f.status === s ? 'btn-primary' : 'btn-ghost'} min-h-10 shrink-0 px-4 text-sm`}
              onClick={() => set({ status: f.status === s ? '' : s })}>{s} ({counts.get(s) ?? 0})</button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select className="input" aria-label="Location" value={f.location} onChange={(e) => set({ location: e.target.value })}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l}>{l}</option>)}
          </select>
          <select className="input" aria-label="Customer" value={f.customer} onChange={(e) => set({ customer: e.target.value })}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="h-5 w-5" checked={f.collected} onChange={(e) => set({ collected: e.target.checked })} />
            Include collected jobs
          </label>
          {filtered && <button className="link" onClick={() => set({ ...NO_FILTERS, collected: f.collected })}>Clear filters</button>}
        </div>

        {error && <p className="text-red-600">{error}</p>}
        {!jobs && !error && <p className="text-slate-500">Loading jobs…</p>}
        {jobs && shown.length === 0 && (
          <div className="card p-8 text-center text-slate-500">
            {jobs.length === 0 ? 'No jobs in the yard yet. Tap New job to book the first one in.' : 'No jobs match.'}
          </div>
        )}

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((j) => (
            <li key={j.id} className="min-w-0">
              <button onClick={() => go({ to: 'job', id: j.id })} className="card flex w-full gap-3 overflow-hidden p-3 text-left hover:border-ink dark:hover:border-brand">
                {j.cover_url
                  ? <img src={j.cover_url} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-xl object-cover" />
                  : <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-3xl dark:bg-slate-800" aria-hidden>📦</div>}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg font-bold">{j.job_number}</span>
                    <span className="text-xs text-slate-500">{shortDate(j.date_in)}</span>
                  </div>
                  <div className="truncate font-semibold">{j.customer_name}</div>
                  <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                    {j.items.length === 1 ? j.items[0].description : `${j.items.length} items`}
                    {j.location_name ? ` · ${j.location_name}` : ''}
                  </div>
                  <JobStatusChip status={j.status} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto max-w-5xl">
          <button className="btn-primary w-full text-lg" onClick={() => go({ to: 'new' })}>+ New job</button>
        </div>
      </div>
    </>
  );
}
