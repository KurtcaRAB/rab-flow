-- RAB Flow, pilot fixes (Nov 2026).
-- 1. Job numbers are made by the database: YYMMDD + a 3-digit count for that
--    day, in Brisbane time. The 4th job booked in on 4 Nov 2026 is 261104004.
--    The old "quote number" is no longer asked for.
-- 2. Items can be removed from a job, and the removal is kept in the history.

-- ---------------------------------------------------------------------------
-- 1. Job numbers
-- ---------------------------------------------------------------------------

-- How many jobs have been numbered on each Brisbane day.
create table job_number_days (
  day date primary key,
  last_number int not null
);
alter table job_number_days enable row level security;
-- No policies: only the numbering trigger (security definer) touches it.

create function set_job_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Australia/Brisbane')::date;
  n int;
begin
  -- One row per day; the upsert locks it, so two phones booking at the
  -- same moment still get different numbers.
  insert into job_number_days (day, last_number) values (today, 1)
    on conflict (day) do update set last_number = job_number_days.last_number + 1
    returning last_number into n;
  new.job_number := to_char(today, 'YYMMDD') || lpad(n::text, 3, '0');
  return new;
end $$;
revoke execute on function public.set_job_number() from public, anon, authenticated;

alter table jobs alter column job_number drop default;
drop sequence if exists job_number_seq;

create trigger jobs_set_number before insert on jobs
  for each row execute function set_job_number();

-- The number can't be changed by hand afterwards.
create function keep_job_number() returns trigger
language plpgsql set search_path = public as $$
begin
  new.job_number := old.job_number;
  return new;
end $$;
revoke execute on function public.keep_job_number() from public, anon, authenticated;
create trigger jobs_keep_number before update of job_number on jobs
  for each row execute function keep_job_number();

-- Quote number is no longer used. Old values stay in the table, unused.
alter table jobs alter column quote_number drop not null;
alter table jobs drop constraint if exists jobs_quote_number_check;

-- Renumber the jobs already booked in (RAB-0001 ...) by the day they came in,
-- in the order they came in, and note the change in each job's history.
alter table jobs disable trigger jobs_keep_number;
alter table jobs disable trigger jobs_update_history;
with numbered as (
  select id, job_number as old_number,
         to_char((date_in at time zone 'Australia/Brisbane')::date, 'YYMMDD')
           || lpad(row_number() over (
                partition by (date_in at time zone 'Australia/Brisbane')::date
                order by date_in, id)::text, 3, '0') as new_number
  from jobs
), changed as (
  update jobs j set job_number = n.new_number
  from numbered n
  where j.id = n.id and j.job_number <> n.new_number
  returning j.id, n.old_number, n.new_number
)
insert into job_events (job_id, kind, detail, by_staff)
select id, 'job_number', 'Job number ' || old_number || ' → ' || new_number, null from changed;
alter table jobs enable trigger jobs_update_history;
alter table jobs enable trigger jobs_keep_number;

-- Carry on each day's count from the jobs already there.
insert into job_number_days (day, last_number)
select (date_in at time zone 'Australia/Brisbane')::date, count(*)
from jobs group by 1
on conflict (day) do update set last_number = greatest(job_number_days.last_number, excluded.last_number);

-- ---------------------------------------------------------------------------
-- 2. Removing items
-- ---------------------------------------------------------------------------

-- Office can remove any item; anyone else can remove items they added.
-- Photos of a removed item stay on the job (job_photos.item_id is set null).
drop policy if exists job_items_office_delete on job_items;
create policy job_items_delete on job_items for delete
  using (is_office() or (is_staff() and added_by = auth.uid()));

create function log_item_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Skip when the whole job is being deleted.
  if exists (select 1 from jobs where id = old.job_id) then
    insert into job_events (job_id, kind, detail)
      values (old.job_id, 'item_removed', 'Item removed: '
        || case when old.quantity > 1 then old.quantity || ' × ' else '' end || old.description
        || coalesce(' (S/N ' || nullif(old.serial_number, '') || ')', ''));
  end if;
  return old;
end $$;
revoke execute on function public.log_item_removed() from public, anon, authenticated;

create trigger job_items_removed_history after delete on job_items
  for each row execute function log_item_removed();
