import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { CostLine } from '../lib/types';
import { ErrorText, TopBar, money } from '../ui';

type GroupBy = 'Job' | 'Customer' | 'Stage' | 'Product' | 'Worker';
const GROUPS: GroupBy[] = ['Job', 'Customer', 'Stage', 'Product', 'Worker'];

const iso = (d: Date) => d.toLocaleDateString('en-CA');
function preset(p: 'week' | 'month' | 'last' | 'year'): [string, string] {
  const now = new Date();
  if (p === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return [iso(start), iso(now)];
  }
  if (p === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
  if (p === 'last') return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
  // Australian financial year
  const fyStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return [iso(new Date(fyStart, 6, 1)), iso(now)];
}

function keyFor(l: CostLine, g: GroupBy): string | null {
  switch (g) {
    case 'Job': return `${l.job_number} · ${l.customer}`;
    case 'Customer': return l.customer;
    case 'Stage': return l.kind === 'Labour' ? l.name.replace(/ \(.*\)$/, '') : l.kind === 'Extra' ? 'Extras' : 'Paint (materials)';
    case 'Product': return l.kind === 'Primer' || l.kind === 'Topcoat' ? l.name : null;
    case 'Worker': return l.worker;
  }
}

interface Row { key: string; hours: number; litres: number; cost: number; charge: number }

function summarise(lines: CostLine[], g: GroupBy): Row[] {
  const m = new Map<string, Row>();
  for (const l of lines) {
    const k = keyFor(l, g);
    if (!k) continue;
    const r = m.get(k) ?? { key: k, hours: 0, litres: 0, cost: 0, charge: 0 };
    if (l.unit === 'h') r.hours += l.quantity;
    if (l.unit === 'L') r.litres += l.quantity;
    r.cost += l.cost;
    r.charge += l.charge;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.charge - a.charge || a.key.localeCompare(b.key));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Comma-separated file that opens straight in Excel. */
function download(name: string, rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Reports({ onBack }: { onBack: () => void }) {
  const [[from, to], setRange] = useState<[string, string]>(() => preset('month'));
  const [group, setGroup] = useState<GroupBy>('Job');
  const [lines, setLines] = useState<CostLine[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setLines(null); setError('');
    api.costLines({ from, to }).then(setLines).catch((e) => setError((e as Error).message));
  }, [from, to]);

  const rows = useMemo(() => summarise(lines ?? [], group), [lines, group]);
  const total = rows.reduce((t, r) => ({ hours: t.hours + r.hours, litres: t.litres + r.litres, cost: t.cost + r.cost, charge: t.charge + r.charge }),
    { hours: 0, litres: 0, cost: 0, charge: 0 });
  const all = summarise(lines ?? [], 'Customer').reduce((t, r) => ({ cost: t.cost + r.cost, charge: t.charge + r.charge }), { cost: 0, charge: 0 });

  return (
    <>
      <TopBar title="Reports" onBack={onBack} />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {([['week', 'This week'], ['month', 'This month'], ['last', 'Last month'], ['year', 'This financial year']] as const).map(([p, label]) => (
            <button key={p} className={`${preset(p)[0] === from && preset(p)[1] === to ? 'btn-primary' : 'btn-ghost'} min-h-10 px-4 text-sm`}
              onClick={() => setRange(preset(p))}>{label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="rf">From</label>
            <input id="rf" className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setRange([e.target.value, to])} /></div>
          <div><label className="label" htmlFor="rt">To</label>
            <input id="rt" className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setRange([from, e.target.value])} /></div>
        </div>

        <div className="card grid grid-cols-2 gap-3 p-4 text-center sm:grid-cols-5">
          <Stat label="Hours" value={`${r2(summarise(lines ?? [], 'Customer').reduce((t, r) => t + r.hours, 0))} h`} />
          <Stat label="Litres" value={`${r2(summarise(lines ?? [], 'Customer').reduce((t, r) => t + r.litres, 0))} L`} />
          <Stat label="Cost" value={money(all.cost)} />
          <Stat label="Charge" value={money(all.charge)} />
          <Stat label="Margin" value={money(all.charge - all.cost)} tone={all.charge - all.cost < 0 ? 'text-red-600' : 'text-green-700 dark:text-green-400'} />
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          <span className="self-center text-sm font-semibold text-slate-500">By</span>
          {GROUPS.map((g) => (
            <button key={g} className={`${group === g ? 'btn-primary' : 'btn-ghost'} min-h-10 shrink-0 px-4 text-sm`} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>

        <ErrorText>{error}</ErrorText>
        {!lines && !error && <p className="text-slate-500">Loading…</p>}
        {lines && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-slate-50 text-left dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2">{group}</th><th className="px-3 py-2 text-right">Hours</th><th className="px-3 py-2 text-right">Litres</th>
                  <th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Charge</th><th className="px-3 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="px-3 py-2 font-medium">{r.key}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.hours ? r2(r.hours) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.litres ? r2(r.litres) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.charge)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.charge - r.cost < 0 ? 'text-red-600' : ''}`}>{money(r.charge - r.cost)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Nothing logged in these dates.</td></tr>}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="border-t-2 border-slate-300 font-bold dark:border-slate-700">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r2(total.hours) || ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r2(total.litres) || ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(total.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(total.charge)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(total.charge - total.cost)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {lines && lines.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn-ghost" onClick={() => download(`RAB Flow by ${group.toLowerCase()} ${from} to ${to}.csv`, [
              [group, 'Hours', 'Litres', 'Cost', 'Charge', 'Margin'],
              ...rows.map((r) => [r.key, r2(r.hours), r2(r.litres), r2(r.cost), r2(r.charge), r2(r.charge - r.cost)]),
            ])}>⬇ Download this table for Excel</button>
            <button className="btn-ghost" onClick={() => download(`RAB Flow all lines ${from} to ${to}.csv`, [
              ['Date', 'Job', 'Customer', 'Type', 'Item', 'Worker', 'Quantity', 'Unit', 'Cost', 'Charge'],
              ...lines.map((l) => [l.on_date, l.job_number, l.customer, l.kind, l.name, l.worker, l.quantity, l.unit, l.cost, l.charge]),
            ])}>⬇ Download every line for Excel</button>
          </div>
        )}
        <p className="text-xs text-slate-500">Dates are when the work was done. Dollar amounts use today's rates and prices in Settings.</p>
      </main>
    </>
  );
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div><div className="text-sm text-slate-500">{label}</div><div className={`text-lg font-bold ${tone}`}>{value}</div></div>;
}
