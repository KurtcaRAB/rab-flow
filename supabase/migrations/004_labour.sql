-- RAB Flow, phase 3: labour hours.
-- Workers log hours against a job and stage. Logging hours moves the job to
-- that stage. Which hourly rate applies is stored with the entry, but rates
-- themselves stay Office only (see labour_rates), so only Office sees money.

create table labour_entries (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  stage_id bigint not null references stages (id),
  staff_id uuid not null references staff (id) default auth.uid(),
  work_date date not null default current_date,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  -- Filled with the stage's default rate when left empty. Office can change it.
  labour_rate_id bigint references labour_rates (id),
  note text,
  created_by uuid references staff (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index labour_entries_job_idx on labour_entries (job_id);
create index labour_entries_staff_date_idx on labour_entries (staff_id, work_date);

create function labour_entry_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only Office may log hours for someone else or choose the rate.
  if not is_office() then
    new.staff_id := auth.uid();
    if tg_op = 'INSERT' then
      new.labour_rate_id := null;
    else
      new.labour_rate_id := old.labour_rate_id;
    end if;
  end if;
  if new.labour_rate_id is null or (tg_op = 'UPDATE' and new.stage_id <> old.stage_id and new.labour_rate_id = old.labour_rate_id) then
    select id into new.labour_rate_id from labour_rates
      where stage_id = new.stage_id and active order by is_default desc, id limit 1;
  end if;
  return new;
end $$;

create trigger labour_entries_defaults before insert or update on labour_entries
  for each row execute function labour_entry_defaults();

-- Logging hours on a stage moves the job to that stage (unless it is already
-- through QA), which also writes the job's history.
create function labour_moves_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  stage_name text;
begin
  select name into stage_name from stages where id = new.stage_id;
  update jobs set status = stage_name
    where id = new.job_id and status <> stage_name and status not in ('Ready for pickup', 'Collected');
  return new;
end $$;

create trigger labour_entries_move_job after insert on labour_entries
  for each row execute function labour_moves_job();

revoke execute on function public.labour_entry_defaults() from public, anon, authenticated;
revoke execute on function public.labour_moves_job() from public, anon, authenticated;

alter table labour_entries enable row level security;

create policy labour_read on labour_entries for select using (is_staff());
create policy labour_insert on labour_entries for insert
  with check (is_staff() and (staff_id = auth.uid() or is_office()));
create policy labour_update on labour_entries for update
  using (staff_id = auth.uid() or is_office()) with check (is_staff() and (staff_id = auth.uid() or is_office()));
create policy labour_delete on labour_entries for delete
  using (staff_id = auth.uid() or is_office());
