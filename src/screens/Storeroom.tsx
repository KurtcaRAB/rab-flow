import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { isValidStoreCode } from '../lib/auth';
import type { Consumable, StorePerson, StoreTool, StoreUser } from '../lib/types';
import { ErrorText, Logo, Sheet, TopBar } from '../ui';

// The storeroom screen, opened with the shared STAFF / RABSTORE login.
// Each person picks their name, enters their own 4-digit code, then logs what
// they take. It goes back to the name screen after each visit, and after two
// minutes without a tap, so the next person can't log things under their name.

const IDLE_MS = 2 * 60 * 1000;

type Step = 'who' | 'code' | 'newcode' | 'menu' | 'take' | 'tools';

export default function Storeroom({ onExit }: { onExit: () => void }) {
  const [step, setStep] = useState<Step>('who');
  const [people, setPeople] = useState<StorePerson[]>([]);
  const [person, setPerson] = useState<StorePerson | null>(null);
  const [user, setUser] = useState<StoreUser | null>(null);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  const loadPeople = useCallback(() => {
    api.store.people().then(setPeople).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(loadPeople, [loadPeople]);

  const finish = useCallback((message = '') => {
    setUser(null);
    setPerson(null);
    setStep('who');
    setDone(message);
    setError('');
    loadPeople();
  }, [loadPeople]);

  // Back to the name screen after two minutes with no taps.
  const timer = useRef<number>();
  useEffect(() => {
    if (step === 'who') return;
    const reset = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => finish(), IDLE_MS);
    };
    reset();
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => { window.clearTimeout(timer.current); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [step, finish]);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(''), 6000);
    return () => window.clearTimeout(t);
  }, [done]);

  if (step === 'who') {
    return (
      <WhoAreYou people={people} done={done} error={error} onExit={onExit}
        onPick={(p) => { setDone(''); setError(''); setPerson(p); setStep(p.has_code ? 'code' : 'newcode'); }} />
    );
  }
  if (!person) return null;
  if (step === 'code' || step === 'newcode') {
    return (
      <CodeEntry person={person} isNew={step === 'newcode'} onCancel={() => finish()}
        onOk={(code) => { setUser({ staffId: person.id, code }); setStep('menu'); }} />
    );
  }
  if (!user) return null;
  if (step === 'take') return <TakeConsumables user={user} name={person.name} onBack={() => setStep('menu')} onDone={finish} />;
  if (step === 'tools') return <Tools user={user} name={person.name} onBack={() => setStep('menu')} onDone={finish} />;
  return <Menu user={user} name={person.name} go={setStep} onDone={() => finish()} />;
}

function WhoAreYou({ people, done, error, onPick, onExit }: {
  people: StorePerson[]; done: string; error: string; onPick: (p: StorePerson) => void; onExit: () => void;
}) {
  const [id, setId] = useState('');
  const picked = people.find((p) => p.id === id);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <Logo className="mx-auto mb-6 w-56 max-w-full" />
        <h1 className="inline-block border-b-4 border-brand pb-1 text-3xl font-black uppercase tracking-widest">Storeroom</h1>
      </div>
      {done && <p className="mb-6 rounded-xl border-2 border-ink bg-brand px-4 py-3 text-center text-lg font-bold text-ink">✓ {done}</p>}
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (picked) onPick(picked); }}>
        <div>
          <label className="label" htmlFor="who">Who are you?</label>
          <select id="who" className="input text-lg" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Choose your name</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full text-lg" disabled={!picked}>Next</button>
      </form>
      <button className="mx-auto mt-16 text-sm text-slate-500 underline" onClick={onExit}>Leave storeroom sign-in</button>
    </main>
  );
}

function CodeBox({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input id={id} className="input text-center text-3xl tracking-[0.6em]" type="password" inputMode="numeric" autoComplete="off"
      maxLength={4} placeholder="••••" autoFocus={autoFocus} value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} />
  );
}

