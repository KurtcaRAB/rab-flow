// Demo data layer for the click-through preview: same behaviour as the live
// app, but stored in this browser only. Seeded from Kurt's lists.
import seed from '../demo-seed.json';
import { normaliseMobile } from './auth';
import { blobToDataUrl, shrinkPhoto } from './photos';
import type {
  Api, CostLine, Job, JobCard, JobExtra, LabourEntry, PaintEntry, QaCheck, JobEvent, JobItem, JobPatch, JobPhoto, NewItem, PhotoStage, Staff, Stage, TableName, Tables,
} from './types';

type DemoPhoto = Omit<JobPhoto, 'url'> & { data: string };
type DemoEvent = Omit<JobEvent, 'by_name'> & { job_id: number; by: string | null };

export const DEMO_PIN = '123456';

interface Store {
  stages: Stage[];
  staff: (Staff & { pin: string })[];
  customers: Tables['customers'][];
  yard_locations: Tables['yard_locations'][];
  materials: Tables['materials'][];
  labour_rates: Tables['labour_rates'][];
  extras: Tables['extras'][];
  jobs: Job[];
  job_items: JobItem[];
  job_photos: DemoPhoto[];
  job_events: DemoEvent[];
  labour: Omit<LabourEntry, 'staff_name'>[];
  paint: Omit<PaintEntry, 'staff_name'>[];
  qa: (Omit<QaCheck, 'by_name'> & { by: string })[];
  job_extras: JobExtra[];
  nextJobNumber: number;
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
    jobs: [], job_items: [], job_photos: [], job_events: [], labour: [], paint: [], qa: [], job_extras: [], nextJobNumber: 1,
    nextId: id,
  };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // Stores saved before jobs existed get empty job lists.
      return { jobs: [], job_items: [], job_photos: [], job_events: [], labour: [], paint: [], qa: [], job_extras: [], nextJobNumber: 1, ...JSON.parse(raw) };
    }
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
  const now = () => new Date().toISOString();
  const nameOf = (id: string | null) => store.staff.find((s) => s.id === id)?.name ?? null;
  const signedIn = () => { if (!me) throw new Error('Please sign in again.'); return me; };
  const event = (job_id: number, kind: string, detail: string) =>
    store.job_events.push({ id: store.nextId++, job_id, kind, detail, by: me?.id ?? null, at: now() });

  async function savePhotos(jobId: number, photos: Blob[], stage: PhotoStage, itemId: number | null) {
    for (const p of photos) {
      // Small copies: this preview keeps everything in browser storage.
      const data = await blobToDataUrl(await shrinkPhoto(p, 480, 0.6));
      store.job_photos.push({ id: store.nextId++, job_id: jobId, item_id: itemId, stage, taken_by: me?.id ?? null, taken_at: now(), data });
    }
  }

  /** YYMMDD (Brisbane time) + count for the day, as the database makes it. */
  function nextJobNumber() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Brisbane', year: '2-digit', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const day = `${p.year}${p.month}${p.day}`;
    const n = store.jobs.filter((j) => j.job_number.startsWith(day) && j.job_number.length > 6).length + 1;
    return day + String(n).padStart(3, '0');
  }

  function addItemRow(jobId: number, { photos: _p, ...item }: NewItem): JobItem {
    const row: JobItem = { ...item, id: store.nextId++, job_id: jobId, added_by: me?.id ?? null, added_at: now() };
    store.job_items.push(row);
    return row;
  }

  function card(j: Job): JobCard {
    const photos = store.job_photos.filter((p) => p.job_id === j.id)
      .sort((a, b) => (a.stage === 'Intake' ? 0 : 1) - (b.stage === 'Intake' ? 0 : 1) || a.taken_at.localeCompare(b.taken_at));
    return {
      ...j,
      customer_name: store.customers.find((c) => c.id === j.customer_id)?.name ?? '',
      location_name: store.yard_locations.find((l) => l.id === j.location_id)?.name ?? null,
      items: store.job_items.filter((i) => i.job_id === j.id)
        .map(({ description, serial_number, quantity }) => ({ description, serial_number, quantity })),
      cover_url: photos[0]?.data ?? null,
    };
  }

  function persistOrWarn() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      throw new Error('This preview has run out of browser storage for photos. Saved for this visit only.');
    }
  }

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

    async jobs({ includeCollected }) {
      const rows = store.jobs.filter((j) => includeCollected || j.status !== 'Collected')
        .sort((a, b) => b.date_in.localeCompare(a.date_in));
      return later(rows.map(card));
    },

    async job(id) {
      const j = store.jobs.find((x) => x.id === id);
      if (!j) throw new Error('Job not found.');
      return later({
        ...card(j),
        created_by_name: nameOf(j.created_by),
        item_rows: store.job_items.filter((i) => i.job_id === id),
        photos: store.job_photos.filter((p) => p.job_id === id).map(({ data, ...p }) => ({ ...p, url: data })),
        events: store.job_events.filter((e) => e.job_id === id).reverse()
          .map(({ by, job_id: _j, ...e }) => ({ ...e, by_name: nameOf(by) })),
      });
    },

    async createJob({ photos, items, ...input }) {
      const who = signedIn();
      const job: Job = {
        ...input, id: store.nextId++, job_number: nextJobNumber(),
        status: 'Booked in', date_in: now(), date_out: null, created_by: who.id,
      };
      store.jobs.push(job);
      event(job.id, 'booked_in', 'Booked in');
      await savePhotos(job.id, photos, 'Intake', null);
      for (const item of items) {
        const row = addItemRow(job.id, item);
        await savePhotos(job.id, item.photos, 'Intake', row.id);
      }
      persistOrWarn();
      return later({ id: job.id, photoErrors: 0 });
    },

    async updateJob(id, patch: JobPatch) {
      signedIn();
      const j = store.jobs.find((x) => x.id === id)!;
      if (patch.status === 'Collected' && j.status !== 'Collected' && !office()) throw new Error('Only Office can mark a job collected.');
      if (patch.status === 'Ready for pickup' && j.status !== 'Ready for pickup' && !office()) {
        throw new Error('A job is ready for pickup once it passes QA.');
      }
      const locName = (l: number | null) => store.yard_locations.find((x) => x.id === l)?.name ?? 'No location';
      if (patch.status && patch.status !== j.status) {
        event(id, 'status', `${j.status} → ${patch.status}`);
        j.date_out = patch.status === 'Collected' ? (patch.date_out ?? now()) : null;
        delete patch.date_out;
      }
      if (patch.location_id !== undefined && patch.location_id !== j.location_id) {
        event(id, 'location', `${locName(j.location_id)} → ${locName(patch.location_id)}`);
      }
      if (patch.po_number !== undefined && patch.po_number !== j.po_number) {
        event(id, 'po', `PO number ${patch.po_number || 'removed'}`);
      }
      Object.assign(j, patch);
      persistOrWarn();
      return later(undefined);
    },

    async addItem(jobId, item) {
      signedIn();
      const row = addItemRow(jobId, item);
      event(jobId, 'item_added', `Item added: ${row.description}${row.serial_number ? ` (S/N ${row.serial_number})` : ''}`);
      await savePhotos(jobId, item.photos, 'Intake', row.id);
      persistOrWarn();
      return later(0);
    },

    async deleteItem(id) {
      const who = signedIn();
      const it = store.job_items.find((x) => x.id === id);
      if (!it) return later(undefined);
      if (it.added_by !== who.id && !office()) throw new Error('You can only remove items you added. Ask the office.');
      store.job_items = store.job_items.filter((x) => x.id !== id);
      store.job_photos.forEach((p) => { if (p.item_id === id) p.item_id = null; });
      event(it.job_id, 'item_removed', `Item removed: ${it.quantity > 1 ? `${it.quantity} × ` : ''}${it.description}${it.serial_number ? ` (S/N ${it.serial_number})` : ''}`);
      persistOrWarn();
      return later(undefined);
    },

    async addPhotos(jobId, photos, { stage, itemId }) {
      signedIn();
      await savePhotos(jobId, photos, stage, itemId ?? null);
      persistOrWarn();
      return later(0);
    },

    async labour(jobId) {
      return later(store.labour.filter((l) => l.job_id === jobId)
        .sort((a, b) => b.work_date.localeCompare(a.work_date) || b.id - a.id)
        .map((l) => ({ ...l, staff_name: nameOf(l.staff_id) ?? '' })));
    },

    async logHours(e) {
      const who = signedIn();
      if (!(e.hours > 0 && e.hours <= 24)) throw new Error('Hours must be between 0 and 24.');
      const staff_id = office() ? e.staff_id : who.id;
      const rate = (office() && e.labour_rate_id) || store.labour_rates
        .filter((r) => r.stage_id === e.stage_id && r.active).sort((a, b) => Number(b.is_default) - Number(a.is_default))[0]?.id || null;
      if (e.client_ref && store.labour.some((l) => (l as { client_ref?: string }).client_ref === e.client_ref)) return;
      store.labour.push({ ...e, id: store.nextId++, staff_id, labour_rate_id: rate });
      // Logging hours moves the job to that stage.
      const j = store.jobs.find((x) => x.id === e.job_id)!;
      const stage = store.stages.find((s) => s.id === e.stage_id)!.name as Job['status'];
      if (j.status !== stage && j.status !== 'Ready for pickup' && j.status !== 'Collected') {
        event(j.id, 'status', `${j.status} → ${stage}`);
        j.status = stage;
      }
      persistOrWarn();
      return later(undefined);
    },

    async deleteHours(id) {
      const who = signedIn();
      const l = store.labour.find((x) => x.id === id);
      if (l && l.staff_id !== who.id && !office()) throw new Error('You can only remove your own hours.');
      store.labour = store.labour.filter((x) => x.id !== id);
      persistOrWarn();
      return later(undefined);
    },

    async paint(jobId) {
      return later(store.paint.filter((l) => l.job_id === jobId)
        .sort((a, b) => b.used_on.localeCompare(a.used_on) || b.id - a.id)
        .map((l) => ({ ...l, staff_name: nameOf(l.staff_id) ?? '' })));
    },

    async logPaint(e) {
      const who = signedIn();
      if (!(e.litres > 0 && e.litres <= 1000)) throw new Error('Enter the litres used.');
      if (e.client_ref && store.paint.some((l) => (l as { client_ref?: string }).client_ref === e.client_ref)) return;
      store.paint.push({ ...e, id: store.nextId++, staff_id: office() ? e.staff_id : who.id });
      persistOrWarn();
      return later(undefined);
    },

    async qaChecks(jobId) {
      return later(store.qa.filter((q) => q.job_id === jobId).sort((a, b) => b.at.localeCompare(a.at))
        .map(({ by, ...q }) => ({ ...q, by_name: nameOf(by) ?? '' })));
    },

    async recordQa(q) {
      const who = signedIn();
      if (!office() && !who.groups.includes('qa')) throw new Error('Only QA staff can pass or fail a job.');
      const j = store.jobs.find((x) => x.id === q.job_id)!;
      const target = (q.passed ? 'Ready for pickup' : store.stages.find((s) => s.id === q.send_back_stage_id)!.name) as Job['status'];
      store.qa.push({ ...q, id: store.nextId++, by: who.id, at: now() });
      if (j.status !== target) event(j.id, 'status', `${j.status} → ${target}`);
      event(j.id, 'qa', (q.passed ? 'QA passed' : `QA failed, back to ${target}`) + (q.note ? `: ${q.note}` : ''));
      j.status = target;
      j.date_out = null;
      persistOrWarn();
      return later(undefined);
    },

    async jobExtras(jobId) {
      if (!office()) throw new Error('Costs are for Office only.');
      return later(store.job_extras.filter((x) => x.job_id === jobId));
    },

    async addExtra(e) {
      if (!office()) throw new Error('Costs are for Office only.');
      store.job_extras.push({ ...e, id: store.nextId++, added_on: new Date().toLocaleDateString('en-CA') });
      persistOrWarn();
      return later(undefined);
    },

    async deleteExtra(id) {
      if (!office()) throw new Error('Costs are for Office only.');
      store.job_extras = store.job_extras.filter((x) => x.id !== id);
      persistOrWarn();
      return later(undefined);
    },

    async costLines({ jobId, from, to }) {
      if (!office()) throw new Error('Costs are for Office only.');
      const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
      const jobOf = (id: number) => store.jobs.find((j) => j.id === id)!;
      const cust = (id: number) => store.customers.find((c) => c.id === jobOf(id).customer_id)?.name ?? '';
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const lines: CostLine[] = [];
      for (const l of store.labour) {
        if ((jobId && l.job_id !== jobId) || !inRange(l.work_date)) continue;
        const rate = store.labour_rates.find((r) => r.id === l.labour_rate_id);
        const stage = store.stages.find((s) => s.id === l.stage_id)?.name ?? '';
        lines.push({ job_id: l.job_id, job_number: jobOf(l.job_id).job_number, customer: cust(l.job_id), kind: 'Labour',
          name: `${stage}${rate && rate.name !== stage ? ` (${rate.name})` : ''}`, worker: nameOf(l.staff_id), on_date: l.work_date, quantity: l.hours, unit: 'h',
          cost: r2(l.hours * (rate?.cost_per_hour ?? 0)), charge: r2(l.hours * (rate?.charge_per_hour ?? 0)) });
      }
      for (const u of store.paint) {
        if ((jobId && u.job_id !== jobId) || !inRange(u.used_on)) continue;
        const m = store.materials.find((x) => x.id === u.material_id);
        lines.push({ job_id: u.job_id, job_number: jobOf(u.job_id).job_number, customer: cust(u.job_id),
          kind: m?.type === 'primer' ? 'Primer' : 'Topcoat', name: m?.name ?? '', worker: nameOf(u.staff_id), on_date: u.used_on,
          quantity: u.litres, unit: 'L', cost: r2(u.litres * (m?.cost_per_l ?? 0)), charge: r2(u.litres * (m?.charge_per_l ?? 0)) });
      }
      for (const x of store.job_extras) {
        if ((jobId && x.job_id !== jobId) || !inRange(x.added_on)) continue;
        const e = store.extras.find((y) => y.id === x.extra_id);
        lines.push({ job_id: x.job_id, job_number: jobOf(x.job_id).job_number, customer: cust(x.job_id), kind: 'Extra',
          name: e?.name ?? '', worker: null, on_date: x.added_on, quantity: x.quantity, unit: 'each',
          cost: r2(x.quantity * (e?.unit_cost ?? 0)), charge: r2(x.quantity * (e?.unit_charge ?? 0)) });
      }
      return later(lines.sort((a, b) => a.on_date.localeCompare(b.on_date) || a.job_id - b.job_id));
    },

    async deletePaint(id) {
      const who = signedIn();
      const l = store.paint.find((x) => x.id === id);
      if (l && l.staff_id !== who.id && !office()) throw new Error('You can only remove your own entries.');
      store.paint = store.paint.filter((x) => x.id !== id);
      persistOrWarn();
      return later(undefined);
    },
  };
}
