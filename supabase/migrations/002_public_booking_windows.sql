-- Run in Supabase SQL Editor to expose ONLY open time windows to public visitors.
-- Customer names, appointments and private admin data remain protected by RLS.
create or replace function public.public_booking_windows()
returns table(day date, starts time, ends time)
language sql stable security definer
set search_path = ''
as $$
  select a.date, a.start_time, a.end_time
  from public.availability a
  where a.enabled = true
    and a.date >= (now() at time zone 'America/Toronto')::date
    and a.date < (now() at time zone 'America/Toronto')::date + 180
  order by a.date, a.start_time;
$$;
revoke all on function public.public_booking_windows() from public;
grant execute on function public.public_booking_windows() to anon, authenticated;
-- This returns published working windows only. Pending/approved bookings will be
-- subtracted by a separate secure server-side slot endpoint before checkout.
-- No customer submission is enabled by this migration.
