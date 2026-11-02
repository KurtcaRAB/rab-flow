-- RAB Flow, phase 4: primer and topcoat usage.
-- Painters log litres of a product against a job. Prices stay Office only
-- (material_prices), so only Office sees what the litres cost.

create table material_usage (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs (id) on delete cascade,
  material_id bigint not null references materials (id),
  staff_id uuid not null references staff (id) default auth.uid(),
  used_on date not null default current_date,
  litres numeric(7, 2) not null check (litres > 0 and litres <= 1000),
  note text,
  -- Set by the app so an entry saved twice while offline is only kept once.
  client_ref uuid unique,
  created_at timestamptz not null default now()
);
create index material_usage_job_idx on material_usage (job_id);

-- Same for hours logged while offline.
alter table labour_entries add column client_ref uuid unique;

create function material_usage_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only Office may log usage for someone else.
  if not is_office() then
    new.staff_id := auth.uid();
  end if;
  return new;
end $$;

create trigger material_usage_defaults before insert or update on material_usage
  for each row execute function material_usage_defaults();

revoke execute on function public.material_usage_defaults() from public, anon, authenticated;

alter table material_usage enable row level security;

create policy material_usage_read on material_usage for select using (is_staff());
create policy material_usage_insert on material_usage for insert
  with check (is_staff() and (staff_id = auth.uid() or is_office()));
create policy material_usage_update on material_usage for update
  using (staff_id = auth.uid() or is_office()) with check (is_staff() and (staff_id = auth.uid() or is_office()));
create policy material_usage_delete on material_usage for delete
  using (staff_id = auth.uid() or is_office());
