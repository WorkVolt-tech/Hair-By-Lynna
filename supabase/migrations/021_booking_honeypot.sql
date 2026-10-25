-- Hair by Lynna: server-verified honeypot for anonymous booking submissions.
-- Run AFTER migration 006_booking_notice_period.sql and 012_one_client_per_day.sql.
-- Deploy the matching CustomerBooking.jsx frontend BEFORE running this SQL.
-- No existing appointments, times, prices, notifications or rate limits are changed.
--
-- Security: keep the original 7-argument validated booking function private
-- under a new name, and expose only an 8-argument wrapper that verifies the
-- honeypot before any appointment row can be inserted.
-- The renamed core retains its original validation, 24-hour notice, per-email
-- and global rate limits, and existing database triggers for day/slot conflicts.
-- Run all statements as one atomic transaction so an error cannot leave the
-- legacy RPC renamed without its new public wrapper.

begin;

do $honeypot$
begin
  if to_regprocedure('public.request_appointment_core(uuid,date,time,text,text,text,boolean)') is null then
    if to_regprocedure('public.request_appointment(uuid,date,time,text,text,text,boolean)') is null then
      raise exception 'Original request_appointment function is missing. Run booking migrations first.';
    end if;
    execute 'alter function public.request_appointment(uuid,date,time,text,text,text,boolean) rename to request_appointment_core';
  end if;
end
$honeypot$;

-- The original 7-argument endpoint MUST NOT be callable by web visitors;
-- otherwise bots could skip the honeypot by using the old API signature.
revoke all on function public.request_appointment_core(
  uuid,date,time,text,text,text,boolean
) from public,anon,authenticated;

-- This is the only public entry point. p_company_website must be sent as an
-- empty string by real visitors; simple bots typically fill the hidden field.
-- No default argument is provided, so callers cannot silently omit the check.
create or replace function public.request_appointment(
  p_service_id uuid, p_day date, p_time time,
  p_name text, p_email text, p_phone text,
  p_policy_accepted boolean, p_company_website text
)
returns uuid
language plpgsql volatile security definer
set search_path=''
as $$
begin
  if p_company_website is distinct from '' then
    -- Never create an appointment or trigger customer/owner notifications.
    -- Give no hint to automated callers which field caused the rejection.
    raise exception 'REQUEST_REJECTED' using errcode='P0001';
  end if;

  return public.request_appointment_core(
    p_service_id,p_day,p_time,p_name,p_email,p_phone,p_policy_accepted
  );
end
$$;

revoke all on function public.request_appointment(
  uuid,date,time,text,text,text,boolean,text
) from public,anon,authenticated;
grant execute on function public.request_appointment(
  uuid,date,time,text,text,text,boolean,text
) to anon,authenticated;

commit;

-- Optional permission check in SQL Editor:
-- select proname,pronargs,
--        has_function_privilege('anon',oid,'EXECUTE') as anonymous_can_execute
-- from pg_proc
-- where pronamespace='public'::regnamespace
--   and proname in ('request_appointment','request_appointment_core')
-- order by proname;
--
-- Expected: request_appointment (8 arguments) = true;
--           request_appointment_core (7 arguments) = false.
--
-- Limitation: honeypots stop simple form-filling bots, not targeted bots that
-- deliberately keep the field empty. Existing rate limits remain essential.
