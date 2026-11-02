import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emailFor, normaliseMobile } from './auth';
import { NO_SIGNAL, isNetworkError, newId } from './net';
import type {
  Api, CostLine, Job, JobCard, JobExtra, LabourEntry, PaintEntry, QaCheck, JobDetail, JobEvent, JobItem, JobPhoto, Material, PhotoStage, Stage, Staff, TableName, Tables,
} from './types';

const PHOTO_BUCKET = 'job-photos';

type JobRow = Job & {
  customers: { name: string } | null;
  yard_locations: { name: string } | null;
  job_items: JobItem[];
  job_photos: { id: number; item_id: number | null; path: string; stage: PhotoStage; taken_by: string | null; taken_at: string }[];
};

export function supabaseApi(url: string, anonKey: string): Api {
  const db: SupabaseClient = createClient(url, anonKey);
  let me: Staff | null = null;

  const ME_KEY = 'rabflow-me';

  async function loadMe(): Promise<Staff | null> {
    // The session is kept on the device, so this works without signal.
    const { data: { session } } = await db.auth.getSession();
    if (!session) return null;
    const { data, error } = await db.from('staff').select('*').eq('id', session.user.id).maybeSingle();
    if (error && isNetworkError(error.message)) {
      // No signal: carry on as the person last signed in on this device.
      try {
        const cached = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as Staff | null;
        if (cached?.id === session.user.id) return (me = cached);
      } catch { /* fall through */ }
      return null;
    }
    if (error || !data?.active) {
      await db.auth.signOut();
      return null;
    }
    me = data as Staff;
    try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch { /* ignore */ }
    return me;
  }

  const isOffice = () => !!me?.groups.includes('office');

  function check<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new Error(isNetworkError(res.error.message) ? NO_SIGNAL : res.error.message);
    return res.data;
  }

  /** Insert that treats "already saved" (same client_ref, e.g. a retry after lost signal) as done. */
  async function insertOnce(table: string, row: object) {
    const { error } = await db.from(table).insert(row);
    if (error && error.code !== '23505') check({ data: null, error });
  }

  /** Signed links for private photos, valid for a few hours. */
  async function signed(paths: string[]): Promise<Map<string, string>> {
    if (paths.length === 0) return new Map();
    const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60 * 6);
    if (error) throw new Error(error.message);
    return new Map((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path!, d.signedUrl]));
  }

  const byTime = <T extends { taken_at: string }>(a: T, b: T) => a.taken_at.localeCompare(b.taken_at);
  const cover = (r: JobRow) => [...r.job_photos].sort((a, b) =>
    (a.stage === 'Intake' ? 0 : 1) - (b.stage === 'Intake' ? 0 : 1) || byTime(a, b))[0]?.path ?? null;

  function toCard(r: JobRow, urls: Map<string, string>): JobCard {
    const { customers, yard_locations, job_items, job_photos: _p, ...job } = r;
    const c = cover(r);
    return {
      ...job,
      customer_name: customers?.name ?? '',
      location_name: yard_locations?.name ?? null,
      items: [...job_items].sort((a, b) => a.added_at.localeCompare(b.added_at))
        .map(({ description, serial_number, quantity }) => ({ description, serial_number, quantity })),
      cover_url: c ? urls.get(c) ?? null : null,
    };
  }

  async function uploadPhotos(jobId: number, photos: Blob[], stage: PhotoStage, itemId: number | null) {
    let failed = 0;
    for (const p of photos) {
      const path = `${jobId}/${newId()}.jpg`;
      const up = await db.storage.from(PHOTO_BUCKET).upload(path, p, { contentType: p.type || 'image/jpeg' });
      if (up.error) { failed++; continue; }
      const { error } = await db.from('job_photos').insert({ job_id: jobId, item_id: itemId, path, stage });
      if (error) failed++;
    }
    return failed;
  }

  const JOB_SELECT = '*, customers(name), yard_locations(name), job_items(*), job_photos(id, item_id, path, stage, taken_by, taken_at)';

  return {
    mode: 'live',
    restore: loadMe,

    async signIn(mobileInput, pin) {
      const mobile = normaliseMobile(mobileInput);
      if (!mobile) throw new Error('Enter a 10-digit mobile number.');
      const { error } = await db.auth.signInWithPassword({ email: emailFor(mobile), password: pin });
      if (error) throw new Error('Mobile number or PIN is wrong.');
      const s = await loadMe();
      if (!s) throw new Error('This sign-in is not active. Ask the office.');
      return s;
    },

    async signOut() {
      me = null;
      try { localStorage.removeItem(ME_KEY); } catch { /* ignore */ }
      await db.auth.signOut();
    },

    async stages() {
      return check(await db.from('stages').select('*').order('sort_order')) as Stage[];
    },

    async list<K extends TableName>(table: K): Promise<Tables[K][]> {
      if (table === 'materials') {
        const mats = check(await db.from('materials').select('*').order('type').order('name')) as Material[];
        if (!isOffice()) return mats as Tables[K][];
        const prices = check(await db.from('material_prices').select('*')) as
          { material_id: number; cost_per_l: number; charge_per_l: number }[];
        const byId = new Map(prices.map((p) => [p.material_id, p]));
        return mats.map((m) => ({
          ...m,
          cost_per_l: Number(byId.get(m.id!)?.cost_per_l ?? 0),
          charge_per_l: Number(byId.get(m.id!)?.charge_per_l ?? 0),
        })) as Tables[K][];
      }
      const order = table === 'yard_locations' ? 'sort_order' : 'name';
      return check(await db.from(table).select('*').order(order)) as Tables[K][];
    },

    async save<K extends TableName>(table: K, row: Tables[K]) {
      if (table === 'materials') {
        const { cost_per_l, charge_per_l, id, ...mat } = row as Material;
        const saved = check(
          id
            ? await db.from('materials').update(mat).eq('id', id).select('id').single()
            : await db.from('materials').insert(mat).select('id').single(),
        ) as { id: number };
        check(await db.from('material_prices').upsert({
          material_id: saved.id, cost_per_l: cost_per_l ?? 0, charge_per_l: charge_per_l ?? 0,
        }));
        return;
      }
      const { id, ...rest } = row as Tables[K] & { id?: number };
      check(id ? await db.from(table).update(rest).eq('id', id) : await db.from(table).insert(rest));
    },

    async staff() {
      return check(await db.from('staff').select('*').order('name')) as Staff[];
    },

    async createStaff(s) {
      const { data, error } = await db.functions.invoke('admin-users', { body: { action: 'create', ...s } });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
    },

    async updateStaff({ id, name, mobile, groups, active }) {
      check(await db.from('staff').update({ name, mobile, groups, active }).eq('id', id));
    },

    async setPin(id, pin) {
      const { data, error } = await db.functions.invoke('admin-users', { body: { action: 'set_pin', id, pin } });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
    },

    async jobs({ includeCollected }) {
      let q = db.from('jobs').select(JOB_SELECT).order('date_in', { ascending: false });
      if (!includeCollected) q = q.neq('status', 'Collected');
      const rows = check(await q) as unknown as JobRow[];
      const urls = await signed(rows.map(cover).filter((p): p is string => !!p));
      return rows.map((r) => toCard(r, urls));
    },

    async job(id) {
      const r = check(await db.from('jobs').select(JOB_SELECT).eq('id', id).single()) as unknown as JobRow;
      const [events, people, urls] = await Promise.all([
        db.from('job_events').select('id, kind, detail, by_staff, at').eq('job_id', id).order('at', { ascending: false }),
        db.from('staff').select('id, name'),
        signed(r.job_photos.map((p) => p.path)),
      ]);
      const names = new Map((check(people) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
      const card = toCard(r, urls);
      return {
        ...card,
        created_by_name: r.created_by ? names.get(r.created_by) ?? null : null,
        item_rows: [...r.job_items].sort((a, b) => a.added_at.localeCompare(b.added_at)),
        photos: [...r.job_photos].sort(byTime).map(({ path, ...p }) => ({ ...p, job_id: id, url: urls.get(path) ?? '' }) as JobPhoto),
        events: (check(events) as { id: number; kind: string; detail: string; by_staff: string | null; at: string }[])
          .map((e): JobEvent => ({ id: e.id, kind: e.kind, detail: e.detail, at: e.at, by_name: e.by_staff ? names.get(e.by_staff) ?? null : null })),
      } satisfies JobDetail;
    },

    async createJob({ photos, items, ...job }) {
      const { id } = check(await db.from('jobs').insert(job).select('id').single()) as { id: number };
      let photoErrors = await uploadPhotos(id, photos, 'Intake', null);
      for (const { photos: itemPhotos, ...item } of items) {
        const saved = check(await db.from('job_items').insert({ ...item, job_id: id }).select('id').single()) as { id: number };
        photoErrors += await uploadPhotos(id, itemPhotos, 'Intake', saved.id);
      }
      return { id, photoErrors };
    },

    async updateJob(id, patch) {
      check(await db.from('jobs').update(patch).eq('id', id));
    },

    async addItem(jobId, { photos, ...item }) {
      const saved = check(await db.from('job_items').insert({ ...item, job_id: jobId }).select('id').single()) as { id: number };
      return uploadPhotos(jobId, photos, 'Intake', saved.id);
    },

    async addPhotos(jobId, photos, { stage, itemId }) {
      return uploadPhotos(jobId, photos, stage, itemId ?? null);
    },

    async labour(jobId) {
      const rows = check(await db.from('labour_entries').select('*, staff:staff_id(name)')
        .eq('job_id', jobId).order('work_date', { ascending: false }).order('created_at', { ascending: false })) as
        (LabourEntry & { staff: { name: string } | null })[];
      return rows.map(({ staff, ...r }) => ({ ...r, hours: Number(r.hours), staff_name: staff?.name ?? '' }));
    },

    async logHours(e) {
      await insertOnce('labour_entries', isOffice() ? e : { ...e, labour_rate_id: undefined });
    },

    async deleteHours(id) {
      check(await db.from('labour_entries').delete().eq('id', id));
    },

    async paint(jobId) {
      const rows = check(await db.from('material_usage').select('*, staff:staff_id(name)')
        .eq('job_id', jobId).order('used_on', { ascending: false }).order('created_at', { ascending: false })) as
        (PaintEntry & { staff: { name: string } | null })[];
      return rows.map(({ staff, ...r }) => ({ ...r, litres: Number(r.litres), staff_name: staff?.name ?? '' }));
    },

    async logPaint(e) {
      await insertOnce('material_usage', e);
    },

    async deletePaint(id) {
      check(await db.from('material_usage').delete().eq('id', id));
    },

    async qaChecks(jobId) {
      const rows = check(await db.from('qa_checks').select('*, staff:by_staff(name)').eq('job_id', jobId)
        .order('at', { ascending: false })) as (QaCheck & { staff: { name: string } | null })[];
      return rows.map(({ staff, ...r }) => ({ ...r, by_name: staff?.name ?? '' }));
    },

    async recordQa(q) {
      check(await db.from('qa_checks').insert(q));
    },

    async jobExtras(jobId) {
      const rows = check(await db.from('job_extras').select('id, job_id, extra_id, quantity, note, added_on')
        .eq('job_id', jobId).order('id')) as JobExtra[];
      return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
    },

    async addExtra(e) {
      check(await db.from('job_extras').insert(e));
    },

    async deleteExtra(id) {
      check(await db.from('job_extras').delete().eq('id', id));
    },

    async costLines({ jobId, from, to }) {
      const rows = check(await db.rpc('cost_lines', { p_job_id: jobId ?? null, p_from: from ?? null, p_to: to ?? null })) as CostLine[];
      return rows.map((r) => ({ ...r, quantity: Number(r.quantity), cost: Number(r.cost), charge: Number(r.charge) }));
    },
  };
}
