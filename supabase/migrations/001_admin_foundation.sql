-- Hair by Lynna: foundation migration (run once in Supabase SQL Editor)
-- Admin privileges are granted by user ID, not by an untrusted client-supplied email.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','tester')),
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

-- Existing admins can see only their own role; no client can grant privileges.
drop policy if exists "admins can see own role" on public.admin_users;
create policy "admins can see own role" on public.admin_users
for select to authenticated using (user_id = (select auth.uid()));

-- These accounts must ALREADY exist in Authentication > Users.
-- The following intentionally fails if either account does not exist, so the
-- setup cannot falsely appear successful with an empty access table.
do $$
declare lynna_id uuid; maxo_id uuid;
begin
  select id into lynna_id from auth.users where lower(email) = 'xhair.dreams@gmail.com';
  select id into maxo_id from auth.users where lower(email) = 'chezmaxo@outlook.com';
  if lynna_id is null or maxo_id is null then
    raise exception 'Both admin Auth users must exist before this migration can run';
  end if;
  insert into public.admin_users(user_id, role)
  values (lynna_id,'owner'), (maxo_id,'tester')
  on conflict(user_id) do update set role = excluded.role;
end $$;

create table if not exists public.services (
 id uuid primary key default gen_random_uuid(),
 name_en text not null,
 name_fr text not null,
 description_en text not null default '',
 description_fr text not null default '',
 duration_minutes integer not null check (duration_minutes between 15 and 960),
 price_cents integer not null check (price_cents >= 0),
 active boolean not null default false,
 sort_order integer not null default 0,
 created_at timestamptz not null default now()
);
alter table public.services enable row level security;
drop policy if exists "public can read active services" on public.services;
create policy "public can read active services" on public.services for select to anon, authenticated
using (active or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "admin manages services" on public.services;
create policy "admin manages services" on public.services for all to authenticated
using (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())))
with check (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));

create table if not exists public.availability (
 id uuid primary key default gen_random_uuid(),
 date date not null,
 start_time time not null,
 end_time time not null,
 enabled boolean not null default true,
 note text,
 created_at timestamptz not null default now(),
 constraint valid_time_range check (end_time > start_time)
);
create index if not exists availability_date_idx on public.availability(date);
alter table public.availability enable row level security;
drop policy if exists "admin manages availability" on public.availability;
create policy "admin manages availability" on public.availability for all to authenticated
using (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())))
with check (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));

create table if not exists public.appointments (
 id uuid primary key default gen_random_uuid(),
 service_id uuid not null references public.services(id),
 customer_name text not null,
 customer_email text not null,
 customer_phone text,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
 created_at timestamptz not null default now(),
 constraint appointment_positive_duration check (ends_at > starts_at)
);
create index if not exists appointments_starts_at_idx on public.appointments(starts_at);
alter table public.appointments enable row level security;
drop policy if exists "admin manages appointments" on public.appointments;
create policy "admin manages appointments" on public.appointments for all to authenticated
using (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())))
with check (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));

-- No public appointment insert, read or modification policy is added.
-- Customer booking will use a validated server-side function later, including
-- overlap prevention, rate limiting and appointment status links.
-- Inspect the result after running:
select a.role, u.email from public.admin_users a join auth.users u on u.id = a.user_id order by a.role;
