import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CustomerPicker, JobStatusChip, PhotoPicker, StagePicker, dateTime, shortDate } from '../jobUi';
import { api } from '../lib/api';
import {
  PHOTO_STAGES, type Customer, type LabourEntry, type JobDetail as Detail, type JobStatus, type NewItem, type PhotoStage, type Stage,
  type Staff, type YardLocation,
} from '../lib/types';
import { ErrorText, Sheet, TopBar } from '../ui';
import { ItemFields, blankItem, takeNotice } from './NewJob';
import { HoursList, LogHours } from './LogHours';

type Tab = 'Items' | 'Hours' | 'Photos' | 'History';

export default function JobDetail({ id, me, onBack }: { id: number; me: Staff; onBack: () => void }) {
  const isOffice = me.groups.includes('office');
  const [job, setJob] = useState<Detail | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [locations, setLocations] = useState<YardLocation[]>([]);
  const [tab, setTab] = useState<Tab>('Items');
  const [sheet, setSheet] = useState<'status' | 'edit' | 'item' | 'photos' | 'hours' | null>(null);
  const [hours, setHours] = useState<LabourEntry[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [notice, setNotice] = useState(takeNotice);
  const [error, setError] = useState('');

  const reload = useCallback(() => Promise.all([api.job(id).then(setJob), api.labour(id).then(setHours)])
    .catch((e) => setError((e as Error).message)), [id]);
  useEffect(() => {
    reload();
    api.stages().then(setStages);
    api.list('yard_locations').then((l) => setLocations(l.filter((x) => x.active).sort((a, b) => a.sort_order - b.sort_order)));
  }, [reload]);

  async function update(patch: Parameters<typeof api.updateJob>[1]) {
    setError('');
    try { await api.updateJob(id, patch); await reload(); } catch (e) { setError((e as Error).message); }
  }

  if (!job) {
    return (<><TopBar title="Job" onBack={onBack} /><main className="p-4 text-slate-500">{error || 'Loading…'}</main></>);
  }

  const neededStages = stages.filter((s) => job.stage_ids.includes(s.id));
  const moveTo: JobStatus[] = ['Booked in', ...neededStages.map((s) => s.name as JobStatus), 'Ready for pickup',
    ...(isOffice ? ['Collected' as JobStatus] : [])];

  return (
    <>
      <TopBar title={job.job_number} onBack={onBack}
        right={<button className="btn-ghost min-h-10 px-4 text-sm" onClick={() => setSheet('edit')}>Edit</button>} />
      <main className="mx-auto max-w-3xl space-y-4 p-4 pb-12">
        {notice && (
          <p className="rounded-xl bg-amber-100 px-4 py-3 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {notice} <button className="ml-2 underline" onClick={() => setNotice('')}>OK</button>
          </p>
        )}
        <ErrorText>{error}</ErrorText>

        {job.cover_url && (
          <button className="block w-full" onClick={() => setViewing(job.cover_url)}>
            <img src={job.cover_url} alt="" className="max-h-72 w-full rounded-2xl object-cover" />
          </button>
        )}

        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold">{job.customer_name}</h2>
            <JobStatusChip status={job.status} big />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Info label="Quote">{job.quote_number}</Info>
            <Info label="Customer PO">
              {job.po_number || <button className="font-semibold text-brand" onClick={() => setSheet('edit')}>+ Add PO</button>}
            </Info>
            <Info label="Booked in">{shortDate(job.date_in)}{job.created_by_name ? ` by ${job.created_by_name}` : ''}</Info>
            {job.date_out && <Info label="Collected">{shortDate(job.date_out)}</Info>}
            <Info label="Stages">{neededStages.map((s) => s.name).join(', ') || 'None picked'}</Info>
          </dl>
          {job.note && <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">{job.note}</p>}
        </section>

        <section className="grid grid-cols-2 gap-3">
          {job.status !== 'Collected' && <button className="btn-primary" onClick={() => setSheet('hours')}>⏱ Log hours</button>}
          <button className="btn-ghost" onClick={() => setSheet('status')}>Move stage</button>
          <select className="input col-span-2 font-semibold" aria-label="Yard location" value={job.location_id ?? ''}
            onChange={(e) => update({ location_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">📍 No location</option>
            {locations.map((l) => <option key={l.id} value={l.id}>📍 {l.name}</option>)}
          </select>
        </section>

        <nav className="grid grid-cols-4 gap-1.5">
          {(['Items', 'Hours', 'Photos', 'History'] as Tab[]).map((t) => (
            <button key={t} className={`${tab === t ? 'btn-primary' : 'btn-ghost'} min-h-10 gap-1 whitespace-nowrap px-1 text-sm`} onClick={() => setTab(t)}>
              {t}<span className="opacity-70">{t === 'Items' ? job.item_rows.length : t === 'Photos' ? job.photos.length
                : t === 'Hours' && hours.length ? Math.round(hours.reduce((a, e) => a + e.hours, 0) * 10) / 10 : ''}</span>
            </button>
          ))}
        </nav>

        {tab === 'Items' && (
          <section className="space-y-3">
            {job.item_rows.map((it) => {
              const pics = job.photos.filter((p) => p.item_id === it.id);
              return (
                <div key={it.id} className="card space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{it.quantity > 1 ? `${it.quantity} × ` : ''}{it.description}</div>
                    <span className="shrink-0 text-xs text-slate-500">{shortDate(it.added_at)}</span>
                  </div>
                  {it.serial_number && <div className="text-sm">S/N <b className="font-mono">{it.serial_number}</b></div>}
                  {it.note && <div className="text-sm text-slate-500 dark:text-slate-400">{it.note}</div>}
                  {pics.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {pics.map((p) => (
                        <button key={p.id} onClick={() => setViewing(p.url)}>
                          <img src={p.url} alt="" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {job.item_rows.length === 0 && <p className="text-slate-500">No items yet.</p>}
            {job.status !== 'Collected' && (
              <button className="btn-ghost w-full" onClick={() => setSheet('item')}>+ Add item</button>
            )}
          </section>
        )}

        {tab === 'Hours' && (
          <HoursList entries={hours} stages={stages} me={me} onDelete={async (eid) => {
            if (!window.confirm('Remove this hours entry?')) return;
            try { await api.deleteHours(eid); await reload(); } catch (e) { setError((e as Error).message); }
          }} />
        )}

        {tab === 'Photos' && (
          <section className="space-y-4">
            <button className="btn-ghost w-full" onClick={() => setSheet('photos')}>📷 Add photos</button>
            {PHOTO_STAGES.filter((s) => job.photos.some((p) => p.stage === s)).map((s) => (
              <div key={s}>
                <h3 className="mb-2 font-semibold">{s}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {job.photos.filter((p) => p.stage === s).map((p) => (
                    <button key={p.id} onClick={() => setViewing(p.url)}>
                      <img src={p.url} alt="" loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {job.photos.length === 0 && <p className="text-slate-500">No photos yet.</p>}
          </section>
        )}

        {tab === 'History' && (
          <ol className="card divide-y divide-slate-200 dark:divide-slate-800">
            {job.events.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="font-medium">{e.detail}</div>
                <div className="text-sm text-slate-500">{dateTime(e.at)}{e.by_name ? ` · ${e.by_name}` : ''}</div>
              </li>
            ))}
          </ol>
        )}
      </main>

      {sheet === 'status' && (
        <Sheet title="Move to" onClose={() => setSheet(null)}>
          <div className="grid gap-2">
            {moveTo.map((s) => (
              <button key={s} disabled={s === job.status}
                className={`${s === job.status ? 'btn-primary' : 'btn-ghost'} justify-start`}
                onClick={async () => { setSheet(null); await update({ status: s }); }}>
                <JobStatusChip status={s} />{s === job.status && <span className="ml-auto text-sm">now</span>}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-500">Only the stages this job needs are listed. Edit the job to change them.</p>
        </Sheet>
      )}
      {sheet === 'hours' && (
        <LogHours jobId={id} me={me} stages={stages} needed={job.stage_ids} onClose={() => setSheet(null)}
          onSaved={async () => { setSheet(null); setTab('Hours'); await reload(); }} />
      )}
      {sheet === 'edit' && (
        <EditJob job={job} stages={stages} onClose={() => setSheet(null)}
          onSaved={async (patch) => { await api.updateJob(id, patch); setSheet(null); await reload(); }} />
      )}
      {sheet === 'item' && (
        <AddItem onClose={() => setSheet(null)} onSave={async (item) => {
          const failed = await api.addItem(id, item);
          if (failed) setNotice(`Item saved, but ${failed} photo(s) did not upload.`);
          setSheet(null); setTab('Items'); await reload();
        }} />
      )}
      {sheet === 'photos' && (
        <AddPhotos current={job.status} onClose={() => setSheet(null)} onSave={async (photos, stage) => {
          const failed = await api.addPhotos(id, photos, { stage });
          if (failed) setNotice(`${failed} photo(s) did not upload. Try again.`);
          setSheet(null); setTab('Photos'); await reload();
        }} />
      )}
      {viewing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/90 p-2" onClick={() => setViewing(null)} role="dialog" aria-label="Photo">
          <img src={viewing} alt="" className="max-h-full max-w-full object-contain" />
          <button className="absolute right-3 top-3 h-12 w-12 rounded-full bg-white/20 text-2xl text-white" aria-label="Close">×</button>
        </div>
      )}
    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function useSaving() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return { busy, error, setError, run };
}

function EditJob({ job, stages, onClose, onSaved }: {
  job: Detail; stages: Stage[]; onClose: () => void; onSaved: (p: Parameters<typeof api.updateJob>[1]) => Promise<void>;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quote, setQuote] = useState(job.quote_number);
  const [po, setPo] = useState(job.po_number ?? '');
  const [customerId, setCustomerId] = useState<number | null>(job.customer_id);
  const [stageIds, setStageIds] = useState(job.stage_ids);
  const [note, setNote] = useState(job.note ?? '');
  const { busy, error, setError, run } = useSaving();
  useEffect(() => { api.list('customers').then((c) => setCustomers(c.filter((x) => x.active || x.id === job.customer_id))); }, [job.customer_id]);

  function save(e: FormEvent) {
    e.preventDefault();
    if (!customerId) return setError('Pick the customer.');
    if (!quote.trim()) return setError('Enter the quote number.');
    run(() => onSaved({
      quote_number: quote.trim(), po_number: po.trim() || null, customer_id: customerId, note: note.trim() || null,
      stage_ids: stages.filter((s) => stageIds.includes(s.id)).map((s) => s.id),
    }));
  }

  return (
    <Sheet title={`Edit ${job.job_number}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="eq">Quote number</label>
            <input id="eq" className="input" required value={quote} onChange={(e) => setQuote(e.target.value)} /></div>
          <div><label className="label" htmlFor="ep">Customer PO</label>
            <input id="ep" className="input" value={po} onChange={(e) => setPo(e.target.value)} /></div>
        </div>
        <div><span className="label">Customer</span>
          <CustomerPicker customers={customers} value={customerId} onChange={setCustomerId} /></div>
        <div><span className="label">Stages needed</span>
          <StagePicker stages={stages} value={stageIds} onChange={setStageIds} /></div>
        <div><label className="label" htmlFor="en">Job note</label>
          <textarea id="en" className="input min-h-24 py-3" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  );
}

function AddItem({ onClose, onSave }: { onClose: () => void; onSave: (i: NewItem) => Promise<void> }) {
  const [item, setItem] = useState<NewItem>(blankItem);
  const { busy, error, run } = useSaving();
  return (
    <Sheet title="Add item" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => onSave({ ...item, description: item.description.trim() })); }}>
        <ItemFields item={item} onChange={setItem} />
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Add item'}</button>
      </form>
    </Sheet>
  );
}

function AddPhotos({ current, onClose, onSave }: {
  current: JobStatus; onClose: () => void; onSave: (p: Blob[], s: PhotoStage) => Promise<void>;
}) {
  const guess: PhotoStage = current === 'Booked in' ? 'Intake'
    : current === 'Ready for pickup' || current === 'Collected' ? 'Out' : current;
  const [stage, setStage] = useState<PhotoStage>(guess);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const { busy, error, run } = useSaving();
  return (
    <Sheet title="Add photos" onClose={onClose}>
      <div className="space-y-4">
        <div><label className="label" htmlFor="ps">Taken at</label>
          <select id="ps" className="input" value={stage} onChange={(e) => setStage(e.target.value as PhotoStage)}>
            {PHOTO_STAGES.map((s) => <option key={s}>{s}</option>)}
          </select></div>
        <PhotoPicker photos={photos} onChange={setPhotos} />
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy || photos.length === 0}
          onClick={() => run(() => onSave(photos, stage))}>{busy ? 'Uploading…' : `Save ${photos.length || ''} photo${photos.length === 1 ? '' : 's'}`}</button>
      </div>
    </Sheet>
  );
}
