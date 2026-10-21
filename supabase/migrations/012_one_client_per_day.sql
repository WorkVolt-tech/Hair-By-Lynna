-- Hair by Lynna: owner-controlled one-client-per-day booking rule.
-- Applying this migration does not modify existing appointments or availability.
create table if not exists public.booking_preferences (
  id integer primary key default 1 check (id=1),
  one_client_per_day boolean not null default false
);
insert into public.booking_preferences(id,one_client_per_day) values(1,false)
on conflict(id) do nothing;
alter table public.booking_preferences enable row level security;
revoke all on public.booking_preferences from anon,authenticated;
grant select on public.booking_preferences to authenticated;
create or replace function public.get_one_client_per_day()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select one_client_per_day from public.booking_preferences where id=1),false);
$$;
revoke all on function public.get_one_client_per_day() from public;
grant execute on function public.get_one_client_per_day() to anon,authenticated;

create or replace function public.owner_set_one_client_per_day(p_enabled boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not exists
      (select 1 from public.admin_users where user_id=(select auth.uid()) and role='owner') then
    raise exception 'OWNER_ONLY' using errcode='42501';
  end if;
  if p_enabled is null then raise exception 'INVALID_VALUE'; end if;
  update public.booking_preferences set one_client_per_day=p_enabled where id=1;
  return p_enabled;
end $$;
revoke all on function public.owner_set_one_client_per_day(boolean) from public,anon;
grant execute on function public.owner_set_one_client_per_day(boolean) to authenticated;

-- Enforce at database level, including request_appointment and admin edits.
-- The per-day advisory lock serializes competing bookings for the same day.
create or replace function public.enforce_one_client_per_day()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  booking_day date;
begin
  if new.status not in ('pending','approved')
     or not coalesce((select one_client_per_day from public.booking_preferences where id=1),false) then
    return new;
  end if;
  booking_day:=(new.starts_at at time zone 'America/Toronto')::date;
  perform pg_catalog.pg_advisory_xact_lock(64321,(booking_day-date '2000-01-01')::integer);
  if exists(
    select 1 from public.appointments a
    where a.id is distinct from new.id
      and a.status in ('pending','approved')
      and (a.starts_at at time zone 'America/Toronto')::date=booking_day
  ) then
    raise exception 'DAY_FULL' using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists enforce_one_client_per_day on public.appointments;
create trigger enforce_one_client_per_day before insert or update of starts_at,status
on public.appointments for each row execute function public.enforce_one_client_per_day();

-- Modify public slot lookup: on days with an active booking, show no
-- times if the one-per-day toggle is active. Existing conflict and 24h rules stay.
create or replace function public.public_booking_slots(p_service_id uuid,p_day date)
returns table(slot_time time)
language plpgsql stable security definer set search_path=''
as $$
declare
 duration_mins integer;
 a record;
 candidate timestamp without time zone;
 endpoint timestamp without time zone;
 start_instant timestamptz;
 end_instant timestamptz;
begin
 select s.duration_minutes into duration_mins
 from public.services s where s.id=p_service_id and s.active;
 if duration_mins is null then return; end if;
 if p_day < (now() at time zone 'America/Toronto')::date
  or p_day > (now() at time zone 'America/Toronto')::date + 180 then return; end if;
 if coalesce((select one_client_per_day from public.booking_preferences where id=1),false)
  and exists(select 1 from public.appointments b
   where b.status in ('pending','approved')
    and (b.starts_at at time zone 'America/Toronto')::date=p_day) then return; end if;
 for a in select start_time,end_time from public.availability
  where date=p_day and enabled loop
   candidate:=p_day+a.start_time;
   endpoint:=p_day+a.end_time;
   candidate:=date_trunc('hour',candidate) +
     make_interval(mins=>(ceil(extract(minute from candidate)/30.0)::int*30));
   while candidate+make_interval(mins=>duration_mins)<=endpoint loop
     start_instant:=candidate at time zone 'America/Toronto';
     end_instant:=(candidate+make_interval(mins=>duration_mins)) at time zone 'America/Toronto';
     if start_instant>=now()+interval '24 hours' and not exists(
       select 1 from public.appointments b
       where b.status in ('pending','approved')
       and tstzrange(b.starts_at,b.ends_at,'[)') &&
           tstzrange(start_instant,end_instant,'[)')
     ) then
       slot_time:=candidate::time;
       return next;
     end if;
     candidate:=candidate+interval '30 minutes';
   end loop;
 end loop;
end $$;
