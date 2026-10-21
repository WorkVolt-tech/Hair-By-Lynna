-- Hair by Lynna: customer response to an owner-proposed reschedule.
-- Safe to run: adds optional columns and a trigger; preserves existing appointments.
-- Old proposed times are retained for notification and review. No automatic cancellation.
alter table public.appointments
  add column if not exists reschedule_previous_starts_at timestamptz,
  add column if not exists reschedule_previous_ends_at timestamptz,
  add column if not exists reschedule_requested_at timestamptz,
  add column if not exists reschedule_responded_at timestamptz,
  add column if not exists reschedule_response text,
  add column if not exists reschedule_revision integer not null default 0,
  add column if not exists last_booking_event text;

-- Only these recorded responses are valid.
alter table public.appointments drop constraint if exists appointments_reschedule_response_check;
alter table public.appointments add constraint appointments_reschedule_response_check
  check (reschedule_response is null or reschedule_response in ('pending','confirmed','needs_contact'));

-- Determine the event from the actual OLD and NEW database row, instead of
-- relying on potentially incomplete old_record fields in Database Webhooks.
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
  else
    new.last_booking_event := null;
  end if;
  return new;
end $$;

drop trigger if exists track_appointment_changes on public.appointments;
create trigger track_appointment_changes
  before update on public.appointments
  for each row execute function public.track_appointment_changes();

-- Protect the confirmation trail against direct client write access.
-- The existing appointments RLS still applies. The customer can respond only
-- via the booking-status Edge Function with the private UUID and matching email.
-- Supabase service-role credentials stay server-side.
