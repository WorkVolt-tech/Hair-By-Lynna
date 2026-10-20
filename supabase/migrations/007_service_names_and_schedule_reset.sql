-- Run in Supabase SQL editor.
-- Rename existing Knotless service to Micro Knots and unpublish Cornrows.
update public.services
set name_en='Micro Knots', name_fr='Micro nœuds'
where lower(trim(name_en))='knotless braids';
update public.services set active=false
where lower(trim(name_en))='cornrows';

-- DESTRUCTIVE ACTION: callable only by authorized administrators.
-- This removes ALL appointments and ALL published availability in one transaction.
-- Services and administrator accounts remain untouched.
create or replace function public.admin_clear_all_schedules(p_confirmation text)
returns void language plpgsql security definer
set search_path = '' as $$
begin
 if (select auth.uid()) is null
 or not exists (select 1 from public.admin_users where user_id=(select auth.uid())) then
  raise exception 'NOT_AUTHORIZED' using errcode='42501';
 end if;
 if p_confirmation is distinct from 'DELETE ALL APPOINTMENTS' then
  raise exception 'CONFIRMATION_REQUIRED';
 end if;
 delete from public.appointments;
 delete from public.availability;
end $$;
revoke all on function public.admin_clear_all_schedules(text) from public, anon;
grant execute on function public.admin_clear_all_schedules(text) to authenticated;
