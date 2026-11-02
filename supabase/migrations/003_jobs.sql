-- RAB Flow, phase 2: job in.
-- Jobs booked in at the gate, their items and photos, and a history of every
-- status and location change. Everyone signed in can book jobs in, add items
-- and photos, and move jobs; only Office can delete.

-- Where a job is. 'Booked in' on arrival, then the stage being worked on,
-- then 'Ready for pickup' (after QA) and 'Collected'.
create table job_statuses (
  name text primary key,
  sort_order int not null,
  is_open boolean not null default true  -- false = no longer in the yard
);
insert into job_statuses (name, sort_order, is_open) values
  ('Booked in', 0, true),
  ('Wash Bay', 1, true),
  ('Blast Room', 2, true),
  ('Handling', 3, true),
  ('Prep', 4, true),
  ('Prime', 5, true),
  ('Paint', 6, true),
  ('QA', 7, true),
  ('Ready for pickup', 8, true),
  ('Collected', 9, false);

create sequence job_number_seq start 1;

create table jobs (
  id bigint generated always as identity primary key,
  job_number text not null unique
    default 'RAB-' || lpad(nextval('job_number_seq')::text, 4, '0'),
  quote_number text not null check (btrim(quote_number) <> ''),
  po_number text,
  customer_id bigint not null references customers (id),
  location_id bigint references yard_locations (id),
  -- The stages this job needs, by stage id. Any stage can be skipped.
  stage_ids bigint[] not null default '{}',
  status text not null default 'Booked in' references job_statuses (name) on update cascade,
  note text,
  date_in timestamptz not null default now(),
  date_out timestamptz,
  created_by uuid references staff (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_status_idx on jobs (status);
create index jobs_customer_idx on jobs (customer_id);

-- One job holds one or more items; more can be added later.
create table job_items (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  description text not null check (btrim(description) <> ''),
  serial_number text,
  quantity int not null default 1 check (quantity > 0),
  note text,
  added_by uuid references staff (id) default auth.uid(),
  added_at timestamptz not null default now()
);
create index job_items_job_idx on job_items (job_id);
create index job_items_serial_idx on job_items (lower(serial_number));

-- Photo files live in the private 'job-photos' storage bucket.
-- `stage` says when it was taken: Intake, a stage name, QA or Out.
create table job_photos (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  item_id bigint references job_items (id) on delete set null,
  path text not null unique,
  stage text not null default 'Intake',
  taken_by uuid references staff (id) default auth.uid(),
  taken_at timestamptz not null default now()
);
create index job_photos_job_idx on job_photos (job_id);

-- Who changed what and when. Written by triggers, never by the app directly.
create table job_events (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  kind text not null,      -- 'booked_in', 'status', 'location', 'item_added', 'po'
  detail text not null,
  by_staff uuid references staff (id) default auth.uid(),
  at timestamptz not null default now()
);
create index job_events_job_idx on job_events (job_id, at);

-- ---------------------------------------------------------------------------
-- History triggers
-- ---------------------------------------------------------------------------
create function log_job_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_loc text;
  new_loc text;
begin
  if tg_op = 'INSERT' then
    insert into job_events (job_id, kind, detail) values (new.id, 'booked_in', 'Booked in');
    return new;
  end if;

  new.updated_at := now();
  -- Releasing a job out of the yard is Office's call.
  if new.status = 'Collected' and old.status <> 'Collected' and not is_office() then
    raise exception 'Only Office can mark a job collected.';
  end if;
  if new.status is distinct from old.status then
    insert into job_events (job_id, kind, detail)
      values (new.id, 'status', old.status || ' → ' || new.status);
    if new.status = 'Collected' and new.date_out is null then
      new.date_out := now();
    elsif new.status <> 'Collected' then
      new.date_out := null;
    end if;
  end if;
  if new.location_id is distinct from old.location_id then
    select name into old_loc from yard_locations where id = old.location_id;
    select name into new_loc from yard_locations where id = new.location_id;
    insert into job_events (job_id, kind, detail)
      values (new.id, 'location', coalesce(old_loc, 'No location') || ' → ' || coalesce(new_loc, 'No location'));
  end if;
  if new.po_number is distinct from old.po_number then
    insert into job_events (job_id, kind, detail)
      values (new.id, 'po', 'PO number ' || coalesce(nullif(new.po_number, ''), 'removed'));
  end if;
  return new;
end $$;

create trigger jobs_insert_history after insert on jobs
  for each row execute function log_job_change();
create trigger jobs_update_history before update on jobs
  for each row execute function log_job_change();

create function log_item_added() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Items saved in the same minute as the job are part of booking in.
  if exists (select 1 from jobs where id = new.job_id and created_at < now() - interval '1 minute') then
    insert into job_events (job_id, kind, detail)
      values (new.job_id, 'item_added', 'Item added: ' || new.description
        || coalesce(' (S/N ' || nullif(new.serial_number, '') || ')', ''));
  end if;
  return new;
end $$;

create trigger job_items_history after insert on job_items
  for each row execute function log_item_added();

revoke execute on function public.log_job_change() from public, anon, authenticated;
revoke execute on function public.log_item_added() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table job_statuses enable row level security;
alter table jobs enable row level security;
alter table job_items enable row level security;
alter table job_photos enable row level security;
alter table job_events enable row level security;

create policy job_statuses_read on job_statuses for select using (is_staff());

-- Everyone on staff books jobs in, adds items and photos and moves jobs.
create policy jobs_read on jobs for select using (is_staff());
create policy jobs_insert on jobs for insert with check (is_staff());
create policy jobs_update on jobs for update using (is_staff()) with check (is_staff());
create policy jobs_office_delete on jobs for delete using (is_office());

create policy job_items_read on job_items for select using (is_staff());
create policy job_items_insert on job_items for insert with check (is_staff());
create policy job_items_update on job_items for update using (is_staff()) with check (is_staff());
create policy job_items_office_delete on job_items for delete using (is_office());

create policy job_photos_read on job_photos for select using (is_staff());
create policy job_photos_insert on job_photos for insert with check (is_staff());
create policy job_photos_office_delete on job_photos for delete using (is_office());

create policy job_events_read on job_events for select using (is_staff());

-- Photo files. Readable and addable by all staff; Office can delete.
insert into storage.buckets (id, name, public) values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

create policy job_photos_files_read on storage.objects for select
  using (bucket_id = 'job-photos' and is_staff());
create policy job_photos_files_insert on storage.objects for insert
  with check (bucket_id = 'job-photos' and is_staff());
create policy job_photos_files_office_delete on storage.objects for delete
  using (bucket_id = 'job-photos' and is_office());
