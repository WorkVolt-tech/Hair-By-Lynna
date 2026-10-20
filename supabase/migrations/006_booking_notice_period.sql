-- 24-hour booking lead time enforced by Postgres, not just the browser.
-- Replaces the earlier functions without removing active appointments.
create or replace function public.public_booking_slots(p_service_id uuid, p_day date)
returns table (slot_time time)
language plpgsql stable security definer set search_path = ''
as $$
declare
  duration_mins integer;
  a record;
  candidate timestamp without time zone;
  endpoint timestamp without time zone;
  start_instant timestamptz;
  end_instant timestamptz;
begin
  select s.duration_minutes into duration_mins
  from public.services s where s.id = p_service_id and s.active;
  if duration_mins is null then return; end if;
  if p_day < (now() at time zone 'America/Toronto')::date
     or p_day > (now() at time zone 'America/Toronto')::date + 180 then return; end if;
  for a in select start_time,end_time from public.availability
    where date = p_day and enabled loop
    candidate := p_day + a.start_time;
    endpoint := p_day + a.end_time;
    candidate := date_trunc('hour',candidate) +
      make_interval(mins => (ceil(extract(minute from candidate)/30.0)::int * 30));
    while candidate + make_interval(mins=>duration_mins) <= endpoint loop
      start_instant := candidate at time zone 'America/Toronto';
      end_instant := (candidate+make_interval(mins=>duration_mins)) at time zone 'America/Toronto';
      if start_instant >= now()+interval '24 hours' and not exists (
        select 1 from public.appointments b
        where b.status in ('pending','approved')
          and tstzrange(b.starts_at,b.ends_at,'[)') &&
              tstzrange(start_instant,end_instant,'[)')
      ) then
        slot_time := candidate::time;
        return next;
      end if;
      candidate := candidate + interval '30 minutes';
    end loop;
  end loop;
end $$;
revoke all on function public.public_booking_slots(uuid,date) from public;
grant execute on function public.public_booking_slots(uuid,date) to anon, authenticated;

-- Admin-only status transitions remain restricted by existing RLS.
-- No anonymous INSERT/UPDATE policy or public booking RPC is created here.

create or replace function public.request_appointment(
  p_service_id uuid, p_day date, p_time time,
  p_name text, p_email text, p_phone text, p_policy_accepted boolean
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_duration integer;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
  v_name text := btrim(coalesce(p_name,''));
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_phone text := nullif(btrim(coalesce(p_phone,'')),'');
begin
  if p_policy_accepted is distinct from true then
    raise exception 'POLICY_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 or length(v_name) > 100 or
     length(v_email) > 254 or
     v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' or
     length(coalesce(v_phone,'')) > 35 then
     raise exception 'INVALID_DETAILS' using errcode = 'P0001';
  end if;
  if p_day is null or p_time is null or p_day < (now() at time zone 'America/Toronto')::date
    or p_day > (now() at time zone 'America/Toronto')::date + 180 then
    raise exception 'INVALID_DATE' using errcode='P0001';
  end if;
  if extract(second from p_time) <> 0 or extract(minute from p_time)::int % 30 <> 0 then
    raise exception 'INVALID_TIME' using errcode='P0001';
  end if;
  select duration_minutes into v_duration from public.services where id=p_service_id and active=true;
  if v_duration is null then raise exception 'INVALID_SERVICE' using errcode='P0001'; end if;
  v_start := (p_day + p_time) at time zone 'America/Toronto';
  v_end := (p_day + p_time + make_interval(mins=>v_duration)) at time zone 'America/Toronto';
  if v_start < now()+interval '24 hours' or not exists (
    select 1 from public.availability a
    where a.date=p_day and a.enabled
      and p_time>=a.start_time
      and (p_day + p_time + make_interval(mins=>v_duration)) <= (p_day + a.end_time)
  ) then raise exception 'TIME_UNAVAILABLE' using errcode='P0001'; end if;
  -- Basic per-email/global request limits. Captcha and stronger anti-abuse are still advised.
  if (select count(*) from public.appointments a where lower(a.customer_email)=v_email
      and a.created_at > now()-interval '24 hours') >= 3 or
     (select count(*) from public.appointments a where a.created_at > now()-interval '1 hour') >= 80 then
    raise exception 'RATE_LIMITED' using errcode='P0001';
  end if;
  insert into public.appointments
    (service_id,customer_name,customer_email,customer_phone,starts_at,ends_at,status)
  values(p_service_id,v_name,v_email,v_phone,v_start,v_end,'pending')
  returning id into v_id;
  return v_id;
exception
  when exclusion_violation then
    raise exception 'TIME_UNAVAILABLE' using errcode='P0001';
end $$;
revoke all on function public.request_appointment(uuid,date,time,text,text,text,boolean) from public;
grant execute on function public.request_appointment(uuid,date,time,text,text,text,boolean) to anon, authenticated;
-- No public SELECT policy: customer details can only be read by admins.

