-- Hair by Lynna: owner-only permanent removal of completed/cancelled appointments.
-- Applying this migration changes ONLY the RPC definition; it deletes no appointments.
-- A completed appointment is one whose scheduled end time has passed.
create or replace function public.owner_delete_finished_appointment(p_appointment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_id uuid;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.admin_users u
    where u.user_id = (select auth.uid()) and u.role = 'owner'
  ) then
    raise exception 'OWNER_ONLY' using errcode = '42501';
  end if;

  if p_appointment_id is null then
    raise exception 'APPOINTMENT_ID_REQUIRED';
  end if;

  delete from public.appointments a
  where a.id = p_appointment_id
    and (
      a.status in ('cancelled', 'declined')
      or a.ends_at <= now()
    )
  returning a.id into removed_id;

  if removed_id is null then
    raise exception 'APPOINTMENT_NOT_ELIGIBLE_OR_NOT_FOUND';
  end if;

  return true;
end;
$$;

revoke all on function public.owner_delete_finished_appointment(uuid) from public, anon;
grant execute on function public.owner_delete_finished_appointment(uuid) to authenticated;
