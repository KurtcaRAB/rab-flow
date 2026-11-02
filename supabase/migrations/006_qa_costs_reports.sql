-- RAB Flow, phase 5: QA, job out, Office-only costs and reports.

create function is_qa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff where id = auth.uid() and active and 'qa' = any (groups)
  );
$$;
revoke execute on function public.is_qa() from public, anon;
grant execute on function public.is_qa() to authenticated;

-- ---------------------------------------------------------------------------
-- QA checks. A pass makes the job Ready for pickup; a fail sends it back to
-- the stage that needs rework. Only QA staff (Dave, Woody) and Office.
-- ---------------------------------------------------------------------------
create table qa_checks (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  passed boolean not null,
  send_back_stage_id bigint references stages (id),
  note text,
  by_staff uuid not null references staff (id) default auth.uid(),
  at timestamptz not null default now(),
  check (passed or send_back_stage_id is not null)
);
create index qa_checks_job_idx on qa_checks (job_id, at);

create function qa_moves_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target text;
begin
  new.by_staff := auth.uid();
  if new.passed then
    target := 'Ready for pickup';
  else
    select name into target from stages where id = new.send_back_stage_id;
  end if;
  -- Lets the jobs trigger know this move comes from a QA check.
  perform set_config('rabflow.qa_move', '1', true);
  update jobs set status = target where id = new.job_id;
  perform set_config('rabflow.qa_move', '', true);
  insert into job_events (job_id, kind, detail)
    values (new.job_id, 'qa', case when new.passed then 'QA passed' else 'QA failed, back to ' || target end
      || coalesce(': ' || nullif(new.note, ''), ''));
  return new;
end $$;

create trigger qa_checks_move_job before insert on qa_checks
  for each row execute function qa_moves_job();
revoke execute on function public.qa_moves_job() from public, anon, authenticated;

alter table qa_checks enable row level security;
create policy qa_read on qa_checks for select using (is_staff());
create policy qa_insert on qa_checks for insert with check (is_qa() or is_office());

-- A job only reaches Ready for pickup through a QA pass (Office can override),
-- and only Office marks it Collected. Replaces the phase 2 version.
create or replace function log_job_change() returns trigger
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
  if new.status = 'Collected' and old.status <> 'Collected' and not is_office() then
    raise exception 'Only Office can mark a job collected.';
  end if;
  if new.status = 'Ready for pickup' and old.status <> 'Ready for pickup'
     and not is_office() and coalesce(current_setting('rabflow.qa_move', true), '') <> '1' then
    raise exception 'A job is ready for pickup once it passes QA.';
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

-- ---------------------------------------------------------------------------
-- Extras on a job (Transport, NDT, Sticker kit…): flat charge x quantity.
-- Office only.
-- ---------------------------------------------------------------------------
create table job_extras (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  extra_id bigint not null references extras (id),
  quantity numeric(8, 2) not null default 1 check (quantity > 0),
  note text,
  added_on date not null default current_date,
  added_by uuid references staff (id) default auth.uid()
);
create index job_extras_job_idx on job_extras (job_id);
alter table job_extras enable row level security;
create policy job_extras_office_all on job_extras for all using (is_office()) with check (is_office());

-- ---------------------------------------------------------------------------
-- Money lines. One row per labour entry, paint entry and extra, with cost
-- and charge worked out from today's rates and prices. Office only: the
-- function refuses everyone else, so nobody else can see a dollar figure.
-- ---------------------------------------------------------------------------
create function cost_lines(p_job_id bigint default null, p_from date default null, p_to date default null)
returns table (
  job_id bigint, job_number text, customer text, kind text, name text, worker text,
  on_date date, quantity numeric, unit text, cost numeric, charge numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_office() then
    raise exception 'Costs are for Office only.';
  end if;
  return query
  select j.id, j.job_number, c.name, 'Labour'::text, s.name || coalesce(' (' || nullif(r.name, s.name) || ')', ''), st.name,
         l.work_date, l.hours, 'h'::text,
         round(l.hours * coalesce(r.cost_per_hour, 0), 2), round(l.hours * coalesce(r.charge_per_hour, 0), 2)
    from labour_entries l
    join jobs j on j.id = l.job_id join customers c on c.id = j.customer_id
    join stages s on s.id = l.stage_id join staff st on st.id = l.staff_id
    left join labour_rates r on r.id = l.labour_rate_id
   where (p_job_id is null or l.job_id = p_job_id)
     and (p_from is null or l.work_date >= p_from) and (p_to is null or l.work_date <= p_to)
  union all
  select j.id, j.job_number, c.name, case m.type when 'primer' then 'Primer' else 'Topcoat' end, m.name, st.name,
         u.used_on, u.litres, 'L'::text,
         round(u.litres * coalesce(p.cost_per_l, 0), 2), round(u.litres * coalesce(p.charge_per_l, 0), 2)
    from material_usage u
    join jobs j on j.id = u.job_id join customers c on c.id = j.customer_id
    join materials m on m.id = u.material_id join staff st on st.id = u.staff_id
    left join material_prices p on p.material_id = u.material_id
   where (p_job_id is null or u.job_id = p_job_id)
     and (p_from is null or u.used_on >= p_from) and (p_to is null or u.used_on <= p_to)
  union all
  select j.id, j.job_number, c.name, 'Extra'::text, e.name, null::text,
         x.added_on, x.quantity, 'each'::text,
         round(x.quantity * e.unit_cost, 2), round(x.quantity * e.unit_charge, 2)
    from job_extras x
    join jobs j on j.id = x.job_id join customers c on c.id = j.customer_id
    join extras e on e.id = x.extra_id
   where (p_job_id is null or x.job_id = p_job_id)
     and (p_from is null or x.added_on >= p_from) and (p_to is null or x.added_on <= p_to)
  order by 7, 1;
end $$;
revoke execute on function public.cost_lines(bigint, date, date) from public, anon;
grant execute on function public.cost_lines(bigint, date, date) to authenticated;
