-- Supabase schema — Relief Lens v2 (Raozan upazila, Chattogram district).
-- Paste into Supabase → SQL Editor → Run. Idempotent: every run drops and
-- rebuilds every object below, then reseeds demo data from scratch. Re-running
-- this file WIPES any updates/consignments a demo session has added — that is
-- the point during a hackathon rehearsal, but do not run it against a project
-- you intend to keep live data in.
--
-- Three-tier access model:
--   PUBLIC        — shelters (map) only. Nothing else.
--   AUTHENTICATED + approved — read shelter_needs/updates/consignments,
--                   submit field updates; commissioners+admin also import
--                   consignments and edit shelter_needs directly.
--   ADMIN         — manage accounts (role/approved) and shelter CRUD.
-- See PERMISSIONS.md for the capability matrix and the policy-name mapping.

-- =============================================================================
-- CLEAN SLATE — drop in dependency order so re-running this file is safe.
-- =============================================================================

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.updates cascade;
drop table if exists public.consignments cascade;
drop table if exists public.shelter_needs cascade;
drop table if exists public.shelters cascade;
drop table if exists public.supply_items cascade;
drop table if exists public.profiles cascade;

drop function if exists public.apply_field_update() cascade;
drop function if exists public.guard_profile_privileges() cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_approved() cascade;
drop function if exists public.app_role() cascade;

drop type if exists public.user_role cascade;

-- =============================================================================
-- ENUM
-- =============================================================================

create type public.user_role as enum ('admin', 'commissioner', 'volunteer');

-- =============================================================================
-- TABLES
-- =============================================================================

-- One row per authenticated user. Created by the auth.users trigger below —
-- nobody INSERTs into this table directly from the client.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  role        public.user_role not null default 'volunteer',
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Fixed reference list — the ONLY allowed need/stock items. Public read
-- because the item catalogue (labels/units) carries no sensitive data and is
-- needed to render dropdowns before a user has logged in.
create table public.supply_items (
  value  text primary key,
  label  text not null,
  unit   text not null
);

-- Public-facing shelter directory. This is the "map" table: location,
-- capacity, headcount only — no needs data lives here.
create table public.shelters (
  id          text primary key,
  name        text not null,
  union_name  text not null,
  upazila     text not null default 'Raozan',
  district    text not null default 'Chattogram',
  lat         double precision not null,
  lng         double precision not null,
  capacity    int not null check (capacity > 0),
  headcount   int not null default 0 check (headcount >= 0),
  updated_at  timestamptz not null default now()
);

-- Current needs snapshot per shelter. Replaced wholesale by the field-update
-- trigger below, or written directly by commissioners/admins.
create table public.shelter_needs (
  id          bigserial primary key,
  shelter_id  text not null references public.shelters (id) on delete cascade,
  item        text not null references public.supply_items (value),
  qty         int not null check (qty > 0),
  unique (shelter_id, item)
);

-- Append-only field-update log. Every insert re-derives shelters.headcount
-- and shelter_needs via the SECURITY DEFINER trigger — volunteers never get
-- UPDATE on shelters or shelter_needs directly through this path.
create table public.updates (
  id          bigserial primary key,
  shelter_id  text not null references public.shelters (id) on delete cascade,
  author      uuid references public.profiles (id) default auth.uid(),
  headcount   int not null check (headcount >= 0),
  needs       jsonb not null default '[]'::jsonb,
  note        text,
  created_at  timestamptz not null default now()
);

-- Append-only aid-inventory import log (one row per CSV row once validated).
create table public.consignments (
  id          bigserial primary key,
  ngo         text not null,
  item        text not null references public.supply_items (value),
  qty         int not null check (qty > 0),
  unit        text not null,
  eta_hours   int,
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create index updates_shelter_id_idx on public.updates (shelter_id);
create index consignments_item_idx on public.consignments (item);

-- =============================================================================
-- HELPER FUNCTIONS
--
-- Both are STABLE + SECURITY DEFINER with an explicit search_path: they read
-- public.profiles by auth.uid() so RLS policies elsewhere can gate on role /
-- approval without every policy re-querying profiles (and without a policy on
-- profiles needing to allow cross-user reads just so its OWN checks work).
-- Named app_role() (not current_role — that identifier is reserved).
-- =============================================================================

create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false);
$$;

