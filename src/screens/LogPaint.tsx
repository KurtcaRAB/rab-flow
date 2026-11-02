import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { saveOrQueue } from '../lib/outbox';
import type { Material, PaintEntry, Staff } from '../lib/types';
import { ErrorText, Sheet } from '../ui';
import { today } from './LogHours';

const QUICK = [0.5, 1, 2, 4, 10, 20];
const KIND_LABEL = { primer: 'Primer', topcoat: 'Topcoat' } as const;

/** Pick a primer or topcoat, enter litres. The data sheet is one tap away. */
export function LogPaint({ jobId, jobNumber, me, onClose, onSaved }: {
  jobId: number; jobNumber: string; me: Staff; onClose: () => void; onSaved: (r: 'sent' | 'queued') => void;
}) {
  const isOffice = me.groups.includes('office');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [kind, setKind] = useState<'primer' | 'topcoat'>('primer');
  const [materialId, setMaterialId] = useState<number | null>(null);
  const [litres, setLitres] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [staffId, setStaffId] = useState(me.id);
  const [people, setPeople] = useState<Staff[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.list('materials').then((m) => setMaterials(m.filter((x) => x.active)));
    if (isOffice) api.staff().then((s) => setPeople(s.filter((x) => x.active)));
  }, [isOffice]);

  const options = useMemo(() => materials.filter((m) => m.type === kind).sort((a, b) => a.name.localeCompare(b.name)), [materials, kind]);
  const chosen = materials.find((m) => m.id === materialId);

  async function save() {
    const l = Number(litres);
    if (!materialId) return setError(`Pick the ${KIND_LABEL[kind].toLowerCase()}.`);
    if (!(l > 0 && l <= 1000)) return setError('Enter the litres used.');
    setBusy(true); setError('');
    try {
      const lit = Math.round(l * 100) / 100;
      onSaved(await saveOrQueue({
        kind: 'paint',
        label: `${jobNumber} ${lit} L ${chosen?.name ?? ''}`,
        data: { job_id: jobId, material_id: materialId, staff_id: staffId, used_on: date, litres: lit, note: note.trim() || null },
      }));
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <Sheet title="Log paint" onClose={onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2">
          {(['primer', 'topcoat'] as const).map((k) => (
            <button key={k} type="button" className={`${kind === k ? 'btn-primary' : 'btn-ghost'} min-h-14`}
              onClick={() => { setKind(k); setMaterialId(null); }}>{KIND_LABEL[k]}</button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="pm">{KIND_LABEL[kind]}</label>
          <select id="pm" className="input" value={materialId ?? ''} onChange={(e) => setMaterialId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Pick a {KIND_LABEL[kind].toLowerCase()}…</option>
            {options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {chosen && (
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {chosen.sds_url
                ? <a className="btn-ghost min-h-10 px-4 text-sm" href={chosen.sds_url} target="_blank" rel="noreferrer">Open SDS</a>
                : <span className="text-slate-500">No SDS on file yet</span>}
              {chosen.pds_url && <a className="btn-ghost min-h-10 px-4 text-sm" href={chosen.pds_url} target="_blank" rel="noreferrer">Product data sheet</a>}
            </div>
          )}
        </div>

        <div>
          <label className="label" htmlFor="pl">Litres (L)</label>
          <div className="mb-2 grid grid-cols-6 gap-1.5">
            {QUICK.map((q) => (
              <button key={q} type="button" className={`${Number(litres) === q ? 'btn-primary' : 'btn-ghost'} px-0`}
                onClick={() => setLitres(String(q))}>{q}</button>
            ))}
          </div>
          <input id="pl" className="input text-lg" type="number" inputMode="decimal" step="0.1" min="0.1"
            placeholder="Or type, e.g. 7.5" value={litres} onChange={(e) => setLitres(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="pd">Date</label>
            <input id="pd" className="input" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value || today())} />
          </div>
          {isOffice && people.length > 0 && (
            <div>
              <label className="label" htmlFor="pw">Painter</label>
              <select id="pw" className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="label" htmlFor="pn">Note (colour, coat…)</label>
          <input id="pn" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full text-lg" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save litres'}</button>
      </div>
    </Sheet>
  );
}

export const fmtLitres = (l: number) => `${Math.round(l * 100) / 100} L`;

/** Litres on a job: total per product, then each entry. */
export function PaintList({ entries, materials, me, onDelete }: {
  entries: PaintEntry[]; materials: Material[]; me: Staff; onDelete: (id: number) => void;
}) {
  const isOffice = me.groups.includes('office');
  const name = (id: number) => materials.find((m) => m.id === id)?.name ?? 'Unknown product';
  const totals = [...entries.reduce((t, e) => t.set(e.material_id, (t.get(e.material_id) ?? 0) + e.litres), new Map<number, number>())];
  if (entries.length === 0) return <p className="text-slate-500">No primer or topcoat logged yet.</p>;
  return (
    <div className="space-y-3">
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {totals.map(([id, l]) => {
          const m = materials.find((x) => x.id === id);
          return (
            <li key={id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{name(id)}</div>
                <div className="text-sm text-slate-500">{m ? KIND_LABEL[m.type] : ''}</div>
              </div>
              {m?.sds_url && <a className="link text-sm" href={m.sds_url} target="_blank" rel="noreferrer">SDS</a>}
              <span className="text-xl font-bold">{fmtLitres(l)}</span>
            </li>
          );
        })}
      </ul>
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{fmtLitres(e.litres)} · {name(e.material_id)}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {e.staff_name} · {new Date(e.used_on + 'T00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
                {e.note ? ` · ${e.note}` : ''}
              </div>
            </div>
            {(isOffice || e.staff_id === me.id) && (
              <button className="h-10 w-10 shrink-0 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Remove entry"
                onClick={() => onDelete(e.id)}>🗑</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
