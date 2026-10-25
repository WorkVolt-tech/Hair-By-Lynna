-- Hair by Lynna: manually verified Interac e-Transfer deposit tracking.
-- The current published policy is $20 CAD, non-refundable and applied to the bill.
-- Run AFTER migration 014. This does not alter booking/availability decisions.
-- Existing appointments start with deposit "Not received" until Lynna verifies payment.
alter table public.appointments
  add column if not exists deposit_amount_cents integer not null default 2000,
  add column if not exists deposit_received_at timestamptz,
  add column if not exists deposit_received_by uuid;

alter table public.appointments drop constraint if exists appointments_deposit_amount_check;
alter table public.appointments add constraint appointments_deposit_amount_check
  check (deposit_amount_cents >= 0 and deposit_amount_cents <= 100000);

-- Keep appointment event detection intact; detect both confirmed and corrected deposits
-- using the actual old/new row (Database Webhooks may not include all old columns).
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

-- This function is the only payment-verification action used by the admin UI.
-- No customer can confirm their own payment and no automatic bank verification occurs.
create or replace function public.admin_set_deposit_received(
  p_appointment_id uuid, p_received boolean
)
returns boolean
language plpgsql security definer set search_path='' as $$
declare
  affected_id uuid;
begin
  if (select auth.uid()) is null or not exists(
     select 1 from public.admin_users
     where user_id=(select auth.uid()) and role in ('owner','tester')
  ) then
    raise exception 'ADMIN_ONLY' using errcode='42501';
  end if;
  if p_appointment_id is null or p_received is null then
    raise exception 'INVALID_ARGUMENT' using errcode='22023';
  end if;
  -- When already in the desired state, leave the row alone: no duplicate notifications.
  update public.appointments a
    set deposit_received_at=case when p_received then now() else null end,
        deposit_received_by=case when p_received then (select auth.uid()) else null end
    where a.id=p_appointment_id
      and (a.deposit_received_at is not null) is distinct from p_received
    returning a.id into affected_id;
  if affected_id is null and not exists(
     select 1 from public.appointments a where a.id=p_appointment_id
  ) then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode='P0002';
  end if;
  return p_received;
end $$;
revoke all on function public.admin_set_deposit_received(uuid,boolean) from public,anon;
grant execute on function public.admin_set_deposit_received(uuid,boolean) to authenticated;
