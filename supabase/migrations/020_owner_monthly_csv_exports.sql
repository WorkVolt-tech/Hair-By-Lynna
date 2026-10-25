-- Hair by Lynna: owner-only, paginated source for CSV exports.
-- Run AFTER 016_completed_appointments_and_final_payments.sql and
-- 019_owner_business_statistics.sql.
-- This function does NOT mutate bookings or expose public data.
-- The frontend downloads monthly CSVs locally without uploading data anywhere.

create or replace function public.owner_export_monthly_appointments(p_month date)
returns table (
  appointment_id uuid,
  customer_name text,
  customer_email text,
  service_name_en text,
  service_name_fr text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  completed_at timestamptz,
  service_price_cents integer,
  deposit_amount_cents integer,
  deposit_received_at timestamptz,
  final_payment_amount_cents integer,
  final_payment_received_at timestamptz
)
language plpgsql stable security definer
set search_path=''
as $$
declare
  period_start timestamptz;
  period_end timestamptz;
begin
  -- The RPC is callable only by an authenticated OWNER, regardless of
  -- frontend button visibility or broader appointment table policies.
  if (select auth.uid()) is null or not exists (
    select 1 from public.admin_users
    where user_id=(select auth.uid()) and role='owner'
  ) then
    raise exception 'OWNER_ONLY' using errcode='42501';
  end if;

  if p_month is null
     or p_month <> pg_catalog.date_trunc('month',p_month::timestamp)::date
     or p_month < date '2020-01-01'
     or p_month > date '2100-12-01'
  then
    raise exception 'INVALID_MONTH' using errcode='22023';
  end if;

  -- Day boundaries follow America/Toronto, including DST transitions.
  period_start := p_month::timestamp at time zone 'America/Toronto';
  period_end := (p_month + interval '1 month')::timestamp at time zone 'America/Toronto';

  return query
    select a.id,
           a.customer_name::text,
           a.customer_email::text,
           coalesce(s.name_en,'Service')::text,
           coalesce(s.name_fr,'Service')::text,
           a.starts_at,
           a.ends_at,
           a.status::text,
           a.completed_at,
           a.service_price_cents,
           a.deposit_amount_cents,
           a.deposit_received_at,
           a.final_payment_amount_cents,
           a.final_payment_received_at
    from public.appointments a
    left join public.services s on s.id=a.service_id
    where a.starts_at >= period_start and a.starts_at < period_end
    order by a.starts_at,a.id;
end;
$$;

revoke all on function public.owner_export_monthly_appointments(date)
  from public,anon,authenticated;
grant execute on function public.owner_export_monthly_appointments(date)
  to authenticated;

-- PostgREST/Supabase client can page this set with .range(0, 499),
-- .range(500, 999), ...; no 300-appointment UI or default 1000-row cutoff.
