// Weak signal in the yard: hours and paint entries that cannot be sent are
// kept on the phone and sent automatically when signal comes back. Each entry
// carries a client_ref so a retry never saves it twice.
import { api } from './api';
import { isNetworkError, newId } from './net';
import type { NewLabour, NewPaint } from './types';

export type Pending =
  | { kind: 'hours'; data: NewLabour; label: string; at: string }
  | { kind: 'paint'; data: NewPaint; label: string; at: string };

const KEY = 'rabflow-outbox';
const listeners = new Set<() => void>();
let failures: string[] = [];

function read(): Pending[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function write(list: Pending[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  listeners.forEach((l) => l());
}

export const pending = read;
export const lastFailures = () => failures;
export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

const send = (p: Pending) => (p.kind === 'hours' ? api.logHours(p.data) : api.logPaint(p.data));

/** Sends now if possible; otherwise keeps it on the phone. */
export async function saveOrQueue(p: Omit<Pending, 'at'>): Promise<'sent' | 'queued'> {
  const item = { ...p, data: { ...p.data, client_ref: p.data.client_ref ?? newId() }, at: new Date().toISOString() } as Pending;
  try {
    await send(item);
    return 'sent';
  } catch (e) {
    if (!isNetworkError((e as Error).message)) throw e;
    write([...read(), item]);
    return 'queued';
  }
}

let flushing = false;
/** Tries to send everything waiting. Stops at the first sign of no signal. */
export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of read()) {
      try {
        await send(item);
      } catch (e) {
        const msg = (e as Error).message;
        if (isNetworkError(msg)) break;
        // Rejected by the server (e.g. job deleted): drop it, but say so.
        failures = [...failures, `${item.label}: ${msg}`];
      }
      write(read().filter((x) => x.data.client_ref !== item.data.client_ref));
    }
  } finally {
    flushing = false;
  }
}

export function clearFailures() { failures = []; listeners.forEach((l) => l()); }
