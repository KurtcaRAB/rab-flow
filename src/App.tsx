import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { clearFailures, flush, lastFailures, pending, subscribe } from './lib/outbox';
import type { Staff } from './lib/types';
import SignIn from './screens/SignIn';
import Home from './screens/Home';
import DataSheets from './screens/DataSheets';
import Settings from './screens/Settings';
import NewJob from './screens/NewJob';
import JobDetail from './screens/JobDetail';
import Reports from './screens/Reports';

// Screens live in the address (#/job/12) so the phone's back button works.
export type Route =
  | { to: 'home' }
  | { to: 'datasheets' }
  | { to: 'settings' }
  | { to: 'reports' }
  | { to: 'new' }
  | { to: 'job'; id: number };
export type Go = (r: Route, replace?: boolean) => void;

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  if (a === 'job' && Number(b) > 0) return { to: 'job', id: Number(b) };
  if (a === 'new' || a === 'datasheets' || a === 'settings' || a === 'reports') return { to: a };
  return { to: 'home' };
}
const toHash = (r: Route) => (r.to === 'home' ? '#/' : r.to === 'job' ? `#/job/${r.id}` : `#/${r.to}`);

export default function App() {
  const [me, setMe] = useState<Staff | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(() => parse(location.hash));

  useEffect(() => {
    api.restore().then(setMe);
    const onHash = () => { setRoute(parse(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go: Go = (r, replace) => {
    if (replace) history.replaceState(history.state, '', toHash(r));
    else history.pushState({ app: true }, '', toHash(r));
    setRoute(r);
    window.scrollTo(0, 0);
  };
  // Back to the board: use the browser history when we came from inside the app.
  const back = () => (history.state?.app ? history.back() : go({ to: 'home' }, true));

  if (me === undefined) return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  if (!me) return <SignIn onSignedIn={(s) => { setMe(s); go({ to: 'home' }, true); }} />;

  const signOut = async () => { await api.signOut(); setMe(null); };
  const isOffice = me.groups.includes('office');

  return (
    <div className="min-h-screen">
      {api.mode === 'demo' && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Preview with demo data. Changes stay in this browser only.
        </div>
      )}
      <OutboxBar />
      {route.to === 'home' && <Home me={me} go={go} onSignOut={signOut} />}
      {route.to === 'new' && <NewJob onBack={back} onSaved={(id) => go({ to: 'job', id }, true)} />}
      {route.to === 'job' && <JobDetail key={route.id} id={route.id} me={me} onBack={back} />}
      {route.to === 'datasheets' && <DataSheets isOffice={isOffice} onBack={back} />}
      {route.to === 'reports' && (isOffice ? <Reports onBack={back} /> : <Home me={me} go={go} onSignOut={signOut} />)}
      {route.to === 'settings' && (isOffice ? <Settings me={me} onBack={back} /> : <Home me={me} go={go} onSignOut={signOut} />)}
    </div>
  );
}

/** Shows entries waiting on this phone for signal, and sends them when it returns. */
function OutboxBar() {
  const [waiting, setWaiting] = useState(pending().length);
  const [failed, setFailed] = useState(lastFailures());
  useEffect(() => {
    const off = subscribe(() => { setWaiting(pending().length); setFailed(lastFailures()); });
    const tick = () => { if (pending().length) flush(); };
    tick();
    window.addEventListener('online', tick);
    const timer = setInterval(tick, 30_000);
    return () => { off(); window.removeEventListener('online', tick); clearInterval(timer); };
  }, []);
  if (!waiting && !failed.length) return null;
  return (
    <div className="space-y-1 bg-sky-100 px-4 py-2 text-sm font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-100">
      {waiting > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span>📶 {waiting} {waiting === 1 ? 'entry' : 'entries'} saved on this phone, waiting for signal.</span>
          <button className="shrink-0 underline" onClick={() => flush()}>Send now</button>
        </div>
      )}
      {failed.map((f) => <div key={f} className="text-red-700 dark:text-red-300">Not saved: {f}</div>)}
      {failed.length > 0 && <button className="underline" onClick={clearFailures}>OK</button>}
    </div>
  );
}
