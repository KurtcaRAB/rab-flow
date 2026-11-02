import { useEffect, useState } from 'react';
import { PhotoPicker } from '../jobUi';
import { api } from '../lib/api';
import type { CostLine, Extra, JobExtra, Stage } from '../lib/types';
import { ErrorText, Sheet, money } from '../ui';
import { today } from './LogHours';

/** QA pass or fail with photos and a note. A fail sends the job back to a chosen stage. */
export function QaCheckSheet({ jobId, stages, needed, onClose, onSaved }: {
  jobId: number; stages: Stage[]; needed: number[]; onClose: () => void; onSaved: (photoErrors: number) => void;
}) {
  const [passed, setPassed] = useState<boolean | null>(null);
  const [backTo, setBackTo] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rework = stages.filter((s) => s.name !== 'QA' && (needed.length === 0 || needed.includes(s.id)));

  async function save() {
    if (passed === null) return setError('Pick Pass or Fail.');
    if (!passed && !backTo) return setError('Pick the stage that needs rework.');
    if (!passed && !note.trim()) return setError('Say what needs fixing.');
    setBusy(true); setError('');
    try {
      // Photos first, so they are on the job even if the move is refused.
      const failed = photos.length ? await api.addPhotos(jobId, photos, { stage: 'QA' }) : 0;
      await api.recordQa({ job_id: jobId, passed, send_back_stage_id: passed ? null : backTo, note: note.trim() || null });
      onSaved(failed);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <Sheet title="QA check" onClose={onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setPassed(true)}
            className={`btn min-h-16 text-lg ${passed === true ? 'bg-green-600 text-white' : 'border-2 border-green-600 text-green-700 dark:text-green-400'}`}>✓ Pass</button>
          <button type="button" onClick={() => setPassed(false)}
            className={`btn min-h-16 text-lg ${passed === false ? 'bg-red-600 text-white' : 'border-2 border-red-600 text-red-700 dark:text-red-400'}`}>✗ Fail</button>
        </div>
        {passed === false && (
          <div>
            <span className="label">Send back to</span>
            <div className="grid grid-cols-2 gap-2">
              {rework.map((s) => (
                <button key={s.id} type="button" className={`${backTo === s.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setBackTo(s.id)}>{s.name}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="label" htmlFor="qn">{passed === false ? 'What needs fixing' : 'Note'}</label>
          <textarea id="qn" className="input min-h-20 py-3" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div>
          <span className="label">QA photos</span>
          <PhotoPicker photos={photos} onChange={setPhotos} />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full text-lg" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save QA result'}</button>
      </div>
    </Sheet>
  );
}

/** Office marks the job collected with a date and a photo. */
export function JobOutSheet({ jobId, onClose, onSaved }: {
  jobId: number; onClose: () => void; onSaved: (photoErrors: number) => void;
}) {
  const [date, setDate] = useState(today);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError('');
    try {
      const failed = photos.length ? await api.addPhotos(jobId, photos, { stage: 'Out' }) : 0;
      const when = date === today() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString();
      await api.updateJob(jobId, { status: 'Collected', date_out: when });
      onSaved(failed);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <Sheet title="Job out" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="od">Collected on</label>
          <input id="od" className="input" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value || today())} />
        </div>
        <div>
          <span className="label">Photo on the way out</span>
          <PhotoPicker photos={photos} onChange={setPhotos} />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full text-lg" disabled={busy} onClick={save}>{busy ? 'Saving…' : '🚚 Mark collected'}</button>
      </div>
    </Sheet>
  );
}

export const sum = (lines: CostLine[], k: 'cost' | 'charge' | 'quantity') => lines.reduce((t, l) => t + l[k], 0);

/** Office only: labour, paint and extras on this job in dollars, plus adding extras. */
export function CostsTab({ jobId }: { jobId: number }) {
  const [lines, setLines] = useState<CostLine[] | null>(null);
  const [jobExtras, setJobExtras] = useState<JobExtra[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [extraId, setExtraId] = useState<number | ''>('');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState('');

  const reload = () => Promise.all([
    api.costLines({ jobId }).then(setLines),
    api.jobExtras(jobId).then(setJobExtras),
  ]).catch((e) => setError((e as Error).message));
  useEffect(() => { reload(); api.list('extras').then(setExtras); }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    const q = Number(qty);
    if (!extraId || !(q > 0)) return setError('Pick the extra and quantity.');
    setError('');
    try { await api.addExtra({ job_id: jobId, extra_id: extraId, quantity: q, note: null }); setExtraId(''); setQty('1'); await reload(); }
    catch (e) { setError((e as Error).message); }
  }

  if (!lines) return <p className="text-slate-500">{error || 'Loading…'}</p>;
  const groups = (['Labour', 'Primer', 'Topcoat', 'Extra'] as const).map((k) => ({ k, rows: lines.filter((l) => l.kind === k) })).filter((g) => g.rows.length);
  const cost = sum(lines, 'cost');
  const charge = sum(lines, 'charge');

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-3 gap-2 p-4 text-center">
        <div><div className="text-sm text-slate-500">Cost</div><div className="text-lg font-bold">{money(cost)}</div></div>
        <div><div className="text-sm text-slate-500">Charge</div><div className="text-lg font-bold">{money(charge)}</div></div>
        <div><div className="text-sm text-slate-500">Margin</div>
          <div className={`text-lg font-bold ${charge - cost < 0 ? 'text-red-600' : 'text-green-700 dark:text-green-400'}`}>{money(charge - cost)}</div></div>
      </div>
      {groups.map(({ k, rows }) => (
        <div key={k} className="card overflow-hidden">
          <div className="flex justify-between bg-slate-50 px-4 py-2 text-sm font-bold dark:bg-slate-800">
            <span>{k === 'Extra' ? 'Extras' : k}</span><span>{money(sum(rows, 'cost'))} / {money(sum(rows, 'charge'))}</span>
          </div>
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {k !== 'Extra' && rows.map((l, i) => (
              <li key={i} className="flex items-center gap-2 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{l.quantity} {l.unit} {l.name}</div>
                  <div className="text-slate-500">{[l.worker, new Date(l.on_date + 'T00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="text-right"><div>{money(l.charge)}</div><div className="text-slate-500">cost {money(l.cost)}</div></div>
              </li>
            ))}
            {k === 'Extra' && jobExtras.map((x) => {
              const e = extras.find((y) => y.id === x.extra_id);
              return (
                <li key={x.id} className="flex items-center gap-2 px-4 py-2">
                  <div className="min-w-0 flex-1 font-medium">{x.quantity} × {e?.name ?? 'Extra'}</div>
                  <div className="text-right"><div>{money(x.quantity * (e?.unit_charge ?? 0))}</div>
                    <div className="text-slate-500">cost {money(x.quantity * (e?.unit_cost ?? 0))}</div></div>
                  {(
                    <button className="h-9 w-9 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Remove extra"
                      onClick={async () => { await api.deleteExtra(x.id); await reload(); }}>🗑</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {lines.length === 0 && <p className="text-slate-500">No hours, paint or extras on this job yet.</p>}
      <div className="card space-y-2 p-4">
        <span className="label">Add an extra</span>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <select className="input" aria-label="Extra" value={extraId} onChange={(e) => setExtraId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Pick…</option>
            {extras.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name} ({money(e.unit_charge)} each)</option>)}
          </select>
          <input className="input" aria-label="Quantity" type="number" inputMode="decimal" min="0.5" step="0.5" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <button className="btn-ghost w-full" onClick={add}>+ Add extra</button>
      </div>
      <ErrorText>{error}</ErrorText>
      <p className="text-xs text-slate-500">Worked out from today's rates and prices in Settings.</p>
    </div>
  );
}
