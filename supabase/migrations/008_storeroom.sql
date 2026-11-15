-- RAB Flow: Storeroom.
-- A shared storeroom login (user STAFF, password RABSTORE) opens the Storeroom
-- screens only. Each person picks their name and enters their own 4-digit
-- code, then logs consumables they take and signs tools out and back in.
--
-- The storeroom login is not a staff member: it cannot read jobs, staff,
-- costs or anything else. It reads the consumables and tools lists and does
-- everything else through the store_* functions below, which check the
-- person's 4-digit code on every call.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- The shared storeroom login
-- ---------------------------------------------------------------------------
create table store_logins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table store_logins enable row level security; -- no policies: never read by the app

create function is_store() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from store_logins where user_id = auth.uid());
$$;
revoke execute on function public.is_store() from public, anon;
grant execute on function public.is_store() to authenticated;

-- ---------------------------------------------------------------------------
-- Lists (Office edits in Settings)
-- ---------------------------------------------------------------------------
create table consumables (
  id bigint generated always as identity primary key,
  name text not null,
  code text unique,                     -- supplier item code from the order form
  category text,
  unit text not null default 'each',   -- each, box, pack, roll, litre, pair ...
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table tools (
  id bigint generated always as identity primary key,
  name text not null,
  tag text unique,                      -- tool ID / asset tag, e.g. GR-03
  category text,
  location text,                        -- shelf or cage
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table consumables enable row level security;
alter table tools enable row level security;

do $$
declare t text;
begin
  foreach t in array array['consumables', 'tools'] loop
    execute format('create policy %1$s_read on %1$s for select using (is_staff() or is_store())', t);
    execute format('create policy %1$s_office_insert on %1$s for insert with check (is_office())', t);
    execute format('create policy %1$s_office_update on %1$s for update using (is_office()) with check (is_office())', t);
    execute format('create policy %1$s_office_delete on %1$s for delete using (is_office())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Each person's 4-digit storeroom code (hashed, never readable)
-- ---------------------------------------------------------------------------
create table staff_store_codes (
  staff_id uuid primary key references staff (id) on delete cascade,
  code_hash text not null,
  failed_tries int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table staff_store_codes enable row level security; -- no policies: functions only

-- ---------------------------------------------------------------------------
-- What left the storeroom
-- ---------------------------------------------------------------------------
create table consumable_takes (
  id bigint generated always as identity primary key,
  consumable_id bigint not null references consumables (id),
  staff_id uuid not null references staff (id),
  quantity numeric(10, 2) not null check (quantity > 0),
  job_id bigint references jobs (id) on delete set null,
  note text,
  taken_at timestamptz not null default now()
);
create index consumable_takes_taken_at on consumable_takes (taken_at);
create index consumable_takes_job on consumable_takes (job_id);

create table tool_signouts (
  id bigint generated always as identity primary key,
  tool_id bigint not null references tools (id),
  staff_id uuid not null references staff (id),
  job_id bigint references jobs (id) on delete set null,
  out_at timestamptz not null default now(),
  returned_at timestamptz,
  returned_by uuid references staff (id)
);
-- A tool can only be out with one person at a time.
create unique index tool_signouts_one_open on tool_signouts (tool_id) where returned_at is null;
create index tool_signouts_out_at on tool_signouts (out_at);

alter table consumable_takes enable row level security;
alter table tool_signouts enable row level security;
-- Office reads the logs and can tidy mistakes. Everyone else writes through the functions.
create policy consumable_takes_office_read on consumable_takes for select using (is_office());
create policy consumable_takes_office_delete on consumable_takes for delete using (is_office());
create policy tool_signouts_office_read on tool_signouts for select using (is_office());
create policy tool_signouts_office_update on tool_signouts for update using (is_office()) with check (is_office());

-- ---------------------------------------------------------------------------
-- Storeroom functions. They return NULL when it worked, or a message to show.
-- (Returning a message instead of raising an error keeps the wrong-code count.)
-- ---------------------------------------------------------------------------

-- Checks a person's code. 5 wrong codes in a row locks that person for 15 minutes.
create function store_code_problem(p_staff uuid, p_code text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare c staff_store_codes;
begin
  if not (is_store() or is_staff()) then return 'Please sign in to the storeroom again.'; end if;
  if not exists (select 1 from staff where id = p_staff and active) then return 'Pick your name.'; end if;
  select * into c from staff_store_codes where staff_id = p_staff for update;
  if not found then return 'Choose your 4-digit code first.'; end if;
  if c.locked_until > now() then
    return 'Too many wrong codes. Try again in ' || ceil(extract(epoch from c.locked_until - now()) / 60)::int || ' min, or ask the office to reset your code.';
  end if;
  if c.code_hash <> crypt(coalesce(p_code, ''), c.code_hash) then
    update staff_store_codes
      set failed_tries = failed_tries + 1,
          locked_until = case when failed_tries + 1 >= 5 then now() + interval '15 minutes' end
      where staff_id = p_staff;
    return 'Wrong code.';
  end if;
  if c.failed_tries > 0 then
    update staff_store_codes set failed_tries = 0, locked_until = null where staff_id = p_staff;
  end if;
  return null;
end $$;

-- Used when someone enters their code, before they pick anything.
create function store_check_code(p_staff uuid, p_code text) returns text
language sql security definer set search_path = public as $$
  select store_code_problem(p_staff, p_code);
$$;

-- The names in the dropdown, and whether each person has chosen a code yet.
create function store_people() returns table (id uuid, name text, has_code boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, exists (select 1 from staff_store_codes c where c.staff_id = s.id)
  from staff s
  where s.active and (is_store() or is_staff())
  order by s.name;
$$;

create function store_set_code(p_staff uuid, p_code text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (is_store() or is_staff()) then return 'Please sign in to the storeroom again.'; end if;
  if not exists (select 1 from staff where id = p_staff and active) then return 'Pick your name.'; end if;
  if coalesce(p_code, '') !~ '^[0-9]{4}$' then return 'Your code must be 4 digits.'; end if;
  if exists (select 1 from staff_store_codes where staff_id = p_staff) then
    return 'You already have a code. Ask the office to reset it if you have forgotten it.';
  end if;
  insert into staff_store_codes (staff_id, code_hash) values (p_staff, crypt(p_code, gen_salt('bf')));
  return null;
end $$;

-- Office: clear a code so the person can choose a new one.
create function store_reset_code(p_staff uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_office() then raise exception 'Only Office can reset storeroom codes.'; end if;
  delete from staff_store_codes where staff_id = p_staff;
end $$;

-- Finds a job by its Job Number. Returns null for blank; raises nothing.
create function store_job_id(p_job_number text) returns bigint
language sql stable security definer set search_path = public as $$
  select id from jobs where job_number = nullif(trim(p_job_number), '');
$$;

-- Log consumables taken. p_lines: [{"consumable_id": 1, "quantity": 2}, ...]
create function store_take(p_staff uuid, p_code text, p_lines jsonb, p_job_number text, p_note text)
returns text
language plpgsql security definer set search_path = public as $$
declare problem text; v_job bigint; line jsonb;
begin
  problem := store_code_problem(p_staff, p_code);
  if problem is not null then return problem; end if;
  if nullif(trim(p_job_number), '') is not null then
    v_job := store_job_id(p_job_number);
    if v_job is null then return 'No job with Job Number ' || trim(p_job_number) || '. Check the number or leave it blank.'; end if;
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then return 'Add at least one item.'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((line->>'quantity')::numeric, 0) <= 0 then return 'Each quantity must be more than 0.'; end if;
    if not exists (select 1 from consumables where id = (line->>'consumable_id')::bigint and active) then
      return 'One of those items is no longer on the list. Start again.';
    end if;
    insert into consumable_takes (consumable_id, staff_id, quantity, job_id, note)
    values ((line->>'consumable_id')::bigint, p_staff, (line->>'quantity')::numeric, v_job, nullif(trim(p_note), ''));
  end loop;
  return null;
end $$;

create function store_tool_out(p_staff uuid, p_code text, p_tool bigint, p_job_number text) returns text
language plpgsql security definer set search_path = public as $$
declare problem text; v_job bigint; holder text;
begin
  problem := store_code_problem(p_staff, p_code);
  if problem is not null then return problem; end if;
  if not exists (select 1 from tools where id = p_tool and active) then return 'That tool is no longer on the list.'; end if;
  select s.name into holder from tool_signouts o join staff s on s.id = o.staff_id
    where o.tool_id = p_tool and o.returned_at is null;
  if holder is not null then return 'That tool is already signed out to ' || holder || '. Return it first.'; end if;
  if nullif(trim(p_job_number), '') is not null then
    v_job := store_job_id(p_job_number);
    if v_job is null then return 'No job with Job Number ' || trim(p_job_number) || '. Check the number or leave it blank.'; end if;
  end if;
  insert into tool_signouts (tool_id, staff_id, job_id) values (p_tool, p_staff, v_job);
  return null;
end $$;

-- Anyone with their code can return a tool (it records who brought it back).
create function store_tool_in(p_staff uuid, p_code text, p_tool bigint) returns text
language plpgsql security definer set search_path = public as $$
declare problem text;
begin
  problem := store_code_problem(p_staff, p_code);
  if problem is not null then return problem; end if;
  update tool_signouts set returned_at = now(), returned_by = p_staff
    where tool_id = p_tool and returned_at is null;
  if not found then return 'That tool is not signed out.'; end if;
  return null;
end $$;

-- Every active tool and who has it right now.
create function store_tools() returns table (
  id bigint, name text, tag text, category text, location text, notes text,
  out_staff_id uuid, out_staff_name text, out_at timestamptz, out_job_number text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.tag, t.category, t.location, t.notes, o.staff_id, s.name, o.out_at, j.job_number
  from tools t
  left join tool_signouts o on o.tool_id = t.id and o.returned_at is null
  left join staff s on s.id = o.staff_id
  left join jobs j on j.id = o.job_id
  where t.active and (is_store() or is_staff())
  order by t.category nulls last, t.name;
$$;

-- Signed-out visitors can call none of these.
revoke execute on function public.store_code_problem(uuid, text) from public, anon, authenticated;
revoke execute on function public.store_job_id(text) from public, anon, authenticated;
revoke execute on function public.store_check_code(uuid, text) from public, anon;
revoke execute on function public.store_people() from public, anon;
revoke execute on function public.store_set_code(uuid, text) from public, anon;
revoke execute on function public.store_reset_code(uuid) from public, anon;
revoke execute on function public.store_take(uuid, text, jsonb, text, text) from public, anon;
revoke execute on function public.store_tool_out(uuid, text, bigint, text) from public, anon;
revoke execute on function public.store_tool_in(uuid, text, bigint) from public, anon;
revoke execute on function public.store_tools() from public, anon;
grant execute on function public.store_check_code(uuid, text) to authenticated;
grant execute on function public.store_people() to authenticated;
grant execute on function public.store_set_code(uuid, text) to authenticated;
grant execute on function public.store_reset_code(uuid) to authenticated;
grant execute on function public.store_take(uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.store_tool_out(uuid, text, bigint, text) to authenticated;
grant execute on function public.store_tool_in(uuid, text, bigint) to authenticated;
grant execute on function public.store_tools() to authenticated;

-- ---------------------------------------------------------------------------
-- Create the shared storeroom sign-in: user STAFF, password RABSTORE.
-- (The app turns "STAFF" into this private address. Change the password later
-- in Supabase > Authentication > Users if it gets around.)
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = 'store@staff.rabflow.app';
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      'store@staff.rabflow.app', extensions.crypt('RABSTORE', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text, 'email',
      jsonb_build_object('sub', v_id::text, 'email', 'store@staff.rabflow.app', 'email_verified', true), now(), now(), now());
  end if;
  insert into store_logins (user_id) values (v_id) on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Starting consumables list, from the Rocklea Abrasive order form (items only).
-- Office can rename items, set the unit (box, roll, pack...) and add more in
-- Settings > Consumables.
-- ---------------------------------------------------------------------------
insert into consumables (code, name, category) values
  ('BRUMBSD127', 'BRUMBY 127MM RAPID STRIP DISC', 'Abrasives'),
  ('3M7100196791', '3M FLAP DISC 769F 125MM X 80G', 'Abrasives'),
  ('3M7000028201', '3M SANDING DISC 180 x 22 36G', 'Abrasives'),
  ('3M7000028328', 'WET AND DRY 1/2 SHEET 2000G', 'Abrasives'),
  ('3M7012877501', 'SCOTCHBRITE CLEAN & STRIP', 'Abrasives'),
  ('3M7000038372', '3M HOOKIT SOFT INTERFACE', 'Abrasives'),
  ('3M7100052357', '3M BACKING PAD NON-VAC 150MM', 'Abrasives'),
  ('FLEX66254499717', 'ROTOLO FOAM SANDING ROLL', 'Abrasives'),
  ('FLEX66254499721', 'ROTOLO FOAM SANDING ROLL', 'Abrasives'),
  ('FLEX66254499722', 'ROTOLO FOAM SANDING ROLL', 'Abrasives'),
  ('KLIN126347', 'KLINGSPOR ST358A FIBRE', 'Abrasives'),
  ('KLIN2476', 'KLINGSPOR PS 22 K DISCS SELF', 'Abrasives'),
  ('KLIN2477', 'KLINGSPOR PS 22 K DISCS SELF', 'Abrasives'),
  ('KLIN295309', 'KLINGSPOR QRC 411 QUICK', 'Abrasives'),
  ('KLIN295310', 'KLINGSPOR QRC 411 QUICK', 'Abrasives'),
  ('KLIN295311', 'KLINGSPOR QRC 411 QUICK', 'Abrasives'),
  ('KLIN295413', 'KLINGSPOR 50 MM QUICK CHANGE', 'Abrasives'),
  ('KLIN295414', 'KLINGSPOR QRC 800 QUICK', 'Abrasives'),
  ('KLIN295415', 'KLINGSPOR QRC 800 QUICK', 'Abrasives'),
  ('KLIN301222', 'SCOTCHBRITE ROLL 115MM X', 'Abrasives'),
  ('PFER42721512', 'PFERD COMBIDISC HOLDER CDR', 'Abrasives'),
  ('PFER42770506', 'PFERD COMBIDISC CDR 50MM ALU', 'Abrasives'),
  ('PFER42770512', 'PFERD COMBIDISC CDR 50MM ALU', 'Abrasives'),
  ('PFER42770518', 'COMBIDISC ABRASIVE DISC 50MM', 'Abrasives'),
  ('PFER43102001', 'PFERD MOUNTED WHEEL BRUSH', 'Abrasives'),
  ('PFER43204101', 'PFERD MOUNTED PENCIL CRIMP', 'Abrasives'),
  ('PFER43210001', 'PFERD CUP BRUSH CRIMPED STEEL', 'Abrasives'),
  ('PFER47200041', 'PFERD POLIVLIES ROLL SURFACE', 'Abrasives'),
  ('PFER47200043', 'PFERD POLINOX 115 MM X 10 M', 'Abrasives'),
  ('PFER75437257', 'ZIRCONIA BELT 20 X 520MM 80G', 'Abrasives'),
  ('SHIN49058BM', 'VELCRO BACKING PAD TO 75MM', 'Abrasives'),
  ('NORT66254427172', 'PLASTIFILM STANDARD', 'Abrasives'),
  ('NORT66254499719', 'ROTOLO FOAM SANDING ROLL', 'Abrasives'),
  ('NORT66254499724', 'NORTON A275 ROTOLO P600 FOAM', 'Abrasives'),
  ('NORT66623320456', 'NORTON NO-FIL A275 150MM P80', 'Abrasives'),
  ('NORT66623320458', 'NORTON NO-FIL A275 150MM P180', 'Abrasives'),
  ('NORT66623320459', 'NORTON NO-FIL A275 150MM P240', 'Abrasives'),
  ('NORT66623320460', 'NORTON NO-FIL A275 150MM P320', 'Abrasives'),
  ('NORT66623320551', 'SANDING DISC 200MM VELCRO', 'Abrasives'),
  ('NORT66623320606', '200mm x 40g SPEED GRIP DISCS', 'Abrasives'),
  ('NORT66623320655', 'NORTON NO-FIL A275 150MM P400', 'Abrasives'),
  ('CFASCOHMP12', 'HAND MASKING PAPER ROLL 300MM', 'Paint supplies'),
  ('CFASCOHMP6', 'HAND MASKING PAPER ROLL 150MM', 'Paint supplies'),
  ('CFASCOMP18', 'KLEEN KRAFT PAPER ROLL 450MM', 'Paint supplies'),
  ('CFASCOMP36', 'KLEEN KRAFT PAPER ROLL 900MM', 'Paint supplies'),
  ('CFASCOPPS', 'PAPER PAINT STRAINERS 190', 'Paint supplies'),
  ('CFASFXGCK', 'SPRAY GUN CLEANING KIT', 'Paint supplies'),
  ('CFASS0121', 'PLASTIC BOG APPLICATORS', 'Paint supplies'),
  ('CFASS0123', 'METAL BOG APPLICATORS', 'Paint supplies'),
  ('CFASS5210', 'PAINT COLOR MIXING CUP', 'Paint supplies'),
  ('CFASSXMC1400', 'PAINT COLOR MIXING CUP', 'Paint supplies'),
  ('CFASSXMC700', 'PAINT COLOR MIXING CUP', 'Paint supplies'),
  ('DRAP20785', 'LONG REACH ANGLED PAINT BRUSH', 'Paint supplies'),
  ('DRAP82556', 'OFFSET BRUSH - BENT PLASTIC', 'Paint supplies'),
  ('EACT8ES', 'EVERCOAT EASY SAND 30OZ', 'Paint supplies'),
  ('EACT8RG', 'RAGE GOLD 3.0LTR BODY FILLER', 'Paint supplies'),
  ('GEIGGP2001A-4', 'CARAMEL WHEEL TO SUIT STICKER', 'Paint supplies'),
  ('GERSGSHOOD', 'GERSON SPRAY HOODS BX12', 'Paint supplies'),
  ('GPI6PS4', 'PAINT STRIPPER 4LT', 'Paint supplies'),
  ('GPIHCGW4', 'CAM CLEAN GUN WASH /STRIPPER', 'Paint supplies'),
  ('GPIS8632', 'GERSON BLUE TACK CLOTH', 'Paint supplies'),
  ('GPIWHSRH', 'TWIN LINE SOLVENT RESISTANT', 'Paint supplies'),
  ('HPACHPSB280', 'SPRAY PAK SATIN BLACK 280G', 'Paint supplies'),
  ('OLDF147100', 'OLDFILEDS REDLINE 100MM', 'Paint supplies'),
  ('OLDF14725', 'OLDFILEDS REDLINE 25MM', 'Paint supplies'),
  ('OLDF676F', 'FOAM ROLLER COVER 100MM', 'Paint supplies'),
  ('MONART-1259', 'PLASTIC PAINT TRAY 100MM', 'Paint supplies'),
  ('OLDF727Q', 'OLDFIELDS 270MM PAINT ROLLER', 'Paint supplies'),
  ('ROKS11746', 'FOAM ROLLER COVER 270MM', 'Paint supplies'),
  ('ROKS1580', 'TOUCH UP BRUSH SIZE 10', 'Paint supplies'),
  ('ROKS30715', 'HD FOAM BRUSH 25MM', 'Paint supplies'),
  ('ROKS35052', 'ROKSET PRO 10/20LTR PAINT', 'Paint supplies'),
  ('ROYMMI1600R08', 'No 8 ROUND ARTIST BRUSH', 'Paint supplies'),
  ('STER119-2D', 'STERLING HI-VIS RETRACTABLE', 'Paint supplies'),
  ('STER1404-L', 'SNAP OFF BLADES 18MM 10 PK', 'Paint supplies'),
  ('STER30-112', 'SINGLE EDGE RAZOR BLADES BOX', 'Paint supplies'),
  ('STER585-1', 'STERLING STERLING RUBBER GRIP', 'Paint supplies'),
  ('STER921-2D', 'HEAVY DUTY KNIFE BLADES ( PKT', 'Paint supplies'),
  ('STYL1757', '9999 STYLUS AUTO MASKING TAPE', 'Paint supplies'),
  ('STYL1758', '9999 STYLUS AUTO MASKING TAPE', 'Paint supplies'),
  ('STYL1759', '9999 STYLUS AUTO MASKING TAPE', 'Paint supplies'),
  ('STYL2636', 'STYLUS 398 BLACK CLOTH TAPE', 'Paint supplies'),
  ('STYL8290', 'STYLUS 3MM 179 FINELINE TAPE', 'Paint supplies'),
  ('STYL8291', 'STYLUS 6MM 179 FINELINE TAPE', 'Paint supplies'),
  ('STYL8292', 'STYLUS 12MM 179 FINELINE TAPE', 'Paint supplies'),
  ('UNIPHBC5', 'PAINT ROLLER FRAME 100MM SUIT', 'Paint supplies'),
  ('UPOLDOLST/TU', 'DOLPHIN 1K STOPPER PUTTY TUBE', 'Paint supplies'),
  ('UPOLFIBL/3', 'UPOL FIBRAL FIBREGLASS FILLER', 'Paint supplies'),
  ('3M60980037232', '3M 309 BLUE CREAM HARDENER', 'Paint supplies'),
  ('BALCCFWG/20', 'WAX AND GREASE REMOVER 20L', 'Paint supplies'),
  ('DMGGTIGRXXLG', 'Tigmate RX XLG Glove 340mm', 'Safety gear'),
  ('ELLITIG16L', 'ELLIOTTS TIGMATE GLOVE', 'Safety gear'),
  ('ELLITIG16XL', 'TIG MATE 380MM LONG TIG', 'Safety gear'),
  ('BOSS710501', 'RIGGER GLOVES COWGRAIN PREM', 'Safety gear'),
  ('BOSS710502', 'RIGGER GLOVES COWGRAIN PREM', 'Safety gear'),
  ('GPIHNOS', 'GPI POLYESTER OVERALLS WITH', 'Safety gear'),
  ('GPIHNOM', 'GPI POLYESTER OVERALLS WITH', 'Safety gear'),
  ('GPIHNOL', 'GPI POLYESTER OVERALLS WITH', 'Safety gear'),
  ('GPIHNOXXL', 'GPI POLYESTER OVERALLS WITH', 'Safety gear'),
  ('GPIS8422XL', 'GPI POLYESTER OVERALLS WITH', 'Safety gear'),
  ('GPIHNOS2P', 'GPI POLYESTER OVERALLS WITH', 'Safety gear'),
  ('MAXIEBR330E', 'CLEAR SAFETY SPECS ANTI FOG', 'Safety gear'),
  ('MAXIEBR331E', 'SMOKE SAFETY SPEC', 'Safety gear'),
  ('MAXIGNB205-L', 'Maxisafe - Black Ace Nitrile', 'Safety gear'),
  ('MAXIGNB205-M', 'DISP NITRILE POWDER FREE', 'Safety gear'),
  ('MAXIGNB205-XL', 'Maxisafe - Black Ace Nitrile', 'Safety gear'),
  ('PORTA120GRXL', 'PORT A120 PU COATED GLOVE', 'Safety gear'),
  ('PRATESKGP120', 'PRATT SPILL KIT ECONOMY', 'Safety gear'),
  ('PRATFSGP30', 'PRATT GENRAL PURPOSE GROUND', 'Safety gear'),
  ('PROCEPYU500R', 'PRO-PLUG DISPENSER REFILL', 'Safety gear'),
  ('PROCVCE', 'VADAR CLEAR REPL VISOR HI', 'Safety gear'),
  ('SAFEC-5133-10', 'NXG BLACK DOG CUT D GLOVES', 'Safety gear'),
  ('SUND05SR014', 'SUNDSTROM HALF FACE', 'Safety gear'),
  ('SUNDH02-0312', 'SUNDSTROM SR221 FILTER', 'Safety gear'),
  ('SUNDH02-1312', 'SUNDSTROM SR510 P3 PARTICLE', 'Safety gear'),
  ('SUNDH02-2012', 'SUNDSTROM GAS FILTER SR218-3', 'Safety gear'),
  ('TORHKP10', 'KNEE PADS CHROME LEATHER', 'Safety gear'),
  ('UVEXXF-UC', 'UVEX X-FIT FOAM EARPLUG CL 5', 'Safety gear'),
  ('UVEXXG35BF4', 'RUBIFLEX XG SIZE 11', 'Safety gear'),
  ('YOURG900-2XL', 'RIGGER GLOVES COWGRAIN', 'Safety gear'),
  (null, 'PARTICULATE PRE-FILTER P2', 'Safety gear'),
  ('CEJN103425004', 'CEJN NIPPLE 3/8'''' BARB', 'Tools etc'),
  ('HOLMUN300-020', 'HSSS DRILL 2.0MM', 'Tools etc'),
  ('HOLMUN300-030', 'HSSS DRILL 3.0MM', 'Tools etc'),
  ('HOLMUN300-050', 'HSSS DRILL 5.0MM', 'Tools etc'),
  ('HOLMUN300-070', 'HSSS DRILL 7.0MM', 'Tools etc'),
  ('HOLMUN300-125', 'HSSS DRILL 12.5MM 046341', 'Tools etc'),
  ('HOLMUN300-130', 'HSSS DRILL 13.0MM', 'Tools etc'),
  ('HOLMUN302-125', 'HSSS DRILL 1/8''''', 'Tools etc'),
  ('HOLMUN310-140', 'HSSS DRILL 14.0MM REDUCED', 'Tools etc'),
  ('INDTNC20PF', '20PF PLUG 1/4 GAS F', 'Tools etc'),
  ('INDTNC20PM', '20PM NIPPLE 1/4BSP M', 'Tools etc'),
  ('INDTNC20SH', '20SH SOCKET 1/4 BARB', 'Tools etc'),
  ('INDTNC30PH', '30PH PLUG 3/8 BARB', 'Tools etc'),
  ('INDTNC30SH', '30SH SOCKET 3/8 BARB', 'Tools etc'),
  ('INDU11-OTK1315', 'OTK CLIP 1115-09 13mm-15mm', 'Tools etc'),
  ('KINCK4001', 'KINCROME KIN-AUTO WIRE', 'Tools etc'),
  ('KINCK4201', 'KINCROME PLIER COMBINATION', 'Tools etc'),
  ('ALEM501A', 'ALEMLUBE ROTARY DRUM PUMP', 'Tools etc'),
  ('M7M7-JC405', 'BLOWGUN 8mm ANG NOZZLE BRASS', 'Tools etc'),
  ('M7M7-JC412', 'M7 AIR BLOW GUN BENT NOZZLE', 'Tools etc'),
  ('M7M7-SO1010', 'M7 AIR TOOL OIL 1 LITRE', 'Tools etc'),
  ('M7M7-SO150', 'AIR TOOL OIL 5 LTR', 'Tools etc'),
  ('PFER75607902', 'SNAP-OFF KNIFE 18MM H/DUTY', 'Tools etc'),
  ('SELL9300697118202', 'SELLEYS SAUSAGE GUN', 'Tools etc'),
  ('SELL9300697118592', 'SELLEYS SAUSAGE GUN NOZZLES', 'Tools etc'),
  ('SHINSI3101-6', '6IN DUAL ACTION SANDER', 'Tools etc'),
  ('SUTTH3410018', 'HACKSAW BLADE 300MM - 18TPI', 'Tools etc'),
  ('TRIDTEC1518', 'OTK CLIP 15mm-18mm', 'Tools etc'),
  ('CBBSQWB25', 'STRETCHWRAP BLACK', 'Miscellaneous'),
  ('CRC1020163', 'CRC 4014 Heavy Duty Spray', 'Miscellaneous'),
  ('CYKL107112500', 'CYKLPOP POLY FOAM ROLL', 'Miscellaneous'),
  ('ECLI4002', '2 PLY 400SHEET 100% RECYCLED', 'Miscellaneous'),
  ('G20GH79157', 'GLEN 20 ORIGINAL SCENT 300G', 'Miscellaneous'),
  ('HALYKC6835', 'HALYARD ISOWIPE (75) 420x143mm', 'Miscellaneous'),
  ('IMPA28629', 'Impacta - Toilet Urinal', 'Miscellaneous'),
  ('JOHNKCL4LTR', 'KRESTO HAND CLEAN 4LTR', 'Miscellaneous'),
  ('MPMMWRAP00101', 'ALUMINIUM FOIL ALL PURPOSE', 'Miscellaneous'),
  ('NORM08600210602', 'CABLE TIES 200mmx4.8mm (100)', 'Miscellaneous'),
  ('NORM08600210604', 'CABLE TIES 300mmx4.8mm (100)', 'Miscellaneous'),
  ('NORM08600210705', 'CABLE TIES 400mmx8mm (100) BLK', 'Miscellaneous'),
  ('OATEED11115', 'OATES LOBBY PAN SET BLACK', 'Miscellaneous'),
  ('PMENPM10-100-1500', 'BUBBLE WRAP 1400mm x 100M', 'Miscellaneous'),
  ('RAG10', 'Rags 10kg Mixed Colours', 'Miscellaneous'),
  ('SSMAES-A-AP-15', 'SORBALITE ZEOLITE MINERAL', 'Miscellaneous'),
  ('TORKTK170370', 'HAND TOWEL I''LEAVED ULTRASLIM', 'Miscellaneous'),
  ('TRIDCT458BKCD', 'CABLE TIES 450 x 8 MM (100)', 'Miscellaneous'),
  ('TRIDCT559BKCD', 'CABLE TIE 516-615MM X', 'Miscellaneous')
on conflict (code) do nothing;
