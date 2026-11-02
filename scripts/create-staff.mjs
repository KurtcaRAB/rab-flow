// One-off: create sign-ins for everyone in supabase/staff.csv.
// Fill in the mobile column first, then run:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-staff.mjs
// Prints a random 6-digit starting PIN for each person. Hand them out, then
// people can be given new PINs from Settings > Staff.
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const STAFF_EMAIL_DOMAIN = 'staff.rabflow.app'; // must match src/lib/auth.ts
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const lines = readFileSync(new URL('../supabase/staff.csv', import.meta.url), 'utf8').trim().split('\n').slice(1);
for (const line of lines) {
  const [name, groups, rawMobile = ''] = line.split(',');
  const mobile = rawMobile.replace(/\D/g, '').replace(/^61/, '0');
  if (!/^0[0-9]{9}$/.test(mobile)) { console.log(`SKIP ${name}: no valid mobile`); continue; }
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { data, error } = await admin.auth.admin.createUser({
    email: `m${mobile}@${STAFF_EMAIL_DOMAIN}`, password: pin, email_confirm: true,
  });
  if (error) { console.log(`FAIL ${name}: ${error.message}`); continue; }
  const { error: e2 } = await admin.from('staff').insert({ id: data.user.id, name, mobile, groups: groups.split(' ') });
  if (e2) { console.log(`FAIL ${name}: ${e2.message}`); await admin.auth.admin.deleteUser(data.user.id); continue; }
  console.log(`OK   ${name.padEnd(10)} ${mobile}  PIN ${pin}`);
}
