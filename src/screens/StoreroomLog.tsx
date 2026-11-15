import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ConsumableTake, StorePerson, StoreTool, ToolMove } from '../lib/types';
import { ErrorText, TopBar } from '../ui';
import { download, preset } from './Reports';
import { when } from './Storeroom';

// Office view of the storeroom: tools out now, consumables taken, tool history
// and each person's storeroom code.

const TABS = ['Tools out now', 'Consumables taken', 'Tool history', 'Codes'] as const;
type Tab = (typeof TABS)[number];

const r2 = (n: number) => Math.round(n * 100) / 100;
const daysOut = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export default function StoreroomLog({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('Tools out now');
  const [[from, to], setRange] = useState<[string, string]>(() => preset('month'));
  const [error, setError] = useState('');

  const dates = (
    <>
      <div className="flex flex-wrap gap-2">
        {([['week', 'This week'], ['month', 'This month'], ['last', 'Last month'], ['year', 'This financial year']] as const).map(([p, label]) => (
          <button key={p} className={`${preset(p)[0] === from && preset(p)[1] === to ? 'btn-primary' : 'btn-ghost'} min-h-10 px-4 text-sm`}
            onClick={() => setRange(preset(p))}>{label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="sf">From</label>
          <input id="sf" className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setRange([e.target.value, to])} /></div>
        <div><label className="label" htmlFor="st">To</label>
          <input id="st" className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setRange([from, e.target.value])} /></div>
      </div>
    </>
  );

  return (
    <>
      <TopBar title="Storeroom log" onBack={onBack} />
      <nav className="sticky top-16 z-10 flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
        {TABS.map((t) => (
          <button key={t} onClick={() => { setError(''); setTab(t); }}
            className={`${tab === t ? 'btn-primary' : 'btn-ghost'} min-h-10 shrink-0 px-4 text-sm`}>{t}</button>
        ))}
      </nav>
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <ErrorText>{error}</ErrorText>
        {tab === 'Tools out now' && <ToolsOut onError={setError} />}
        {tab === 'Consumables taken' && <>{dates}<Takes from={from} to={to} onError={setError} /></>}
        {tab === 'Tool history' && <>{dates}<History from={from} to={to} onError={setError} /></>}
        {tab === 'Codes' && <Codes onError={setError} />}
      </main>
    </>
  );
}

function ToolsOut({ onError }: { onError: (m: string) => void }) {
  const [tools, setTools] = useState<StoreTool[] | null>(null);
  useEffect(() => { api.store.tools().then(setTools).catch((e) => onError((e as Error).message)); }, [onError]);
  const out = (tools ?? []).filter((t) => t.out_at).sort((a, b) => a.out_at!.localeCompare(b.out_at!));
  if (!tools) return <p className="text-slate-500">Loading…</p>;
  return (
    <>
      <p className="text-sm text-slate-500">{out.length} of {tools.length} tools are signed out. Oldest first.</p>
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {out.map((t) => {
          const d = daysOut(t.out_at!);
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t.name}{t.tag ? ` (${t.tag})` : ''}</div>
                <div className="text-sm text-slate-500">{t.out_staff_name} · since {when(t.out_at!)}{t.out_job_number ? ` · Job ${t.out_job_number}` : ''}</div>
              </div>
              {d >= 1 && <span className={`chip ${d >= 3 ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>{d} {d === 1 ? 'day' : 'days'}</span>}
            </li>
          );
        })}
        {out.length === 0 && <li className="px-4 py-6 text-slate-500">Every tool is in the storeroom.</li>}
      </ul>
    </>
  );
}

type By = 'Item' | 'Person' | 'Job' | 'Every entry';

function Takes({ from, to, onError }: { from: string; to: string; onError: (m: string) => void }) {
  const [rows, setRows] = useState<ConsumableTake[] | null>(null);
  const [by, setBy] = useState<By>('Item');
  useEffect(() => {
    setRows(null);
    api.store.takes({ from, to }).then(setRows).catch((e) => onError((e as Error).message));
  }, [from, to, onError]);

  const summary = useMemo(() => {
    const m = new Map<string, { key: string; detail: Map<string, number>; count: number }>();
    for (const r of rows ?? []) {
      const key = by === 'Item' ? r.consumable : by === 'Person' ? r.staff_name : r.job_number ?? 'No job';
      const e = m.get(key) ?? { key, detail: new Map(), count: 0 };
      const unitKey = by === 'Item' ? r.unit : `${r.consumable} (${r.unit})`;
      e.detail.set(unitKey, r2((e.detail.get(unitKey) ?? 0) + r.quantity));
      e.count++;
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }, [rows, by]);

  if (!rows) return <p className="text-slate-500">Loading…</p>;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">Group by</span>
        {(['Item', 'Person', 'Job', 'Every entry'] as By[]).map((b) => (
          <button key={b} className={`${by === b ? 'btn-primary' : 'btn-ghost'} min-h-10 px-4 text-sm`} onClick={() => setBy(b)}>{b}</button>
        ))}
      </div>
      {by === 'Every entry' ? (
        <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex justify-between gap-3"><b>{r.consumable}</b><span>{r.quantity} {r.unit}</span></div>
              <div className="text-sm text-slate-500">{r.staff_name} · {when(r.taken_at)}{r.job_number ? ` · Job ${r.job_number}` : ''}{r.note ? ` · ${r.note}` : ''}</div>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-slate-500">Nothing taken in these dates.</li>}
        </ul>
      ) : (
        <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
          {summary.map((s) => (
            <li key={s.key} className="px-4 py-3">
              <div className="font-semibold">{s.key}</div>
              <div className="text-sm text-slate-500">{[...s.detail].map(([k, q]) => (by === 'Item' ? `${q} ${k}` : `${q} × ${k}`)).join(' · ')}</div>
            </li>
          ))}
          {summary.length === 0 && <li className="px-4 py-6 text-slate-500">Nothing taken in these dates.</li>}
        </ul>
      )}
      <button className="btn-ghost" disabled={!rows.length} onClick={() => download(`Storeroom consumables ${from} to ${to}.csv`, [
        ['Date and time', 'Item', 'Item code', 'Category', 'Quantity', 'Unit', 'Taken by', 'Job Number', 'Note'],
        ...rows.map((r) => [when(r.taken_at), r.consumable, r.code, r.category, r.quantity, r.unit, r.staff_name, r.job_number, r.note]),
      ])}>Download for Excel</button>
    </>
  );
}

function History({ from, to, onError }: { from: string; to: string; onError: (m: string) => void }) {
  const [rows, setRows] = useState<ToolMove[] | null>(null);
  useEffect(() => {
    setRows(null);
    api.store.toolMoves({ from, to }).then(setRows).catch((e) => onError((e as Error).message));
  }, [from, to, onError]);
  if (!rows) return <p className="text-slate-500">Loading…</p>;
  return (
    <>
      <p className="text-sm text-slate-500">Tools signed out in these dates, plus anything still out.</p>
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex justify-between gap-3">
              <b>{r.tool}{r.tag ? ` (${r.tag})` : ''}</b>
              {!r.returned_at && <span className="chip bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">Still out</span>}
            </div>
            <div className="text-sm text-slate-500">
              Out: {r.staff_name}, {when(r.out_at)}{r.job_number ? ` · Job ${r.job_number}` : ''}
              {r.returned_at && <> · Back: {r.returned_by_name}, {when(r.returned_at)}</>}
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-slate-500">No tools signed out in these dates.</li>}
      </ul>
      <button className="btn-ghost" disabled={!rows.length} onClick={() => download(`Storeroom tools ${from} to ${to}.csv`, [
        ['Tool', 'Tool ID', 'Signed out by', 'Out', 'Job Number', 'Returned by', 'Returned'],
        ...rows.map((r) => [r.tool, r.tag, r.staff_name, when(r.out_at), r.job_number, r.returned_by_name, r.returned_at ? when(r.returned_at) : 'Still out']),
      ])}>Download for Excel</button>
    </>
  );
}

function Codes({ onError }: { onError: (m: string) => void }) {
  const [people, setPeople] = useState<StorePerson[] | null>(null);
  const [done, setDone] = useState('');
  const reload = () => api.store.people().then(setPeople).catch((e) => onError((e as Error).message));
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function reset(p: StorePerson) {
    try {
      await api.store.resetCode(p.id);
      setDone(`${p.name}'s code is cleared. They choose a new one next time they open the storeroom.`);
      await reload();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  if (!people) return <p className="text-slate-500">Loading…</p>;
  return (
    <>
      <p className="text-sm text-slate-500">Each person chooses their own 4-digit code the first time they use the storeroom. Nobody can see the codes. If someone forgets theirs, reset it here.</p>
      {done && <p className="rounded-xl border-2 border-ink bg-brand px-4 py-3 font-semibold text-ink">{done}</p>}
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {people.map((p) => (
          <li key={p.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <div className="flex-1 font-semibold">{p.name}</div>
            {p.has_code
              ? <button className="btn-ghost min-h-10 px-4 text-sm" onClick={() => reset(p)}>Reset code</button>
              : <span className="text-sm text-slate-500">No code yet</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
