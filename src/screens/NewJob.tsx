import { useEffect, useState, type FormEvent } from 'react';
import { CustomerPicker, PhotoPicker, StagePicker } from '../jobUi';
import { api } from '../lib/api';
import type { Customer, NewItem, Stage, YardLocation } from '../lib/types';
import { ErrorText, TopBar } from '../ui';

export const blankItem = (): NewItem => ({ description: '', serial_number: null, quantity: 1, note: null, photos: [] });
let nextKey = 1;
const keyedItem = () => ({ ...blankItem(), key: nextKey++ });

/** Description, serial number, quantity, note and photos for one item. */
export function ItemFields({ item, onChange, n }: {
  item: NewItem; onChange: (fn: (prev: NewItem) => NewItem) => void; n?: number;
}) {
  const set = <K extends keyof NewItem>(k: K, v: NewItem[K]) => onChange((prev) => ({ ...prev, [k]: v }));
  const id = (f: string) => `item${n ?? ''}-${f}`;
  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor={id('desc')}>What is it?</label>
        <input id={id('desc')} className="input" required placeholder="e.g. Trailer chassis, 6 x handrails"
          value={item.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <div>
          <label className="label" htmlFor={id('sn')}>Serial number</label>
          <input id={id('sn')} className="input" autoCapitalize="characters" value={item.serial_number ?? ''}
            onChange={(e) => set('serial_number', e.target.value.trim() ? e.target.value : null)} />
        </div>
        <div>
          <label className="label" htmlFor={id('qty')}>Qty</label>
          <input id={id('qty')} className="input" type="number" inputMode="numeric" min={1} required value={item.quantity}
            onChange={(e) => set('quantity', Math.max(1, Number(e.target.value) || 1))} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={id('note')}>Note</label>
        <input id={id('note')} className="input" placeholder="Damage, special instructions…" value={item.note ?? ''}
          onChange={(e) => set('note', e.target.value.trim() ? e.target.value : null)} />
      </div>
      <PhotoPicker photos={item.photos} onChange={(fn) => onChange((prev) => ({ ...prev, photos: fn(prev.photos) }))} label="Item photo" />
    </div>
  );
}

export default function NewJob({ onBack, onSaved }: { onBack: () => void; onSaved: (id: number) => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [locations, setLocations] = useState<YardLocation[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);

  const [photos, setPhotos] = useState<Blob[]>([]);
  const [quote, setQuote] = useState('');
  const [po, setPo] = useState('');
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [stageIds, setStageIds] = useState<number[]>([]);
  const [items, setItems] = useState<(NewItem & { key: number })[]>(() => [keyedItem()]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.list('customers').then((c) => setCustomers(c.filter((x) => x.active)));
    api.list('yard_locations').then((l) => setLocations(l.filter((x) => x.active).sort((a, b) => a.sort_order - b.sort_order)));
    api.stages().then((s) => { setStages(s); setStageIds(s.map((x) => x.id)); });
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!customerId) return setError('Pick the customer.');
    if (!quote.trim()) return setError('Enter the quote number.');
    setBusy(true);
    try {
      const { id, photoErrors } = await api.createJob({
        quote_number: quote.trim(), po_number: po.trim() || null, customer_id: customerId, location_id: locationId,
        stage_ids: stages.filter((s) => stageIds.includes(s.id)).map((s) => s.id), note: note.trim() || null,
        photos, items: items.map(({ key: _k, ...i }) => ({ ...i, description: i.description.trim() })),
      });
      if (photoErrors) alertLater(`Job saved, but ${photoErrors} photo(s) did not upload. Add them again from the job.`);
      onSaved(id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="New job" onBack={onBack} />
      <form onSubmit={save} className="mx-auto max-w-2xl space-y-6 p-4 pb-28">
        <section className="space-y-2">
          <h2 className="text-lg font-bold">Photos</h2>
          <PhotoPicker photos={photos} onChange={setPhotos} />
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="quote">Quote number</label>
            <input id="quote" className="input" required value={quote} onChange={(e) => setQuote(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="po">Customer PO (optional)</label>
            <input id="po" className="input" value={po} onChange={(e) => setPo(e.target.value)} />
          </div>
        </section>

        <section>
          <span className="label">Customer</span>
          <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} />
        </section>

        <section>
          <label className="label" htmlFor="loc">Yard location</label>
          <select id="loc" className="input" value={locationId ?? ''}
            onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Not placed yet</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold">Items</h2>
          {items.map((it, i) => (
            <div key={it.key} className="card space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Item {i + 1}</span>
                {items.length > 1 && (
                  <button type="button" className="text-sm font-semibold text-red-600"
                    onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}>Remove</button>
                )}
              </div>
              <ItemFields n={i} item={it} onChange={(fn) => setItems((prev) => prev.map((x) => (x.key === it.key ? { ...fn(x), key: x.key } : x)))} />
            </div>
          ))}
          <button type="button" className="btn-ghost w-full" onClick={() => setItems((prev) => [...prev, keyedItem()])}>+ Another item</button>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold">Stages needed</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Untick any stage this job skips.</p>
          <StagePicker stages={stages} value={stageIds} onChange={setStageIds} />
        </section>

        <section>
          <label className="label" htmlFor="note">Job note</label>
          <textarea id="note" className="input min-h-24 py-3" value={note} onChange={(e) => setNote(e.target.value)} />
        </section>

        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="mx-auto max-w-2xl space-y-2">
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary w-full text-lg" disabled={busy}>{busy ? 'Saving…' : 'Book job in'}</button>
          </div>
        </div>
      </form>
    </>
  );
}

// A note that survives the screen change to the new job.
export function alertLater(msg: string) {
  try { sessionStorage.setItem('rabflow-notice', msg); } catch { /* ignore */ }
}
export function takeNotice(): string {
  try {
    const m = sessionStorage.getItem('rabflow-notice') ?? '';
    sessionStorage.removeItem('rabflow-notice');
    return m;
  } catch { return ''; }
}
