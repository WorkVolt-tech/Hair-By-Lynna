-- Hair by Lynna: preserve the EN/FR language used when the customer books.
-- Run AFTER 021_booking_honeypot.sql. Safe for existing bookings (default EN).
-- IMPORTANT: the language is placed on the row BEFORE INSERT, so the INSERT
-- webhook cannot race ahead and send the wrong-language booking email.
-- The existing secure 8-argument honeypot endpoint stays available during rollout.
begin;

alter table public.appointments
  add column if not exists preferred_language text not null default 'en';

alter table public.appointments
  drop constraint if exists appointments_preferred_language_check;
alter table public.appointments
  add constraint appointments_preferred_language_check
  check (preferred_language in ('en','fr'));

create or replace function public.set_initial_booking_language()
returns trigger
language plpgsql
set search_path=''
as $$
declare requested_language text;
begin
  requested_language:=current_setting('lynna.booking_language',true);
  if requested_language in ('en','fr') then
    new.preferred_language:=requested_language;
  else
    new.preferred_language:='en';
  end if;
  return new;
end $$;

drop trigger if exists set_initial_booking_language on public.appointments;
create trigger set_initial_booking_language
before insert on public.appointments
for each row execute function public.set_initial_booking_language();

-- The 8-argument request_appointment from migration 021 is still responsible
-- for honeypot checks, booking limits, slot conflicts, and policy acceptance.
-- This new 9-argument signature stores only the language, securely and atomically.
do $check$
begin
  if to_regprocedure('public.request_appointment(uuid,date,time,text,text,text,boolean,text)') is null
     or to_regprocedure('public.request_appointment_core(uuid,date,time,text,text,text,boolean)') is null then
    raise exception 'Migration 021 must be applied before 023.';
  end if;
end $check$;

create or replace function public.request_appointment(
  p_service_id uuid,p_day date,p_time time,
  p_name text,p_email text,p_phone text,
  p_policy_accepted boolean,p_company_website text,
  p_language text
)
returns uuid
language plpgsql volatile security definer set search_path=''
as $$
begin
  if p_language is null or p_language not in ('en','fr') then
    raise exception 'INVALID_LANGUAGE' using errcode='22023';
  end if;
  -- Transaction-local; cannot leak to the next visitor's connection.
  perform set_config('lynna.booking_language',p_language,true);
  return public.request_appointment(
    p_service_id,p_day,p_time,p_name,p_email,p_phone,
    p_policy_accepted,p_company_website
  );
end $$;

revoke all on function public.request_appointment(
  uuid,date,time,text,text,text,boolean,text,text
) from public,anon,authenticated;
grant execute on function public.request_appointment(
  uuid,date,time,text,text,text,boolean,text,text
) to anon,authenticated;

notify pgrst,'reload schema';
commit;

-- Verify that new FR bookings contain preferred_language='fr' in Admin/SQL.
-- Existing appointments remain 'en' because we cannot reliably infer their
-- original browsing language from historic booking records.
