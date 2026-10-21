-- Hair by Lynna: fix "DELETE requires a WHERE clause" in the
-- admin_clear_all_schedules RPC. Run in Supabase SQL Editor.
-- This REPLACES the function definition; running this migration does NOT
-- delete appointments or availability.
-- Actual deletion still requires a logged-in admin calling the RPC with
-- the exact confirmation phrase from the admin dashboard.
create or replace function public.admin_clear_all_schedules(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not exists (
       select 1 from public.admin_users
       where user_id = (select auth.uid())
     ) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  if p_confirmation is distinct from 'DELETE ALL APPOINTMENTS' then
    raise exception 'CONFIRMATION_REQUIRED';
  end if;

  -- An explicit WHERE satisfies databases enforcing safe deletes.
  -- IDs are non-null primary keys, so an authorized, confirmed reset
  -- still removes ALL appointments and availability, atomically.
  delete from public.appointments where id is not null;
  delete from public.availability where id is not null;
end;
$$;

revoke all on function public.admin_clear_all_schedules(text) from public, anon;
grant execute on function public.admin_clear_all_schedules(text) to authenticated;
