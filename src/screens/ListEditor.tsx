import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { TableName, Tables } from '../lib/types';
import { ErrorText, Sheet } from '../ui';

export interface FieldDef {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'url' | 'number' | 'money' | 'select' | 'bool';
  options?: { value: string | number; label: string }[];
  required?: boolean;
}

interface Props<K extends TableName> {
  table: K;
  noun: string;
  fields: FieldDef[];
  blank: () => Tables[K];
  title: (row: Tables[K]) => string;
  subtitle?: (row: Tables[K]) => ReactNode;
  sort?: (a: Tables[K], b: Tables[K]) => number;
}

type Row = Record<string, unknown> & { id?: number; active: boolean };

export default function ListEditor<K extends TableName>({ table, noun, fields, blank, title, subtitle, sort }: Props<K>) {
  const [rows, setRows] = useState<Tables[K][]>([]);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => api.list(table).then(setRows);
  useEffect(() => { reload(); }, [table]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const r = rows.filter((x) => (showInactive || x.active) && title(x).toLowerCase().includes(q.toLowerCase()));
    return sort ? [...r].sort(sort) : r;
  }, [rows, q, showInactive, title, sort]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await api.save(table, editing as unknown as Tables[K]);
      setEditing(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (key: string, value: unknown) => setEditing((r) => (r ? { ...r, [key]: value } : r));

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className="input flex-1" placeholder={`Search ${rows.length} ${noun}s`} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => { setError(''); setEditing(blank() as unknown as Row); }}>+ Add</button>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input type="checkbox" className="h-5 w-5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Show inactive
      </label>
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {shown.map((r) => {
          const row = r as unknown as Row;
          return (
            <li key={row.id}>
              <button className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                onClick={() => { setError(''); setEditing({ ...row }); }}>
                <div className="min-w-0 flex-1">
                  <div className={`font-semibold ${row.active ? '' : 'text-slate-400 line-through'}`}>{title(r)}</div>
                  {subtitle && <div className="text-sm text-slate-500 dark:text-slate-400">{subtitle(r)}</div>}
                </div>
                <span className="text-xl text-slate-400">›</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-6 text-slate-500">Nothing found.</li>}
      </ul>

      {editing && (
        <Sheet title={editing.id ? `Edit ${noun}` : `New ${noun}`} onClose={() => setEditing(null)}>
          <form onSubmit={save} className="space-y-4">
            {fields.map((f) => <FieldInput key={f.key} f={f} value={editing[f.key]} onChange={(v) => set(f.key, v)} />)}
            <label className="flex min-h-12 items-center gap-3">
              <input type="checkbox" className="h-6 w-6" checked={editing.active} onChange={(e) => set('active', e.target.checked)} />
              <span>Active (untick to hide it from lists)</span>
            </label>
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}

function FieldInput({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const id = `f-${f.key}`;
  if (f.kind === 'bool') {
    return (
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" className="h-6 w-6" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span>{f.label}</span>
      </label>
    );
  }
  const text = value === null || value === undefined ? '' : String(value);
  const toNull = (s: string) => (s.trim() === '' ? null : s);
  return (
    <div>
      <label className="label" htmlFor={id}>{f.label}</label>
      {f.kind === 'textarea' ? (
        <textarea id={id} className="input min-h-24 py-3" value={text} onChange={(e) => onChange(toNull(e.target.value))} />
      ) : f.kind === 'select' ? (
        <select id={id} className="input" value={text} required={f.required}
          onChange={(e) => {
            const opt = f.options!.find((o) => String(o.value) === e.target.value);
            onChange(opt ? opt.value : null);
          }}>
          {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.kind === 'number' || f.kind === 'money' ? (
        <div className="relative">
          {f.kind === 'money' && <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>}
          <input id={id} className={`input ${f.kind === 'money' ? 'pl-8' : ''}`} type="number" inputMode="decimal"
            step={f.kind === 'money' ? '0.01' : '1'} min="0" required value={text}
            onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
        </div>
      ) : (
        <input id={id} className="input" type={f.kind === 'url' ? 'url' : 'text'} required={f.required} value={text}
          onChange={(e) => onChange(f.required ? e.target.value : toNull(e.target.value))} />
      )}
    </div>
  );
}
