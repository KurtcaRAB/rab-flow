// Demo data layer for the click-through preview: same behaviour as the live
// app, but stored in this browser only. Seeded from Kurt's lists.
import seed from '../demo-seed.json';
import { normaliseMobile } from './auth';
import type { Api, Staff, Stage, TableName, Tables } from './types';

export const DEMO_PIN = '123456';

interface Store {
  stages: Stage[];
  staff: (Staff & { pin: string })[];
  customers: Tables['customers'][];
  yard_locations: Tables['yard_locations'][];
  materials: Tables['materials'][];
  labour_rates: Tables['labour_rates'][];
  extras: Tables['extras'][];
  nextId: number;
}

const KEY = 'rabflow-demo-v1';

function fresh(): Store {
  let id = 1;
  const stages = seed.stages.map((name, i) => ({ id: id++, name, sort_order: i + 1 }));
  const stageId = (n: string) => stages.find((s) => s.name === n)!.id;
  return {
    stages,
    // Placeholder mobiles for the demo only: 0400 000 001, 0400 000 002, ...
    staff: seed.staff.map((s, i) => ({
      id: `demo-${i + 1}`, name: s.name, groups: s.groups as Staff['groups'],
      mobile: `04000000${String(i + 1).padStart(2, '0')}`, active: true, pin: DEMO_PIN,
    })),
    customers: seed.customers.map((name) => ({
      id: id++, name, contact_name: null, phone: null, email: null, notes: null, active: true,
    })),
    yard_locations: seed.locations.map((name, i) => ({ id: id++, name, sort_order: i + 1, active: true })),
    materials: seed.materials.map((m) => ({
      id: id++, name: m.name, type: m.type as 'primer' | 'topcoat', manufacturer: m.manufacturer ?? null,
      sds_url: m.sds_url ?? null, pds_url: m.pds_url ?? null, sds_status: m.sds_status ?? null,
      notes: m.notes ?? null, active: true, cost_per_l: m.cost_per_l, charge_per_l: m.charge_per_l,
    })),
    labour_rates: seed.labour_rates.map((r) => ({
      id: id++, name: r.name, stage_id: stageId(r.stage), cost_per_hour: r.cost_per_hour,
      charge_per_hour: r.charge_per_hour, is_default: r.is_default, active: true,
    })),
    extras: seed.extras.map((e) => ({ id: id++, ...e, active: true })),
    nextId: id,
  };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage blocked: fall back to fresh data */ }
  return fresh();
}

export function demoApi(): Api {
  const store = load();
  let me: Staff | null = null;
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* ignore */ }
  };
  const strip = ({ pin: _pin, ...s }: Staff & { pin: string }): Staff => s;
  const office = () => !!me?.groups.includes('office');
  const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

  return {
    mode: 'demo',
    async restore() {
      try {
        const id = sessionStorage.getItem(KEY + '-me');
        const s = store.staff.find((x) => x.id === id && x.active);
        me = s ? strip(s) : null;
      } catch { me = null; }
      return me;
    },
    async signIn(mobileInput, pin) {
      const mobile = normaliseMobile(mobileInput);
      if (!mobile) throw new Error('Enter a 10-digit mobile number.');
      const s = store.staff.find((x) => x.mobile === mobile);
      if (!s || s.pin !== pin) throw new Error('Mobile number or PIN is wrong.');
      if (!s.active) throw new Error('This sign-in is not active. Ask the office.');
      me = strip(s);
      try { sessionStorage.setItem(KEY + '-me', s.id); } catch { /* ignore */ }
      return later(me);
    },
    async signOut() {
      me = null;
      try { sessionStorage.removeItem(KEY + '-me'); } catch { /* ignore */ }
    },
    async stages() { return later(store.stages); },
    async list<K extends TableName>(table: K) {
      const rows = store[table] as Tables[K][];
      if (table === 'materials' && !office()) {
        return later(rows.map((r) => ({ ...r, cost_per_l: undefined, charge_per_l: undefined })));
      }
      if ((table === 'labour_rates' || table === 'extras') && !office()) return later([]);
      return later(rows.map((r) => ({ ...r })));
    },
    async save<K extends TableName>(table: K, row: Tables[K]) {
      if (!office()) throw new Error('Only Office staff can change settings.');
      const rows = store[table] as unknown as (Tables[K] & { id?: number })[];
      const r = row as Tables[K] & { id?: number };
      if (r.id) rows[rows.findIndex((x) => x.id === r.id)] = { ...r };
      else rows.push({ ...r, id: store.nextId++ });
      persist();
      return later(undefined);
    },
    async staff() { return later(store.staff.map(strip)); },
    async createStaff({ name, mobile, groups, pin }) {
      if (!office()) throw new Error('Only Office staff can manage staff.');
      if (store.staff.some((s) => s.mobile === mobile)) throw new Error('That mobile number is already used.');
      store.staff.push({ id: `demo-${store.nextId++}`, name, mobile, groups, pin, active: true });
      persist();
    },
    async updateStaff(s) {
      if (!office()) throw new Error('Only Office staff can manage staff.');
      if (store.staff.some((x) => x.mobile === s.mobile && x.id !== s.id)) throw new Error('That mobile number is already used.');
      const i = store.staff.findIndex((x) => x.id === s.id);
      store.staff[i] = { ...store.staff[i], ...s };
      persist();
    },
    async setPin(id, pin) {
      if (!office()) throw new Error('Only Office staff can manage staff.');
      store.staff.find((x) => x.id === id)!.pin = pin;
      persist();
    },
  };
}