grant execute on function public.app_role() to anon, authenticated;
grant execute on function public.is_approved() to anon, authenticated;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- New signup → profile row, role='volunteer', approved=false. Unapproved
-- users (any role) see nothing beyond the public tier until an admin flips
-- approved=true.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, approved)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'volunteer', false)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Blocks a user from elevating their own role/approved via the
-- profiles_update_own policy. Only checked when auth.uid() is present (i.e.
-- the request came through PostgREST/GoTrue as a logged-in user) — a NULL
-- auth.uid() means the statement is running as the SQL-editor superuser or
-- the service_role key, both of which already bypass RLS entirely, so this
-- is the deliberate escape hatch the "create the 3 demo users" block at the
-- bottom of this file relies on to promote the first admin.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.approved is distinct from old.approved)
     and public.app_role() is distinct from 'admin' then
    raise exception 'only an admin can change role or approved';
  end if;
  return new;
end;
$$;

create trigger guard_profile_privileges_trigger
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- Field-update apply: an INSERT into updates is the only way a volunteer
-- affects shelters/shelter_needs. Runs as SECURITY DEFINER so it can write
-- both tables regardless of the inserting user's own RLS grants.
create or replace function public.apply_field_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shelters
     set headcount = new.headcount,
         updated_at = now()
   where id = new.shelter_id;

  delete from public.shelter_needs where shelter_id = new.shelter_id;

  -- group by item in case the payload lists the same item twice — the table
  -- is already empty for this shelter, so a bare INSERT would otherwise hit
  -- "ON CONFLICT command cannot affect row a second time" on a duplicate.
  insert into public.shelter_needs (shelter_id, item, qty)
  select new.shelter_id, dedup.item, dedup.qty
  from (
    select (elem ->> 'item')::text as item, max((elem ->> 'qty')::int) as qty
    from jsonb_array_elements(coalesce(new.needs, '[]'::jsonb)) as elem
    where (elem ->> 'qty')::int > 0
    group by (elem ->> 'item')::text
  ) as dedup;

  return new;
end;
$$;

create trigger apply_field_update_trigger
  after insert on public.updates
  for each row execute function public.apply_field_update();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.supply_items enable row level security;
alter table public.shelters enable row level security;
alter table public.shelter_needs enable row level security;
alter table public.updates enable row level security;
alter table public.consignments enable row level security;

-- ---------- profiles ----------
-- Own row always; admin reads/updates every row. No INSERT/DELETE policy —
-- rows are created only by the signup trigger (SECURITY DEFINER, bypasses
-- RLS) and are never deleted from the client.

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (app_role() = 'admin' and is_approved());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- role/approved are still columns on "own row", but guard_profile_privileges_trigger
-- rejects any attempt to change them unless the caller is already an admin.

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (app_role() = 'admin' and is_approved())
  with check (app_role() = 'admin' and is_approved());

-- ---------- supply_items ----------
-- Fixed 8-item catalogue. Public read (no sensitive data), admin write.

drop policy if exists supply_items_select_public on public.supply_items;
create policy supply_items_select_public on public.supply_items
  for select to public
  using (true);

drop policy if exists supply_items_insert_admin on public.supply_items;
create policy supply_items_insert_admin on public.supply_items
  for insert to authenticated
  with check (app_role() = 'admin' and is_approved());

drop policy if exists supply_items_update_admin on public.supply_items;
create policy supply_items_update_admin on public.supply_items
  for update to authenticated
  using (app_role() = 'admin' and is_approved())
  with check (app_role() = 'admin' and is_approved());

drop policy if exists supply_items_delete_admin on public.supply_items;
create policy supply_items_delete_admin on public.supply_items
  for delete to authenticated
  using (app_role() = 'admin' and is_approved());

-- ---------- shelters ----------
-- Public SELECT (the map) for anon + authenticated alike. All writes are
-- admin-only CRUD; headcount/updated_at are instead driven by
-- apply_field_update_trigger, which runs as SECURITY DEFINER and so needs no
-- policy of its own — volunteers never get an UPDATE grant on this table.

drop policy if exists shelters_select_public on public.shelters;
create policy shelters_select_public on public.shelters
  for select to public
  using (true);

drop policy if exists shelters_insert_admin on public.shelters;
create policy shelters_insert_admin on public.shelters
  for insert to authenticated
  with check (app_role() = 'admin' and is_approved());

drop policy if exists shelters_update_admin on public.shelters;
create policy shelters_update_admin on public.shelters
  for update to authenticated
  using (app_role() = 'admin' and is_approved())
  with check (app_role() = 'admin' and is_approved());

