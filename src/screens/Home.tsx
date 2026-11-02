import type { Screen } from '../App';
import { GROUP_LABELS, type Staff } from '../lib/types';
import { TopBar } from '../ui';

export default function Home({ me, onGo, onSignOut }: { me: Staff; onGo: (s: Screen) => void; onSignOut: () => void }) {
  const isOffice = me.groups.includes('office');
  return (
    <>
      <TopBar title="RAB Flow" right={<button className="btn-ghost min-h-10 px-4 text-sm" onClick={onSignOut}>Sign out</button>} />
      <main className="mx-auto max-w-3xl space-y-6 p-4">
        <section>
          <p className="text-lg">G'day <b>{me.name}</b></p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{me.groups.map((g) => GROUP_LABELS[g]).join(' · ')}</p>
        </section>

        <section className="card p-5">
          <h2 className="mb-1 text-lg font-bold">Yard board</h2>
          <p className="text-slate-500 dark:text-slate-400">Jobs in the yard will show here once job booking is built (phase 2).</p>
          <button className="btn-primary mt-4 w-full sm:w-auto" disabled>+ New job (phase 2)</button>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <button onClick={() => onGo('datasheets')} className="card p-5 text-left hover:border-brand">
            <div className="text-lg font-bold">Data sheets</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Primers and topcoats with their SDS and product data sheets</div>
          </button>
          {isOffice && (
            <button onClick={() => onGo('settings')} className="card p-5 text-left hover:border-brand">
              <div className="text-lg font-bold">Settings</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Customers, yard locations, materials, rates, extras and staff</div>
            </button>
          )}
        </section>
      </main>
    </>
  );
}