function CodeEntry({ person, isNew, onOk, onCancel }: {
  person: StorePerson; isNew: boolean; onOk: (code: string) => void; onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (isNew && code !== again) { setError('The two codes don\'t match. Try again.'); setAgain(''); return; }
    setBusy(true);
    try {
      if (isNew) await api.store.setCode(person.id, code);
      await api.store.checkCode({ staffId: person.id, code });
      onOk(code);
    } catch (err) {
      setError((err as Error).message);
      setCode('');
      setAgain('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-2 text-center text-2xl font-black">{person.name}</h1>
      <p className="mb-6 text-center text-slate-600 dark:text-slate-300">
        {isNew ? 'First time here. Choose a 4-digit code you will remember. Keep it to yourself.' : 'Enter your 4-digit code.'}
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="code">{isNew ? 'New code' : 'Code'}</label>
          <CodeBox id="code" value={code} onChange={setCode} autoFocus />
        </div>
        {isNew && (
          <div>
            <label className="label" htmlFor="again">Same code again</label>
            <CodeBox id="again" value={again} onChange={setAgain} />
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full text-lg" disabled={busy || !isValidStoreCode(code) || (isNew && !isValidStoreCode(again))}>
          {busy ? 'Checking…' : isNew ? 'Save my code' : 'OK'}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={onCancel}>Not me</button>
      </form>
    </main>
  );
}

function Menu({ user, name, go, onDone }: { user: StoreUser; name: string; go: (s: Step) => void; onDone: () => void }) {
  const [mine, setMine] = useState<StoreTool[]>([]);
  useEffect(() => {
    api.store.tools().then((t) => setMine(t.filter((x) => x.out_staff_id === user.staffId))).catch(() => setMine([]));
  }, [user.staffId]);
  return (
    <>
      <TopBar title={`Storeroom · ${name}`} right={<button className="btn-ghost min-h-10 px-4 text-sm" onClick={onDone}>Done</button>} />
      <main className="mx-auto max-w-xl space-y-4 p-4">
        <button className="btn-primary min-h-28 w-full flex-col text-2xl" onClick={() => go('take')}>
          Take consumables
          <span className="text-sm font-medium">Gloves, discs, tape, media…</span>
        </button>
        <button className="btn-primary min-h-28 w-full flex-col text-2xl" onClick={() => go('tools')}>
          Sign tools out or back in
          <span className="text-sm font-medium">Grinders, gauges, spray gear…</span>
        </button>
        {mine.length > 0 && (
          <section className="card p-4">
            <h2 className="mb-2 font-bold">Tools you have out</h2>
            <ul className="space-y-1 text-slate-700 dark:text-slate-200">
              {mine.map((t) => <li key={t.id}>{t.name}{t.tag ? ` (${t.tag})` : ''} · since {when(t.out_at!)}</li>)}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

export function when(iso: string) {
  return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Search box plus category chips, shared by consumables and tools. */
function useFilter<T extends { name: string; category: string | null }>(rows: T[], extra: (r: T) => (string | null)[] = () => []) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort() as string[], [rows]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (!cat || r.category === cat)
      && (!t || [r.name, r.category, ...extra(r)].some((v) => v?.toLowerCase().includes(t))));
  }, [rows, q, cat, extra]);
  const bar = (
    <div className="space-y-3">
      <input className="input" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {cats.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button className={`${!cat ? 'btn-primary' : 'btn-ghost'} min-h-10 shrink-0 px-4 text-sm`} onClick={() => setCat('')}>All</button>
          {cats.map((c) => (
            <button key={c} className={`${cat === c ? 'btn-primary' : 'btn-ghost'} min-h-10 shrink-0 px-4 text-sm`} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
  return { shown, bar };
}

function TakeConsumables({ user, name, onBack, onDone }: { user: StoreUser; name: string; onBack: () => void; onDone: (msg: string) => void }) {
  const [items, setItems] = useState<Consumable[] | null>(null);
  const [basket, setBasket] = useState<Map<number, number>>(new Map());
  const [job, setJob] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);

  useEffect(() => { api.store.consumables().then(setItems).catch((e) => setError((e as Error).message)); }, []);
  const { shown, bar } = useFilter(items ?? []);

  const setQty = (id: number, qty: number) => setBasket((b) => {
    const next = new Map(b);
    if (qty > 0) next.set(id, Math.round(qty * 100) / 100); else next.delete(id);
    return next;
  });
  const chosen = (items ?? []).filter((i) => basket.has(i.id!));

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.store.take(user, chosen.map((i) => ({ consumable_id: i.id!, quantity: basket.get(i.id!)! })), job.trim() || null, note.trim() || null);
      onDone(`${name}: ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'} logged. Thanks.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="Take consumables" onBack={onBack} />
      <main className="mx-auto max-w-xl space-y-4 p-4 pb-32">
        {bar}
        {items === null && !error && <p className="text-slate-500">Loading…</p>}
        {items?.length === 0 && <p className="card p-4 text-slate-600">The consumables list is empty. Office can add items in Settings &gt; Consumables.</p>}
        <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
          {shown.map((i) => (
            <li key={i.id} className="flex min-h-16 items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{i.name}</div>
                <div className="text-sm text-slate-500">{[i.category, `per ${i.unit}`].filter(Boolean).join(' · ')}</div>
              </div>
              <Qty value={basket.get(i.id!) ?? 0} onChange={(q) => setQty(i.id!, q)} />
            </li>
          ))}
        </ul>
        {!review && <ErrorText>{error}</ErrorText>}
      </main>
      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t-4 border-brand bg-white p-4 dark:bg-slate-950">
          <button className="btn-primary mx-auto flex w-full max-w-xl text-lg" onClick={() => { setError(''); setReview(true); }}>
            Next: {chosen.length} {chosen.length === 1 ? 'item' : 'items'}
          </button>
        </div>
      )}
      {review && (
        <Sheet title="Check and save" onClose={() => setReview(false)}>
          <ul className="mb-4 space-y-1">
            {chosen.map((i) => <li key={i.id} className="flex justify-between gap-3"><span>{i.name}</span><b>{basket.get(i.id!)} {i.unit}</b></li>)}
          </ul>
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="job">Job Number (if it's for one job)</label>
              <input id="job" className="input" inputMode="numeric" placeholder="e.g. 261104001" value={job} onChange={(e) => setJob(e.target.value.replace(/\s/g, ''))} />
            </div>
            <div>
              <label className="label" htmlFor="note">Note (optional)</label>
              <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary w-full text-lg" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function Qty({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  if (value === 0) return <button className="btn-ghost h-12 w-14 px-0 text-2xl" aria-label="Add" onClick={() => onChange(1)}>+</button>;
  return (
    <div className="flex items-center gap-1">
      <button className="btn-ghost h-12 w-12 px-0 text-2xl" aria-label="Less" onClick={() => onChange(value - 1)}>−</button>
      <input className="input h-12 w-16 px-1 text-center text-lg font-bold" type="number" inputMode="decimal" min="0" step="any"
        value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} aria-label="Quantity" />
      <button className="btn-primary h-12 w-12 px-0 text-2xl" aria-label="More" onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

const toolExtra = (t: StoreTool) => [t.tag, t.location, t.out_staff_name];

function Tools({ user, name, onBack, onDone }: { user: StoreUser; name: string; onBack: () => void; onDone: (msg: string) => void }) {
  const [tools, setTools] = useState<StoreTool[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<StoreTool | null>(null);
  const [job, setJob] = useState('');
  const [msg, setMsg] = useState('');

  const reload = useCallback(() => api.store.tools().then(setTools).catch((e) => setError((e as Error).message)), []);
  useEffect(() => { reload(); }, [reload]);
  const { shown, bar } = useFilter(tools ?? [], toolExtra);
  const label = (t: StoreTool) => `${t.name}${t.tag ? ` (${t.tag})` : ''}`;

  async function act(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setOut(null);
      setJob('');
      setMsg(ok);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="Tools" onBack={onBack}
        right={<button className="btn-primary min-h-10 px-4 text-sm" onClick={() => onDone(msg ? `${name}: tools updated. Thanks.` : '')}>Done</button>} />
      <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
        {msg && <p className="rounded-xl border-2 border-ink bg-brand px-4 py-3 font-bold text-ink">✓ {msg}</p>}
        {!out && <ErrorText>{error}</ErrorText>}
        {bar}
        {tools === null && !error && <p className="text-slate-500">Loading…</p>}
        {tools?.length === 0 && <p className="card p-4 text-slate-600">The tools list is empty. Office can add tools in Settings &gt; Tools.</p>}
        <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
          {shown.map((t) => {
            const mine = t.out_staff_id === user.staffId;
            return (
              <li key={t.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{label(t)}</div>
                  <div className="text-sm text-slate-500">
                    {t.out_staff_name
                      ? <span className={mine ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-amber-700 dark:text-amber-300'}>
                          Out with {mine ? 'you' : t.out_staff_name} since {when(t.out_at!)}{t.out_job_number ? ` · Job ${t.out_job_number}` : ''}
                        </span>
                      : [t.category, t.location].filter(Boolean).join(' · ') || 'In the storeroom'}
                  </div>
                </div>
                {t.out_staff_name
                  ? <button className={`${mine ? 'btn-primary' : 'btn-ghost'} shrink-0 px-4`} disabled={busy}
                      onClick={() => act(() => api.store.toolIn(user, t.id), `${label(t)} returned.`)}>Return</button>
                  : <button className="btn-primary shrink-0 px-4" disabled={busy} onClick={() => { setError(''); setOut(t); }}>Sign out</button>}
              </li>
            );
          })}
        </ul>
      </main>
      {out && (
        <Sheet title={`Sign out ${label(out)}`} onClose={() => setOut(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); act(() => api.store.toolOut(user, out.id, job.trim() || null), `${label(out)} signed out to you.`); }}>
            <div>
              <label className="label" htmlFor="tjob">Job Number (if it's for one job)</label>
              <input id="tjob" className="input" inputMode="numeric" placeholder="e.g. 261104001" value={job} onChange={(e) => setJob(e.target.value.replace(/\s/g, ''))} />
            </div>
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary w-full text-lg" disabled={busy}>{busy ? 'Saving…' : 'Sign it out to me'}</button>
          </form>
        </Sheet>
      )}
    </>
  );
}