drop policy if exists shelters_delete_admin on public.shelters;
create policy shelters_delete_admin on public.shelters
  for delete to authenticated
  using (app_role() = 'admin' and is_approved());

-- ---------- shelter_needs ----------
-- Approved authenticated users read. Commissioners+admin write directly (in
-- addition to the trigger-driven replace from a field update).

drop policy if exists shelter_needs_select_approved on public.shelter_needs;
create policy shelter_needs_select_approved on public.shelter_needs
  for select to authenticated
  using (is_approved());

drop policy if exists shelter_needs_insert_commissioner_admin on public.shelter_needs;
create policy shelter_needs_insert_commissioner_admin on public.shelter_needs
  for insert to authenticated
  with check (is_approved() and app_role() in ('commissioner', 'admin'));

drop policy if exists shelter_needs_update_commissioner_admin on public.shelter_needs;
create policy shelter_needs_update_commissioner_admin on public.shelter_needs
  for update to authenticated
  using (is_approved() and app_role() in ('commissioner', 'admin'))
  with check (is_approved() and app_role() in ('commissioner', 'admin'));

drop policy if exists shelter_needs_delete_commissioner_admin on public.shelter_needs;
create policy shelter_needs_delete_commissioner_admin on public.shelter_needs
  for delete to authenticated
  using (is_approved() and app_role() in ('commissioner', 'admin'));

-- ---------- updates ----------
-- Approved authenticated users read (audit trail). Any approved role can
-- submit a field update; author is verified against auth.uid() in the CHECK
-- so nobody can file an update under someone else's name. Append-only — no
-- UPDATE/DELETE policy.

drop policy if exists updates_select_approved on public.updates;
create policy updates_select_approved on public.updates
  for select to authenticated
  using (is_approved());

drop policy if exists updates_insert_field_team on public.updates;
create policy updates_insert_field_team on public.updates
  for insert to authenticated
  with check (
    author = auth.uid()
    and is_approved()
    and app_role() in ('volunteer', 'commissioner', 'admin')
  );

-- ---------- consignments ----------
-- Approved authenticated users read. Only commissioners+admin import
-- (INSERT); created_by is verified the same way as updates.author.
-- Append-only — no UPDATE/DELETE policy.

drop policy if exists consignments_select_approved on public.consignments;
create policy consignments_select_approved on public.consignments
  for select to authenticated
  using (is_approved());

drop policy if exists consignments_insert_commissioner_admin on public.consignments;
create policy consignments_insert_commissioner_admin on public.consignments
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and is_approved()
    and app_role() in ('commissioner', 'admin')
  );

-- =============================================================================
-- SEED DATA — Raozan upazila, Chattogram district.
-- Occupancy mix: 2 over (>100%), 3 near-full (85–100%), 4 ok (<85%).
-- =============================================================================

insert into public.supply_items (value, label, unit) values
  ('rice',     'Rice',            'kg'),
  ('water',    'Drinking water',  'L'),
  ('dryfood',  'Dry food packs',  'packs'),
  ('ors',      'ORS sachets',     'sachets'),
  ('blanket',  'Blankets',        'pcs'),
  ('tarp',     'Tarpaulin',       'pcs'),
  ('babyfood', 'Baby formula',    'tins'),
  ('medkit',   'Medicine kits',   'kits');

insert into public.shelters (id, name, union_name, lat, lng, capacity, headcount) values
  ('gohira-ajyms-high-school',        'Gohira A.J.Y.M.S. High School Shelter',          'Gohira',              22.4980, 91.9600, 250, 320), -- over, 128%
  ('raozan-pourashava-model-primary', 'Raozan Pourashava Model Primary School Shelter', 'Raozan Pourashava',   22.4750, 91.9430, 400, 412), -- over, 103%
  ('noapara-union-parishad-complex',  'Noapara Union Parishad Complex Shelter',         'Noapara',             22.5400, 91.9100, 200, 188), -- near-full, 94%
  ('urkirchar-fazil-madrasa',         'Urkirchar Fazil Madrasa Shelter',                'Urkirchar',           22.5600, 91.9500, 180, 162), -- near-full, 90%
  ('binajuri-govt-primary-school',    'Binajuri Government Primary School Shelter',     'Binajuri',            22.5050, 91.9900, 220, 195), -- near-full, 88.6%
  ('kadalpur-high-school',            'Kadalpur High School Shelter',                   'Kadalpur',            22.5800, 91.8950, 260, 150), -- ok, 57.7%
  ('chikdair-community-center',       'Chikdair Community Center Shelter',              'Chikdair',            22.6100, 91.9300, 150, 60),  -- ok, 40%
  ('dabua-cyclone-shelter',           'Dabua Union Cyclone Shelter',                    'Dabua',               22.5300, 92.0300, 300, 210), -- ok, 70%
  ('pahartali-degree-college',        'Pahartali Degree College Shelter',               'Pahartali',           22.4900, 92.0400, 350, 240); -- ok, 68.6%

