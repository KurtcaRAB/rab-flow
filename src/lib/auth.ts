// Staff sign in with their mobile number and a 6-digit PIN. Supabase Auth
// needs an email, so each mobile maps to a private sign-in address that never
// receives mail. Must match supabase/functions/admin-users and scripts/create-staff.mjs.
export const STAFF_EMAIL_DOMAIN = 'staff.rabflow.app';

/** Turns "0412 345 678" or "+61 412 345 678" into "0412345678", or null if invalid. */
export function normaliseMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length === 11) digits = '0' + digits.slice(2);
  return /^0[0-9]{9}$/.test(digits) ? digits : null;
}

export const emailFor = (mobile: string) => `m${mobile}@${STAFF_EMAIL_DOMAIN}`;

export const isValidPin = (pin: string) => /^[0-9]{6}$/.test(pin);

export function formatMobile(m: string) {
  return m.length === 10 ? `${m.slice(0, 4)} ${m.slice(4, 7)} ${m.slice(7)}` : m;
}
