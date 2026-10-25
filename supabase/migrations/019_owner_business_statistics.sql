-- Hair by Lynna — owner-only monthly business statistics.
-- Requires 016_completed_appointments_and_final_payments.sql (service price
-- snapshot + manual deposit/final-payment tracking).
-- This read-only aggregate returns no names, email addresses or appointment IDs.
-- All months are based on the appointment's scheduled date in Montréal.
-- Recorded cash is NOT bank-verified cash flow, profit, refunds or tax reporting.

create or replace function public.owner_monthly_business_statistics(p_month date)
returns jsonb
language plpgsql stable security definer
set search_path=''
as $$
declare
  result jsonb;
  period_start timestamptz;
  period_end timestamptz;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.admin_users
    where user_id=(select auth.uid()) and role='owner'
  ) then
    raise exception 'OWNER_ONLY' using errcode='42501';
  end if;
  if p_month is null
     or p_month <> date_trunc('month',p_month::timestamp)::date
     or p_month < date '2020-01-01'
     or p_month > date '2100-12-01'
  then
    raise exception 'INVALID_MONTH' using errcode='22023';
  end if;
  period_start := p_month::timestamp at time zone 'America/Toronto';
  period_end := (p_month + interval '1 month')::timestamp at time zone 'America/Toronto';

  with bookings as (
    select a.status,a.customer_email,a.service_id,a.service_price_cents,
      a.deposit_amount_cents,a.deposit_received_at,
      a.final_payment_amount_cents,a.final_payment_received_at
    from public.appointments a
    where a.starts_at >= period_start and a.starts_at < period_end
  ),
  overview as (
    select
      count(*)::integer as all_bookings,
      count(*) filter (where status='pending')::integer as pending,
      count(*) filter (where status='approved')::integer as approved,
      count(*) filter (where status='completed')::integer as completed,
      count(*) filter (where status='cancelled')::integer as cancelled,
      count(*) filter (where status='declined')::integer as declined,
      count(distinct lower(customer_email))
        filter (where status in ('pending','approved','completed'))::integer as clients,
      coalesce(sum(service_price_cents::bigint)
        filter (where status='completed'),0) as completed_service_value_cents,
      coalesce(sum(deposit_amount_cents::bigint)
        filter (where deposit_received_at is not null),0) as deposit_received_cents,
      coalesce(sum(final_payment_amount_cents::bigint)
        filter (where final_payment_received_at is not null and status='completed'),0) as final_received_cents,
      coalesce(sum(greatest(0,service_price_cents -
        (case when deposit_received_at is not null then deposit_amount_cents else 0 end) -
        (case when final_payment_received_at is not null then final_payment_amount_cents else 0 end))::bigint)
        filter (where status='completed'),0) as outstanding_completed_cents,
      count(*) filter (where status='completed' and
        service_price_cents >
          (case when deposit_received_at is not null then deposit_amount_cents else 0 end) +
          (case when final_payment_received_at is not null then final_payment_amount_cents else 0 end)
      )::integer as outstanding_completed_count
    from bookings
  ),
  popular as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'name_en', ranked.name_en,'name_fr',ranked.name_fr,
        'bookings',ranked.bookings,'completed',ranked.completed
      ) order by ranked.bookings desc, ranked.name_en),'[]'::jsonb) as styles
    from (
      select coalesce(s.name_en,'Service') as name_en,
        coalesce(s.name_fr,'Service') as name_fr,
        count(*)::integer as bookings,
        count(*) filter (where b.status='completed')::integer as completed
      from bookings b
      join public.services s on s.id=b.service_id
      where b.status in ('pending','approved','completed')
      group by b.service_id,s.name_en,s.name_fr
      order by count(*) desc, s.name_en
      limit 5
    ) ranked
  ),
  monthly_trend as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month',to_char(m.month_start,'YYYY-MM'),
      'completed',t.completed,
      'received_cents',t.received_cents
    ) order by m.month_start),'[]'::jsonb) as months
    from (
      select (p_month - (i.n * interval '1 month'))::date as month_start
      from generate_series(5,0,-1) as i(n)
    ) m
    cross join lateral (
      select
        count(*) filter (where a.status='completed')::integer as completed,
        (coalesce(sum(a.deposit_amount_cents::bigint)
          filter (where a.deposit_received_at is not null),0) +
         coalesce(sum(a.final_payment_amount_cents::bigint)
          filter (where a.status='completed' and a.final_payment_received_at is not null),0)
        ) as received_cents
      from public.appointments a
      where a.starts_at >= (m.month_start::timestamp at time zone 'America/Toronto')
        and a.starts_at < ((m.month_start + interval '1 month')::timestamp at time zone 'America/Toronto')
    ) t
  )
  select jsonb_build_object(
    'month',to_char(p_month,'YYYY-MM'),
    'all_bookings',o.all_bookings,
    'pending',o.pending,
    'approved',o.approved,
    'completed',o.completed,
    'cancelled',o.cancelled,
    'declined',o.declined,
    'clients',o.clients,
    'completed_service_value_cents',o.completed_service_value_cents,
    'deposit_received_cents',o.deposit_received_cents,
    'final_received_cents',o.final_received_cents,
    'total_received_cents',o.deposit_received_cents+o.final_received_cents,
    'outstanding_completed_cents',o.outstanding_completed_cents,
    'outstanding_completed_count',o.outstanding_completed_count,
    'top_styles',p.styles,
    'trend',t.months
  ) into result
  from overview o cross join popular p cross join monthly_trend t;

  return result;
end;
$$;

-- Only an authenticated caller can invoke the RPC; the function additionally
-- verifies that the caller has the owner's role before reading any data.
revoke all on function public.owner_monthly_business_statistics(date) from public,anon,authenticated;
grant execute on function public.owner_monthly_business_statistics(date) to authenticated;
