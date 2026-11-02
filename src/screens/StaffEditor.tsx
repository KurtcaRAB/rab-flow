import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { formatMobile, isValidPin, normaliseMobile } from '../lib/auth';
import { GROUP_LABELS, type Group, type Staff } from '../lib/types';
import { ErrorText, Sheet } from '../ui';

type Draft = { id?: string; name: string; mobile: string; groups: Group[]; active: boolean; pin: string };

export default function StaffEditor({ me }: { me: Staff }) {
  const [rows, setRows] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => api.staff().then(setRows);
  useEffect(() => { reload(); }, []);

  const open = (d: Draft) => { setError(''); setDone(''); setDraft(d); };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const mobile = normaliseMobile(draft.mobile);
    if (!mobile) return setError('Mobile must be a 10-digit Australian number, e.g. 0412 345 678.');
    if (draft.groups.length === 0) return setError('Pick at least one group.');
    if (!draft.id && !isValidPin(draft.pin)) return setError('Set a 6-digit starting PIN.');
    if (draft.id && draft.pin && !isValidPin(draft.pin)) return setError('A new PIN must be 6 digits.');
    if (draft.id === me.id && (!draft.active || !draft.groups.includes('office'))) {
      return setError('You cannot remove your own Office access.');
    }
    setBusy(true);
    setError('');
    try {
      if (draft.id) {
        await api.updateStaff({ id: draft.id, name: draft.name, mobile, groups: draft.groups, active: draft.active });
        if (draft.pin) await api.setPin(draft.id, draft.pin);
      } else {
        await api.createStaff({ name: draft.name, mobile, groups: draft.groups, pin: draft.pin });
      }
      setDone(draft.pin ? `Saved ${draft.name}. Tell them their PIN is ${draft.pin}.` : `Saved ${draft.name}.`);
      setDraft(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (g: Group) => setDraft((d) => d && ({
    ...d, groups: d.groups.includes(g) ? d.groups.filter((x) => x !== g) : [...d.groups, g],
  }));
  const randomPin = () => setDraft((d) => d && ({ ...d, pin: String(Math.floor(Math.random() * 1e6)).padStart(6, '0') }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500 dark:text-slate-400">{rows.filter((r) => r.active).length} active staff</p>
        <button className="btn-primary" onClick={() => open({ name: '', mobile: '', groups: [], active: true, pin: '' })}>+ Add</button>
      </div>
      {done && <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:bg-green-950 dark:text-green-200">{done}</p>}
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {rows.map((s) => (
          <li key={s.id}>
            <button className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
              onClick={() => open({ ...s, pin: '' })}>
              <div className="flex-1">
                <div className={`font-semibold ${s.active ? '' : 'text-slate-400 line-through'}`}>{s.name}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">{formatMobile(s.mobile)} · {s.groups.map((g) => GROUP_LABELS[g]).join(', ')}</div>
              </div>
              <span className="text-xl text-slate-400">›</span>
            </button>
          </li>
        ))}
      </ul>

      {draft && (
        <Sheet title={draft.id ? `Edit ${draft.name}` : 'New staff member'} onClose={() => setDraft(null)}>
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="label" htmlFor="s-name">Name</label>
              <input id="s-name" className="input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="s-mobile">Mobile number (used to sign in)</label>
              <input id="s-mobile" className="input" type="tel" inputMode="tel" required value={draft.mobile}
                onChange={(e) => setDraft({ ...draft, mobile: e.target.value })} />
            </div>
            <fieldset>
              <legend className="label">Groups (pick one or more)</legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(GROUP_LABELS) as Group[]).map((g) => (
                  <button type="button" key={g} onClick={() => toggle(g)}
                    className={`${draft.groups.includes(g) ? 'btn-primary' : 'btn-ghost'} min-h-11 px-4 text-sm`}>
                    {GROUP_LABELS[g]}
                  </button>
                ))}
              </div>
            </fieldset>
            <div>
              <label className="label" htmlFor="s-pin">{draft.id ? 'New PIN (leave empty to keep the current one)' : 'Starting PIN (6 digits)'}</label>
              <div className="flex gap-2">
                <input id="s-pin" className="input text-center text-xl tracking-[0.3em]" inputMode="numeric" maxLength={6}
                  value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '') })} />
                <button type="button" className="btn-ghost shrink-0" onClick={randomPin}>Random</button>
              </div>
            </div>
            {draft.id && (
              <label className="flex min-h-12 items-center gap-3">
                <input type="checkbox" className="h-6 w-6" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                <span>Active (untick when someone leaves; they can no longer sign in)</span>
              </label>
            )}
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
