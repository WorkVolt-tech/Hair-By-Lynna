-- Hair by Lynna — 025: "Download & archive past appointments".
-- ALREADY APPLIED to Supabase on Oct 26, 2026. Kept here for history; do not rerun unless rebuilding the database.
-- One Excel download containing every appointment that has already ENDED,
-- then (only after Lynna confirms the file saved) delete exactly those rows.
--
-- Safety rules enforced in the database, not just the website:
--   * OWNER only (admin_users.role = 'owner'), same check as migrations 019/020.
--   * Only appointments whose ends_at is in the past. Upcoming or in-progress
--     appointments can never be exported for archive or deleted here.
--   * Delete only rows that are in the downloaded file, and only if they have
--     not changed since the download (row fingerprint must still match).
--   * Linked reminder / deposit-alert rows are removed by existing ON DELETE CASCADE.
--   * Deleting does NOT send any client email or Telegram alert.

-- Fingerprint of the fields written to the Excel file. If any of them changes
-- after the download (e.g. a payment is recorded), the row is NOT deleted.
create or replace function public.archive_row_version(a public.appointments)
returns text
language sql
immutable
set search_path to ''
as $$
  select md5(concat_ws('|',
    a.id::text, a.status::text, a.customer_name::text, a.customer_email::text,
    a.service_id::text, a.service_price_cents::text, a.deposit_amount_cents::text,
    a.final_payment_amount_cents::text,
    extract(epoch from a.starts_at)::text, extract(epoch from a.ends_at)::text,
    extract(epoch from a.completed_at)::text,
    extract(epoch from a.deposit_received_at)::text,
    extract(epoch from a.final_payment_received_at)::text
  ));
$$;
revoke all on function public.archive_row_version(public.appointments) from public, anon, authenticated;

-- 1) Rows for the Appointments and Payments tabs. Same columns as
--    owner_export_monthly_appointments, plus row_version for the safe delete.
create or replace function public.owner_export_past_appointments(p_cutoff timestamptz)
returns table(
  appointment_id uuid, customer_name text, customer_email text,
  service_name_en text, service_name_fr text,
  starts_at timestamptz, ends_at timestamptz, status text, completed_at timestamptz,
  service_price_cents integer, deposit_amount_cents integer, deposit_received_at timestamptz,
  final_payment_amount_cents integer, final_payment_received_at timestamptz,
  row_version text
)
language plpgsql
stable security definer
set search_path to ''
as $function$
#variable_conflict use_column
declare
  cutoff timestamptz;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.admin_users
    where user_id=(select auth.uid()) and role='owner'
  ) then
    raise exception 'OWNER_ONLY' using errcode='42501';
  end if;
  -- Never later than the database's own clock.
  cutoff := least(coalesce(p_cutoff, now()), now());

  return query
    select a.id,
           a.customer_name::text,
           a.customer_email::text,
           coalesce(s.name_en,'Service')::text,
           coalesce(s.name_fr,'Service')::text,
           a.starts_at, a.ends_at, a.status::text, a.completed_at,
           a.service_price_cents, a.deposit_amount_cents, a.deposit_received_at,
           a.final_payment_amount_cents, a.final_payment_received_at,
           public.archive_row_version(a)
    from public.appointments a
    left join public.services s on s.id=a.service_id
    where a.ends_at < cutoff
    order by a.starts_at, a.id;
end;
$function$;
revoke all on function public.owner_export_past_appointments(timestamptz) from public, anon;
grant execute on function public.owner_export_past_appointments(timestamptz) to authenticated;

-- 2) Statistics tab: ONE combined total for every past appointment in the file.
--    Same definitions as owner_monthly_business_statistics (migration 019),
--    without the six-month trend. "month" holds the period label (YYYY-MM – YYYY-MM).
create or replace function public.owner_past_business_statistics(p_cutoff timestamptz)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  result jsonb;
  cutoff timestamptz;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.admin_users
    where user_id=(select auth.uid()) and role='owner'
  ) then
    raise exception 'OWNER_ONLY' using errcode='42501';
  end if;
  cutoff := least(coalesce(p_cutoff, now()), now());

  with bookings as (
    select a.status,a.customer_email,a.service_id,a.service_price_cents,a.starts_at,
      a.deposit_amount_cents,a.deposit_received_at,
      a.final_payment_amount_cents,a.final_payment_received_at
    from public.appointments a
    where a.ends_at < cutoff
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
      coalesce(sum(service_price_cents::bigint) filter (where status='completed'),0) as completed_service_value_cents,
      coalesce(sum(deposit_amount_cents::bigint) filter (where deposit_received_at is not null),0) as deposit_received_cents,
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
      )::integer as outstanding_completed_count,
      to_char(min(starts_at) at time zone 'America/Toronto','YYYY-MM') as first_month,
      to_char(max(starts_at) at time zone 'America/Toronto','YYYY-MM') as last_month
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
  )
  select jsonb_build_object(
    'month', case when o.first_month is null then ''
                  when o.first_month=o.last_month then o.first_month
                  else o.first_month||' – '||o.last_month end,
    'first_month',o.first_month,
    'last_month',o.last_month,
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
    'trend','[]'::jsonb
  ) into result
  from overview o cross join popular p;

  return result;
end;
$function$;
revoke all on function public.owner_past_business_statistics(timestamptz) from public, anon;
grant execute on function public.owner_past_business_statistics(timestamptz) to authenticated;

-- 3) Delete ONLY the rows from the downloaded file, ONLY if they are still past
--    and unchanged. p_rows = [{"id":"<uuid>","v":"<row_version>"}, ...]
create or replace function public.owner_delete_archived_appointments(p_rows jsonb)
returns jsonb
language plpgsql
volatile security definer
set search_path to ''
as $function$
declare
  requested integer;
  deleted integer;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.admin_users
    where user_id=(select auth.uid()) and role='owner'
  ) then
    raise exception 'OWNER_ONLY' using errcode='42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'INVALID_ROWS' using errcode='22023';
  end if;
  requested := jsonb_array_length(p_rows);
  if requested=0 then
    return jsonb_build_object('requested',0,'deleted',0,'kept',0);
  end if;
  if requested>25000 then
    raise exception 'TOO_MANY_ROWS' using errcode='22023';
  end if;

  with input as (
    select distinct (e->>'id')::uuid as id, e->>'v' as v
    from jsonb_array_elements(p_rows) e
    where e ? 'id' and e ? 'v'
  ),
  removed as (
    delete from public.appointments a
    using input i
    where a.id=i.id
      and a.ends_at < now()
      and public.archive_row_version(a)=i.v
    returning a.id
  )
  select count(*)::integer into deleted from removed;

  return jsonb_build_object('requested',requested,'deleted',deleted,'kept',requested-deleted);
end;
$function$;
revoke all on function public.owner_delete_archived_appointments(jsonb) from public, anon;
grant execute on function public.owner_delete_archived_appointments(jsonb) to authenticated;
