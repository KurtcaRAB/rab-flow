# RAB Flow

Job tracking for the Rocklea Abrasive Blasting yard. Phase 1 (foundations): mobile number + PIN sign-in, staff groups, and Settings for customers, yard locations, materials (with data sheets), labour rates, extras and staff. Costs and charge-out rates are visible to Office only, enforced in the database.

## Run the preview (no setup)

```
npm install
npm run build:preview   # dist-preview/index.html, runs on demo data in the browser
```

Demo sign-in: Kurt is 0400 000 001, PIN 123456 (all demo PINs are 123456).

## Go live (one-off setup, about 20 minutes)

1. Create a free Supabase project at supabase.com (region: Sydney).
2. In the SQL editor, run `supabase/migrations/001_foundations.sql`, then `supabase/seed.sql`.
3. Authentication > Providers > Email: turn off "Confirm email". Authentication > Settings: minimum password length 6.
4. Deploy the staff function: `supabase functions deploy admin-users`.
5. Copy `supabase/staff.example.csv` to `supabase/staff.csv` (kept out of git) with each person's name, groups and mobile, then run
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-staff.mjs`.
   It prints a starting PIN for each person. Office can change PINs later in Settings > Staff.
6. Copy `.env.example` to `.env` with the project URL and anon key, then `npm run build` and host `dist/` (Vercel or Netlify).

Never put the service role key in `.env` or in the app; it is only for step 5.

## How it fits together

- `supabase/migrations/` database tables and security rules. Money lives in `material_prices`, `labour_rates` and `extras`, which only Office can read.
- `supabase/functions/admin-users` lets Office create sign-ins and reset PINs.
- `scripts/build_seed.py` rebuilds `supabase/seed.sql`, `supabase/staff.csv` and `src/demo-seed.json` from the master spreadsheet and the data sheet register.
- `src/lib/api.ts` picks the live Supabase data layer or the demo one.

Sign-in detail: Supabase Auth needs an email, so each mobile maps to a private address `m<mobile>@staff.rabflow.app` that never receives mail, and the PIN is the password.

## Coming next

Phase 2 job booking (photos, items, quote/PO, yard board), phase 3 labour hours, phase 4 paint usage and offline saving, phase 5 QA, job out and reports. Xero after that.
