// Supabase Edge Function: Office creates staff sign-ins and resets PINs.
// Deploy: supabase functions deploy admin-users
// Needs the default SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY secrets.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Must match src/lib/auth.ts
const STAFF_EMAIL_DOMAIN = 'staff.rabflow.app';
const emailFor = (mobile: string) => `m${mobile}@${STAFF_EMAIL_DOMAIN}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isOffice, error: roleErr } = await caller.rpc('is_office');
  if (roleErr || !isOffice) return json({ error: 'Only Office staff can manage staff.' }, 403);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json();

  if (!/^[0-9]{6}$/.test(body.pin ?? '')) return json({ error: 'PIN must be 6 digits.' }, 400);

  if (body.action === 'create') {
    const { name, mobile, groups, pin } = body;
    if (!/^0[0-9]{9}$/.test(mobile ?? '')) return json({ error: 'Mobile must be 10 digits starting with 0.' }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email: emailFor(mobile), password: pin, email_confirm: true,
    });
    if (error) return json({ error: error.message }, 400);
    const { error: insErr } = await admin.from('staff').insert({ id: data.user.id, name, mobile, groups });
    if (insErr) {
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: insErr.message }, 400);
    }
    return json({ id: data.user.id });
  }

  if (body.action === 'set_pin') {
    const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.pin });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
