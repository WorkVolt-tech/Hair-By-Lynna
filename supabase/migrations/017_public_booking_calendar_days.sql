-- Hair by Lynna: show only genuinely bookable dates in the customer calendar.
-- Run AFTER 012_one_client_per_day.sql. No appointment details are exposed.
-- All logic comes from the existing public_booking_slots() function, so the
-- calendar respects the one-client-per-day toggle, 24-hour notice, duration,
-- active service, published availability and overlapping reservations.

create or replace function public.public_booking_calendar_days(
  p_service_id uuid, p_month date
)
returns table(day date)
language sql stable security definer
set search_path = ''
as $$
  select calendar_day::date as day
  from pg_catalog.generate_series(
    pg_catalog.date_trunc('month',p_month::timestamp),
    (pg_catalog.date_trunc('month',p_month::timestamp) + interval '1 month' - interval '1 day'),
    interval '1 day'
  ) as days(calendar_day)
  where p_service_id is not null
    and p_month is not null
    and p_month >= (now() at time zone 'America/Toronto')::date - 31
    and p_month <= (now() at time zone 'America/Toronto')::date + 180
    and exists (
      select 1 from public.public_booking_slots(p_service_id,calendar_day::date)
    )
  order by calendar_day;
$$;

-- Allow only the anonymous/public calendar to read AVAILABLE DATE KEYS.
-- The function never returns customer names, counts, emails or appointments.
revoke all on function public.public_booking_calendar_days(uuid,date) from public;
grant execute on function public.public_booking_calendar_days(uuid,date) to anon,authenticated;
