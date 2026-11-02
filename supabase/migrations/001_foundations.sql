-- RAB Flow, phase 1: foundations.
-- Staff, groups, reference lists and office-only prices.
-- Run in Supabase: SQL editor, or `supabase db push`.

-- ---------------------------------------------------------------------------
-- Staff and groups
-- ---------------------------------------------------------------------------
create type staff_group as enum ('office', 'yard', 'blaster', 'painter', 'qa');

-- One row per person. The id is their Supabase Auth user id.
-- They sign in with their mobile number and a 6-digit PIN (see README).
create table staff (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  mobile text not null unique check (mobile ~ '^0[0-9]{9}$'),
  groups staff_group[] not null default '{}' check (cardinality(groups) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Helpers used by the security policies below. SECURITY DEFINER so they can
-- read `staff` without tripping over staff's own policies.
create function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$;

create function is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff where id = auth.uid() and active and 'office' = any (groups)
  );
$$;

-- ---------------------------------------------------------------------------
-- Reference lists (everyone signed in can read; Office edits)
-- ---------------------------------------------------------------------------
create table customers (
  id bigint generated always as identity primary key,
  name text not null unique,
  contact_name text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table yard_locations (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order int not null default 0,
  active boolean not null default true
);

-- The work stages a job can pass through. Jobs pick the ones they need.
create table stages (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order int not null
);

create type material_type as enum ('primer', 'topcoat');

create table materials (
  id bigint generated always as identity primary key,
  name text not null unique,
  type material_type not null,
  manufacturer text,
  sds_url text,          -- safety data sheet
  pds_url text,          -- product / technical data sheet
  sds_status text,       -- e.g. 'Found', 'Check variant', 'Not found'
  notes text,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Office-only money tables. Kept separate so non-office staff can never read
-- a cost or a charge-out rate, even through the API.
-- ---------------------------------------------------------------------------
create table material_prices (
  material_id bigint primary key references materials (id) on delete cascade,
  cost_per_l numeric(10, 2) not null default 0,
  charge_per_l numeric(10, 2) not null default 0
);

-- Hourly labour rates. Each rate belongs to a stage; a stage can have more
-- than one (e.g. Blast and Blasters (2) both belong to Blast Room).
create table labour_rates (
  id bigint generated always as identity primary key,
  name text not null unique,
  stage_id bigint not null references stages (id),
  cost_per_hour numeric(10, 2) not null default 0,
  charge_per_hour numeric(10, 2) not null default 0,
  is_default boolean not null default false,
  active boolean not null default true
);

-- Flat charges added to a job with a quantity (2 x Transport = charged twice).
create table extras (
  id bigint generated always as identity primary key,
  name text not null unique,
  unit_cost numeric(10, 2) not null default 0,
  unit_charge numeric(10, 2) not null default 0,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table staff enable row level security;
alter table customers enable row level security;
alter table yard_locations enable row level security;
alter table stages enable row level security;
alter table materials enable row level security;
alter table material_prices enable row level security;
alter table labour_rates enable row level security;
alter table extras enable row level security;

-- Staff: everyone can see who works here; only Office changes records.
-- New staff are created by the `admin-users` edge function (it needs to
-- create the sign-in too), which runs with the service role.
create policy staff_read on staff for select using (is_staff());
create policy staff_office_update on staff for update using (is_office()) with check (is_office());

-- Reference lists: read for staff, write for Office.
do $$
declare t text;
begin
  foreach t in array array['customers', 'yard_locations', 'stages', 'materials'] loop
    execute format('create policy %1$s_read on %1$s for select using (is_staff())', t);
    execute format('create policy %1$s_office_insert on %1$s for insert with check (is_office())', t);
    execute format('create policy %1$s_office_update on %1$s for update using (is_office()) with check (is_office())', t);
    execute format('create policy %1$s_office_delete on %1$s for delete using (is_office())', t);
  end loop;

  -- Money tables: Office only, for every operation.
  foreach t in array array['material_prices', 'labour_rates', 'extras'] loop
    execute format('create policy %1$s_office_all on %1$s for all using (is_office()) with check (is_office())', t);
  end loop;
end $$;

-- Data sheet PDFs uploaded by Office. Readable by all staff.
insert into storage.buckets (id, name, public) values ('data-sheets', 'data-sheets', false)
on conflict (id) do nothing;

create policy data_sheets_read on storage.objects for select
  using (bucket_id = 'data-sheets' and is_staff());
create policy data_sheets_office_write on storage.objects for insert
  with check (bucket_id = 'data-sheets' and is_office());
create policy data_sheets_office_update on storage.objects for update
  using (bucket_id = 'data-sheets' and is_office());
create policy data_sheets_office_delete on storage.objects for delete
  using (bucket_id = 'data-sheets' and is_office());
