-- Public, non-sensitive change pulse for Hair by Lynna booking screens.
-- Contains no appointment details, customer information, or private data.
create table if not exists public.booking_change_signal (
  id integer primary key check (id = 1),
  revision bigint not null default 0,
  changed_at timestamptz not null default now()
);
insert into public.booking_change_signal(id,revision)
values (1,0) on conflict (id) do nothing;
alter table public.booking_change_signal enable row level security;
drop policy if exists "public may read booking signal" on public.booking_change_signal;
create policy "public may read booking signal"
on public.booking_change_signal for select to anon,authenticated using (true);
revoke all on public.booking_change_signal from public,anon,authenticated;
grant select on public.booking_change_signal to anon,authenticated;

create or replace function public.bump_booking_change_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 update public.booking_change_signal set revision=revision+1,changed_at=now() where id=1;
 return null;
end $$;
revoke all on function public.bump_booking_change_signal() from public,anon,authenticated;
drop trigger if exists booking_signal_appointments on public.appointments;
create trigger booking_signal_appointments after insert or update or delete on public.appointments
for each statement execute function public.bump_booking_change_signal();
drop trigger if exists booking_signal_availability on public.availability;
create trigger booking_signal_availability after insert or update or delete on public.availability
for each statement execute function public.bump_booking_change_signal();
drop trigger if exists booking_signal_services on public.services;
create trigger booking_signal_services after insert or update or delete on public.services
for each statement execute function public.bump_booking_change_signal();

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='booking_change_signal') then
  alter publication supabase_realtime add table public.booking_change_signal;
 end if;
end $$;
