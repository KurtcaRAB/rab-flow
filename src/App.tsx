import { useEffect, useState } from 'react';
import { api } from './lib/api';
import type { Staff } from './lib/types';
import SignIn from './screens/SignIn';
import Home from './screens/Home';
import DataSheets from './screens/DataSheets';
import Settings from './screens/Settings';

export type Screen = 'home' | 'datasheets' | 'settings';

export default function App() {
  const [me, setMe] = useState<Staff | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>('home');

  useEffect(() => {
    api.restore().then(setMe);
  }, []);

  if (me === undefined) return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  if (!me) return <SignIn onSignedIn={(s) => { setMe(s); setScreen('home'); }} />;

  const signOut = async () => { await api.signOut(); setMe(null); };
  const isOffice = me.groups.includes('office');

  return (
    <div className="min-h-screen">
      {api.mode === 'demo' && (
        <div className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Preview with demo data. Changes stay in this browser only.
        </div>
      )}
      {screen === 'home' && <Home me={me} onGo={setScreen} onSignOut={signOut} />}
      {screen === 'datasheets' && <DataSheets isOffice={isOffice} onBack={() => setScreen('home')} />}
      {screen === 'settings' && isOffice && <Settings me={me} onBack={() => setScreen('home')} />}
    </div>
  );
}