insert into public.shelter_needs (shelter_id, item, qty) values
  ('gohira-ajyms-high-school',        'rice',     400),
  ('gohira-ajyms-high-school',        'water',    3000),
  ('gohira-ajyms-high-school',        'ors',      500),
  ('gohira-ajyms-high-school',        'blanket',  300),

  ('raozan-pourashava-model-primary', 'rice',     350),
  ('raozan-pourashava-model-primary', 'water',    2500),
  ('raozan-pourashava-model-primary', 'dryfood',  200),

  ('noapara-union-parishad-complex',  'rice',     200),
  ('noapara-union-parishad-complex',  'water',    1500),
  ('noapara-union-parishad-complex',  'blanket',  150),

  ('urkirchar-fazil-madrasa',         'rice',     180),
  ('urkirchar-fazil-madrasa',         'tarp',     100),
  ('urkirchar-fazil-madrasa',         'babyfood', 50),

  ('binajuri-govt-primary-school',    'rice',     150),
  ('binajuri-govt-primary-school',    'water',    1200),
  ('binajuri-govt-primary-school',    'ors',      200),

  ('kadalpur-high-school',            'rice',     100),
  ('kadalpur-high-school',            'medkit',   20),

  ('chikdair-community-center',       'water',    600),
  ('chikdair-community-center',       'dryfood',  80),

  ('dabua-cyclone-shelter',           'rice',     120),
  ('dabua-cyclone-shelter',           'blanket',  90),
  ('dabua-cyclone-shelter',           'tarp',     60),

  ('pahartali-degree-college',        'rice',     140),
  ('pahartali-degree-college',        'water',    900),
  ('pahartali-degree-college',        'babyfood', 40),
  ('pahartali-degree-college',        'medkit',   15);

-- Leaves rice (need 1,640 kg vs stock 900), water (9,700 L vs 5,000 L), ors
-- (700 sachets vs 300), tarp/babyfood/medkit (never stocked) all short —
-- blanket and dryfood are the only two fully covered by these consignments.
insert into public.consignments (ngo, item, qty, unit, eta_hours) values
  ('BRAC',            'rice',    900,  'kg',      6),
  ('BDRCS',           'water',   5000, 'L',       4),
  ('Ahsania Mission', 'blanket', 600,  'pcs',     10),
  ('Muslim Aid',      'ors',     300,  'sachets', 8),
  ('CARE Bangladesh', 'dryfood', 500,  'packs',   12);

-- =============================================================================
-- DEMO USERS — run by hand AFTER the SQL above.
--
-- auth.users cannot be seeded from this file: it is managed by GoTrue, and a
-- raw INSERT skips password hashing / email-confirmation bookkeeping and
-- leaves an account that cannot log in. Create the 3 demo accounts instead:
--
--   Dashboard → Authentication → Users → Add user → Create new user
--   (tick "Auto Confirm User" so no email round-trip is needed)
--
--     admin@relieflens.demo
--     commissioner@relieflens.demo
--     volunteer@relieflens.demo
--
-- The signup trigger fires immediately and gives each one a profiles row
-- with role='volunteer', approved=false. Promote them by running this in the
-- SQL Editor (as the postgres role — auth.uid() is NULL there, so
-- guard_profile_privileges_trigger's admin check does not apply; see the
-- comment on that function above):
--
--   update public.profiles set role = 'admin', approved = true
--     where id = (select id from auth.users where email = 'admin@relieflens.demo');
--
--   update public.profiles set role = 'commissioner', approved = true
--     where id = (select id from auth.users where email = 'commissioner@relieflens.demo');
--
--   update public.profiles set role = 'volunteer', approved = true
--     where id = (select id from auth.users where email = 'volunteer@relieflens.demo');
--
-- Verify:
--
--   select id, full_name, role, approved from public.profiles;
-- =============================================================================
