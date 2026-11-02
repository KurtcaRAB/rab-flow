import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { emailFor, normaliseMobile } from './auth';
import type { Api, Material, Stage, Staff, TableName, Tables } from './types';

export function supabaseApi(url: string, anonKey: string): Api {
  const db: SupabaseClient = createClient(url, anonKey);
  let me: Staff | null = null;

  async function loadMe(): Promise<Staff | null> {
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return null;
    const { data, error } = await db.from('staff').select('*').eq('id', auth.user.id).single();
    if (error || !data?.active) {
      await db.auth.signOut();
      return null;
    }
    me = data as Staff;
    return me;
  }

  const isOffice = () => !!me?.groups.includes('office');

  function check<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new Error(res.error.message);
    return res.data;
  }

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
  };
}
