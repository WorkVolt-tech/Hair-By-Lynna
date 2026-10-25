-- Hair by Lynna: completed appointments, paged history and manually recorded final payments.
-- Requires 015_deposit_tracking.sql. Does not delete or duplicate appointments.
-- Admins can read records under the existing RLS policy; financial actions are OWNER ONLY.

-- Retain the original service price as booked. Price edits to services will not
-- change the appointment amount in future reporting.
alter table public.appointments
  add column if not exists service_price_cents integer,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid,
  add column if not exists final_payment_amount_cents integer,
  add column if not exists final_payment_received_at timestamptz,
  add column if not exists final_payment_received_by uuid;

-- Existing appointments did not previously record their price at booking time.
-- For these legacy rows this captures the service's CURRENT price as a best-effort
-- historical estimate. No automatic payments are marked as received.
update public.appointments a set service_price_cents = s.price_cents
from public.services s
where a.service_id=s.id and a.service_price_cents is null;

alter table public.appointments alter column service_price_cents set not null;
alter table public.appointments drop constraint if exists appointments_price_snapshot_check;
alter table public.appointments add constraint appointments_price_snapshot_check
  check (service_price_cents >= 0 and service_price_cents <= 10000000);
alter table public.appointments drop constraint if exists appointments_final_payment_amount_check;
alter table public.appointments add constraint appointments_final_payment_amount_check
  check (final_payment_amount_cents is null or final_payment_amount_cents between 0 and 10000000);
alter table public.appointments drop constraint if exists appointments_final_payment_consistency;
alter table public.appointments add constraint appointments_final_payment_consistency
  check ((final_payment_received_at is null) = (final_payment_amount_cents is null)
    and (final_payment_received_at is null or status = 'completed'));
alter table public.appointments drop constraint if exists appointments_completion_consistency;
alter table public.appointments add constraint appointments_completion_consistency
  check ((status = 'completed') = (completed_at is not null));

-- The original status constraint was created by migration 001.
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('pending','approved','declined','cancelled','completed'));

-- Snapshot new bookings on INSERT; cannot be set by a customer-submitted price.
create or replace function public.capture_appointment_service_price()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select s.price_cents into new.service_price_cents
  from public.services s where s.id=new.service_id;
  if new.service_price_cents is null then
    raise exception 'SERVICE_NOT_FOUND' using errcode='P0002';
  end if;
  return new;
end $$;
drop trigger if exists capture_appointment_service_price on public.appointments;
create trigger capture_appointment_service_price before insert on public.appointments
  for each row execute function public.capture_appointment_service_price();

-- Protect new financial fields even though legacy admin RLS allows tester edits
-- to normal scheduling fields. The owner-only RPCs below perform the changes.
create or replace function public.protect_appointment_financial_history()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.service_price_cents is distinct from old.service_price_cents then
    raise exception 'BOOKED_PRICE_IMMUTABLE' using errcode='42501';
  end if;
  if (new.status='completed' and old.status is distinct from new.status)
    or new.completed_at is distinct from old.completed_at
    or new.completed_by is distinct from old.completed_by
    or new.final_payment_received_at is distinct from old.final_payment_received_at
    or new.final_payment_amount_cents is distinct from old.final_payment_amount_cents
    or new.final_payment_received_by is distinct from old.final_payment_received_by
  then
    if coalesce((select auth.role()),'') <> 'service_role'
      and not exists (select 1 from public.admin_users
         where user_id=(select auth.uid()) and role='owner') then
      raise exception 'OWNER_ONLY' using errcode='42501';
    end if;
  end if;
  if old.status='completed' and new.status<>'completed' then
    raise exception 'COMPLETED_APPOINTMENT_IMMUTABLE' using errcode='P0001';
  end if;
  if new.status='completed' and old.status<>'completed' and
      (old.status<>'approved' or old.ends_at>now() or new.completed_at is null) then
    raise exception 'APPOINTMENT_NOT_READY_TO_COMPLETE' using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists protect_appointment_financial_history on public.appointments;
create trigger protect_appointment_financial_history before update on public.appointments
  for each row execute function public.protect_appointment_financial_history();

