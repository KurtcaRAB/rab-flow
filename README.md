# RAB Flow

Job tracking for the Rocklea Abrasive Blasting yard.

- Phase 1 (foundations): mobile number + PIN sign-in, staff groups, and Settings for customers, yard locations, materials (with data sheets), labour rates, extras and staff. Costs and charge-out rates are visible to Office only, enforced in the database.
- Phase 2 (job in): book a job in at the gate with photos, quote number, optional PO, customer, yard location, one or more items (serial number, qty, note, photo) and the stages it needs. Yard board with search (job, serial, quote, PO, customer) and filters. Job detail with Move stage, location, Add item, photos by stage and a history of every change.
- Phase 3 (labour hours): Log hours on a job by stage (quick picks 0.5 to 8 h), totals per stage and per job. Logging hours moves the job to that stage. Workers log and remove their own hours; Office can log for anyone and pick a non-default rate. Rates stay Office only.
- Phase 4 (paint and weak signal): Log paint on a job (Primer or Topcoat, product, litres with quick picks, with the SDS one tap away), totals per product. Hours and paint saved with no signal are kept on the phone and sent automatically when signal returns (never saved twice). The app itself is kept on the phone so it opens without signal.

## Run the preview (no setup)

```
npm install
npm run build:preview   # dist-preview/index.html, runs on demo data in the browser
```

Demo sign-in: Kurt is 0400 000 001, PIN 123456 (all demo PINs are 123456).

## Go live (one-off setup, about 20 minutes)

1. Create a free Supabase project at supabase.com (region: Sydney).
2. In the SQL editor, run each file in `supabase/migrations/` in number order, then `supabase/seed.sql`.
3. Authentication > Providers > Email: turn off "Confirm email". Authentication > Settings: minimum password length 6.
4. Deploy the staff function: `supabase functions deploy admin-users`.
5. Copy `supabase/staff.example.csv` to `supabase/staff.csv` (kept out of git) with each person's name, groups and mobile, then run
   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-staff.mjs`.
   It prints a starting PIN for each person. Office can change PINs later in Settings > Staff.
6. Copy `.env.example` to `.env` with the project URL and anon key, then `npm run build` and host `dist/` (Vercel or Netlify).

Never put the service role key in `.env` or in the app; it is only for step 5.

## How it fits together

- `supabase/migrations/` database tables and security rules. Money lives in `material_prices`, `labour_rates` and `extras`, which only Office can read. Jobs live in `jobs`, `job_items`, `job_photos` (files in the private `job-photos` bucket) and `job_events` (history, written by triggers).
- `supabase/functions/admin-users` lets Office create sign-ins and reset PINs.
- `scripts/build_seed.py` rebuilds `supabase/seed.sql`, `supabase/staff.csv` and `src/demo-seed.json` from the master spreadsheet and the data sheet register.
- `src/lib/api.ts` picks the live Supabase data layer or the demo one.

Sign-in detail: Supabase Auth needs an email, so each mobile maps to a private address `m<mobile>@staff.rabflow.app` that never receives mail, and the PIN is the password.

## Coming next

Phase 5 QA, job out and reports. Xero after that.
