-- Hair by Lynna: database-side appointment conflict protection.
-- Run in Supabase SQL Editor. Does not enable public booking submissions.
create extension if not exists btree_gist with schema extensions;

-- Prevent overlapping pending/approved appointments even under concurrent requests.
alter table public.appointments
  add constraint appointments_no_active_overlap
  exclude using gist (
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending','approved'));

-- Hide busy times from the public booking preview, without exposing customer data.
-- For each published window return 30-minute start choices that fit a selected service.
create or replace function public.public_booking_slots(p_service_id uuid, p_day date)
returns table (slot_time time)
language plpgsql stable security definer set search_path = ''
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
  from public.services s where s.id = p_service_id and s.active;
  if duration_mins is null then return; end if;
  if p_day < (now() at time zone 'America/Toronto')::date
     or p_day > (now() at time zone 'America/Toronto')::date + 180 then return; end if;
  for a in select start_time,end_time from public.availability
    where date = p_day and enabled loop
    candidate := p_day + a.start_time;
    endpoint := p_day + a.end_time;
    candidate := date_trunc('hour',candidate) +
      make_interval(mins => (ceil(extract(minute from candidate)/30.0)::int * 30));
    while candidate + make_interval(mins=>duration_mins) <= endpoint loop
      start_instant := candidate at time zone 'America/Toronto';
      end_instant := (candidate+make_interval(mins=>duration_mins)) at time zone 'America/Toronto';
      if start_instant > now() and not exists (
        select 1 from public.appointments b
        where b.status in ('pending','approved')
          and tstzrange(b.starts_at,b.ends_at,'[)') &&
              tstzrange(start_instant,end_instant,'[)')
      ) then
        slot_time := candidate::time;
        return next;
      end if;
      candidate := candidate + interval '30 minutes';
    end loop;
  end loop;
end $$;
revoke all on function public.public_booking_slots(uuid,date) from public;
grant execute on function public.public_booking_slots(uuid,date) to anon, authenticated;

-- Admin-only status transitions remain restricted by existing RLS.
-- No anonymous INSERT/UPDATE policy or public booking RPC is created here.