-- Keep all 015 reschedule/deposit event logic unchanged.
-- Completion and final-payment updates are internal accounting events; no
-- booking-event notification is emitted (customer emails are not sent).
create or replace function public.track_appointment_changes()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at then
    new.reschedule_previous_starts_at := old.starts_at;
    new.reschedule_previous_ends_at := old.ends_at;
    new.reschedule_requested_at := now();
    new.reschedule_responded_at := null;
    new.reschedule_response := 'pending';
    new.reschedule_revision := old.reschedule_revision + 1;
    new.last_booking_event := 'rescheduled';
  elsif new.status is distinct from old.status then
    new.last_booking_event := case new.status
      when 'approved' then 'approved'
      when 'declined' then 'declined'
      when 'cancelled' then 'cancelled'
      else null
    end;
  elsif new.reschedule_response is distinct from old.reschedule_response then
    if old.reschedule_response = 'pending'
       and new.reschedule_response in ('confirmed','needs_contact')
       and new.status = 'approved' then
      new.reschedule_responded_at := now();
      new.last_booking_event := case new.reschedule_response
        when 'confirmed' then 'reschedule_confirmed'
        when 'needs_contact' then 'reschedule_needs_contact'
      end;
    else
      raise exception 'INVALID_RESCHEDULE_RESPONSE' using errcode='P0001';
    end if;
  elsif new.deposit_received_at is distinct from old.deposit_received_at then
    new.last_booking_event := case
      when old.deposit_received_at is null and new.deposit_received_at is not null then 'deposit_received'
      when old.deposit_received_at is not null and new.deposit_received_at is null then 'deposit_unconfirmed'
      else null
    end;
  else
    new.last_booking_event := null;
  end if;
  return new;
end $$;

create or replace function public.owner_complete_appointment(p_appointment_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected_id uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.admin_users
    where user_id=(select auth.uid()) and role='owner'
  ) then raise exception 'OWNER_ONLY' using errcode='42501'; end if;
  if p_appointment_id is null then raise exception 'INVALID_ARGUMENT' using errcode='22023'; end if;
  update public.appointments a
  set status='completed', completed_at=now(), completed_by=(select auth.uid())
  where a.id=p_appointment_id and a.status='approved' and a.ends_at<=now()
  returning a.id into affected_id;
  if affected_id is null then
    raise exception 'APPOINTMENT_NOT_READY_TO_COMPLETE' using errcode='P0001';
  end if;
  return true;
end $$;
revoke all on function public.owner_complete_appointment(uuid) from public,anon;
grant execute on function public.owner_complete_appointment(uuid) to authenticated;

create or replace function public.owner_set_final_payment_received(
  p_appointment_id uuid,p_received boolean
)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected_id uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.admin_users
    where user_id=(select auth.uid()) and role='owner'
  ) then raise exception 'OWNER_ONLY' using errcode='42501'; end if;
  if p_appointment_id is null or p_received is null then
    raise exception 'INVALID_ARGUMENT' using errcode='22023';
  end if;
  -- Record precisely the balance due when Lynna confirms receipt.
  -- Nothing is charged or transferred automatically.
  update public.appointments a
  set final_payment_amount_cents=case when p_received then
        greatest(0,a.service_price_cents -
          case when a.deposit_received_at is not null then a.deposit_amount_cents else 0 end)
        else null end,
      final_payment_received_at=case when p_received then now() else null end,
      final_payment_received_by=case when p_received then (select auth.uid()) else null end
  where a.id=p_appointment_id and a.status='completed'
    and (a.final_payment_received_at is not null) is distinct from p_received
  returning a.id into affected_id;
  if affected_id is null and not exists (
    select 1 from public.appointments a where a.id=p_appointment_id and a.status='completed'
  ) then raise exception 'COMPLETED_APPOINTMENT_NOT_FOUND' using errcode='P0002'; end if;
  return p_received;
end $$;
revoke all on function public.owner_set_final_payment_received(uuid,boolean) from public,anon;
grant execute on function public.owner_set_final_payment_received(uuid,boolean) to authenticated;

-- Fast archive retrieval without duplicating data.
create index if not exists appointments_archive_starts_idx
  on public.appointments(starts_at desc)
  where status in ('completed','declined','cancelled');
