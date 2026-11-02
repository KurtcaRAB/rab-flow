import { useEffect, useState } from 'react';
import { api } from './lib/api';
import type { Staff } from './lib/types';
import SignIn from './screens/SignIn';
import Home from './screens/Home';
import DataSheets from './screens/DataSheets';
import Settings from './screens/Settings';
import NewJob from './screens/NewJob';
import JobDetail from './screens/JobDetail';

// Screens live in the address (#/job/12) so the phone's back button works.
export type Route =
  | { to: 'home' }
  | { to: 'datasheets' }
  | { to: 'settings' }
  | { to: 'new' }
  | { to: 'job'; id: number };
export type Go = (r: Route, replace?: boolean) => void;

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  if (a === 'job' && Number(b) > 0) return { to: 'job', id: Number(b) };
  if (a === 'new' || a === 'datasheets' || a === 'settings') return { to: a };
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
      {route.to === 'home' && <Home me={me} go={go} onSignOut={signOut} />}
      {route.to === 'new' && <NewJob onBack={back} onSaved={(id) => go({ to: 'job', id }, true)} />}
      {route.to === 'job' && <JobDetail key={route.id} id={route.id} me={me} onBack={back} />}
      {route.to === 'datasheets' && <DataSheets isOffice={isOffice} onBack={back} />}
      {route.to === 'settings' && (isOffice ? <Settings me={me} onBack={back} /> : <Home me={me} go={go} onSignOut={signOut} />)}
    </div>
  );
}
