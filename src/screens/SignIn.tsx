import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { DEMO_PIN } from '../lib/demoApi';
import type { Staff } from '../lib/types';
import { ErrorText, Logo } from '../ui';

export default function SignIn({ onSignedIn }: { onSignedIn: (s: Staff) => void }) {
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSignedIn(await api.signIn(mobile, pin));
    } catch (err) {
      setError((err as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <Logo className="mx-auto mb-6 w-56 max-w-full" />
        <h1 className="inline-block border-b-4 border-brand pb-1 text-2xl font-black uppercase tracking-widest">RAB Flow</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">Yard job tracking</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="mobile">Mobile number</label>
          <input id="mobile" className="input text-lg" type="tel" inputMode="tel" autoComplete="username"
            placeholder="0412 345 678" value={mobile} onChange={(e) => setMobile(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="pin">PIN</label>
          <input id="pin" className="input text-center text-2xl tracking-[0.5em]" type="password" inputMode="numeric"
            autoComplete="current-password" maxLength={6} pattern="[0-9]{6}" placeholder="••••••"
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full text-lg" disabled={busy || pin.length !== 6}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {api.mode === 'demo' && (
        <p className="mt-6 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          Demo sign-in: Kurt (Office) is <b>0400 000 001</b>, Woody (Yard and QA) is <b>0400 000 002</b>, Happy (Painter) is <b>0400 000 003</b>. Every demo PIN is <b>{DEMO_PIN}</b>.
        </p>
      )}
    </main>
  );
}
