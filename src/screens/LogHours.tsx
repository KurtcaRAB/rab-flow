import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { saveOrQueue } from '../lib/outbox';
import type { LabourEntry, LabourRate, Stage, Staff } from '../lib/types';
import { ErrorText, Sheet } from '../ui';

const QUICK = [0.5, 1, 2, 4, 8];
export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

/** Stage buttons, quick-pick hours, date and note. Office can log for someone else and pick the rate. */
export function LogHours({ jobId, jobNumber, me, stages, needed, onClose, onSaved }: {
  jobId: number; jobNumber: string; me: Staff; stages: Stage[]; needed: number[]; onClose: () => void;
  onSaved: (result: 'sent' | 'queued') => void;
}) {
  const isOffice = me.groups.includes('office');
  const [stageId, setStageId] = useState<number | null>(null);
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [staffId, setStaffId] = useState(me.id);
  const [rateId, setRateId] = useState<number | ''>('');
  const [people, setPeople] = useState<Staff[]>([]);
  const [rates, setRates] = useState<LabourRate[]>([]);
  const [showAll, setShowAll] = useState(needed.length === 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOffice) return;
    api.staff().then((s) => setPeople(s.filter((x) => x.active)));
    api.list('labour_rates').then((r) => setRates(r.filter((x) => x.active)));
  }, [isOffice]);

  const shown = showAll ? stages : stages.filter((s) => needed.includes(s.id));
  const stageRates = rates.filter((r) => r.stage_id === stageId);

  async function save() {
    const h = Number(hours);
    if (!stageId) return setError('Pick the stage.');
    if (!(h > 0 && h <= 24)) return setError('Enter the hours (up to 24).');
    setBusy(true); setError('');
    try {
      const hrs = Math.round(h * 100) / 100;
      onSaved(await saveOrQueue({
        kind: 'hours',
        label: `${jobNumber} ${hrs} h ${stages.find((s) => s.id === stageId)?.name ?? ''}`,
        data: {
          job_id: jobId, stage_id: stageId, staff_id: staffId, work_date: date, hours: hrs,
          note: note.trim() || null, labour_rate_id: rateId === '' ? null : rateId,
        },
      }));
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <Sheet title="Log hours" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <span className="label">Stage</span>
          <div className="grid grid-cols-2 gap-2">
            {shown.map((s) => (
              <button key={s.id} type="button" className={`${stageId === s.id ? 'btn-primary' : 'btn-ghost'} min-h-14`}
                onClick={() => { setStageId(s.id); setRateId(''); }}>{s.name}</button>
            ))}
          </div>
          {!showAll && (
            <button type="button" className="link mt-2 text-sm" onClick={() => setShowAll(true)}>
              Show stages this job skips
            </button>
          )}
        </div>

        <div>
          <label className="label" htmlFor="hrs">Hours</label>
          <div className="mb-2 grid grid-cols-5 gap-2">
            {QUICK.map((q) => (
              <button key={q} type="button" className={`${Number(hours) === q ? 'btn-primary' : 'btn-ghost'} px-0`}
                onClick={() => setHours(String(q))}>{q}</button>
            ))}
          </div>
          <input id="hrs" className="input text-lg" type="number" inputMode="decimal" step="0.25" min="0.25" max="24"
            placeholder="Or type, e.g. 3.5" value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="hd">Date</label>
            <input id="hd" className="input" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value || today())} />
          </div>
          {isOffice && people.length > 0 && (
            <div>
              <label className="label" htmlFor="hw">Worker</label>
              <select id="hw" className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {isOffice && stageRates.length > 1 && (
          <div>
            <label className="label" htmlFor="hr">Rate (Office only)</label>
            <select id="hr" className="input" value={rateId} onChange={(e) => setRateId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Stage default</option>
              {stageRates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="label" htmlFor="hn">Note</label>
          <input id="hn" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full text-lg" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save hours'}</button>
      </div>
    </Sheet>
  );
}

export const fmtHours = (h: number) => `${Math.round(h * 100) / 100} h`;

/** Hours on a job: total per stage, then each entry. */
export function HoursList({ entries, stages, me, onDelete }: {
  entries: LabourEntry[]; stages: Stage[]; me: Staff; onDelete: (id: number) => void;
}) {
  const isOffice = me.groups.includes('office');
  const total = entries.reduce((t, e) => t + e.hours, 0);
  const byStage = stages.map((s) => ({ s, h: entries.filter((e) => e.stage_id === s.id).reduce((t, e) => t + e.hours, 0) }))
    .filter((x) => x.h > 0);
  const stageName = (id: number) => stages.find((s) => s.id === id)?.name ?? '';
  if (entries.length === 0) return <p className="text-slate-500">No hours logged yet.</p>;
  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">Total</span><span className="text-2xl font-bold">{fmtHours(total)}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {byStage.map(({ s, h }) => (
            <span key={s.id} className="chip bg-slate-100 py-1 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">{s.name} {fmtHours(h)}</span>
          ))}
        </div>
      </div>
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{fmtHours(e.hours)} · {stageName(e.stage_id)}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {e.staff_name} · {new Date(e.work_date + 'T00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
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
