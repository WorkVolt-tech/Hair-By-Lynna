-- Secure rescheduling for approved appointments. Run in Supabase SQL Editor.
-- Does not change appointment status or notify customers automatically.
create or replace function public.admin_reschedule_appointment(
  p_appointment_id uuid, p_day date, p_time time
) returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
 v_appointment public.appointments%rowtype;
 v_duration interval;
 v_start timestamptz;
 v_end timestamptz;
begin
 if not exists(select 1 from public.admin_users where user_id=(select auth.uid())) then
   raise exception 'NOT_AUTHORIZED' using errcode='42501';
 end if;
 select * into v_appointment from public.appointments
 where id=p_appointment_id and status='approved' for update;
 if not found then raise exception 'APPROVED_APPOINTMENT_NOT_FOUND'; end if;
 if p_day is null or p_time is null or p_day < (now() at time zone 'America/Toronto')::date
   or p_day > (now() at time zone 'America/Toronto')::date+180
   or extract(second from p_time) <> 0
   or mod(extract(minute from p_time)::integer,30) <> 0 then
   raise exception 'INVALID_DATE_OR_TIME';
 end if;
 v_duration:=v_appointment.ends_at-v_appointment.starts_at;
 v_start:=(p_day+p_time) at time zone 'America/Toronto';
 v_end:=(p_day+p_time+v_duration) at time zone 'America/Toronto';
 if v_start<=now() then raise exception 'TIME_IN_PAST'; end if;
 if not exists (
   select 1 from public.availability a where a.date=p_day and a.enabled
   and (p_day+p_time)>=p_day+a.start_time
   and (p_day+p_time+v_duration)<=p_day+a.end_time
 ) then raise exception 'OUTSIDE_AVAILABILITY'; end if;
 update public.appointments set starts_at=v_start,ends_at=v_end
 where id=p_appointment_id;
 -- appointments_no_active_overlap exclusion constraint rejects collisions.
exception when exclusion_violation then
 raise exception 'TIME_ALREADY_BOOKED' using errcode='P0001';
end $$;
revoke all on function public.admin_reschedule_appointment(uuid,date,time) from public,anon;
grant execute on function public.admin_reschedule_appointment(uuid,date,time) to authenticated;
