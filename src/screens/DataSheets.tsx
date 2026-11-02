import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Material } from '../lib/types';
import { StatusChip, TopBar, money } from '../ui';

export default function DataSheets({ isOffice, onBack }: { isOffice: boolean; onBack: () => void }) {
  const [rows, setRows] = useState<Material[]>([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | 'primer' | 'topcoat'>('all');

  useEffect(() => { api.list('materials').then(setRows); }, []);

  const shown = useMemo(() => rows.filter((m) => m.active
    && (type === 'all' || m.type === type)
    && m.name.toLowerCase().includes(q.toLowerCase())), [rows, q, type]);

  return (
    <>
      <TopBar title="Data sheets" onBack={onBack} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <input className="input" placeholder="Search primers and topcoats" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2">
          {(['all', 'primer', 'topcoat'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={type === t ? 'btn-primary min-h-10 px-4 text-sm' : 'btn-ghost min-h-10 px-4 text-sm'}>
              {t === 'all' ? 'All' : t === 'primer' ? 'Primers' : 'Topcoats'}
            </button>
          ))}
        </div>
        <ul className="space-y-3">
          {shown.map((m) => (
            <li key={m.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{m.name}</span>
                <span className="chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">{m.type === 'primer' ? 'Primer' : 'Topcoat'}</span>
                <StatusChip status={m.sds_status} />
              </div>
              {m.manufacturer && <div className="text-sm text-slate-500 dark:text-slate-400">{m.manufacturer}</div>}
              {isOffice && m.cost_per_l !== undefined && (
                <div className="mt-1 text-sm">Cost {money(m.cost_per_l)}/L · Charge {money(m.charge_per_l)}/L</div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {m.sds_url
                  ? <a className="btn-primary min-h-10 px-4 text-sm" href={m.sds_url} target="_blank" rel="noreferrer">Open SDS</a>
                  : <span className="text-sm text-slate-500">No SDS yet</span>}
                {m.pds_url && <a className="btn-ghost min-h-10 px-4 text-sm" href={m.pds_url} target="_blank" rel="noreferrer">Product data sheet</a>}
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="text-slate-500">No matching products.</li>}
        </ul>
      </main>
    </>
  );
}
