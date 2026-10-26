-- Hair by Lynna: deposit deadline tracking and verified customer "I've sent it" reports.
-- Apply AFTER migration 015 (and preferably 021). Independent of 12-hour reminders.
-- No bank verification or automatic cancellation: only Lynna can confirm payment.
-- Applies to bookings created AFTER activation, avoiding historic notification floods.
-- Original deadline is snapshotted at request creation: <=48h away => 2h; else 24h.
begin;

alter table public.appointments
  add column if not exists deposit_due_at timestamptz,
  add column if not exists deposit_reported_sent_at timestamptz;

create or replace function public.set_initial_deposit_deadline()
returns trigger language plpgsql set search_path='' as $$
begin
  -- Don't reset an existing deadline when Lynna changes the appointment date.
  if new.deposit_due_at is null then
    new.deposit_due_at := new.created_at + case
      when new.starts_at <= new.created_at + interval '48 hours'
        then interval '2 hours' else interval '24 hours' end;
  end if;
  return new;
end $$;
drop trigger if exists set_initial_deposit_deadline on public.appointments;
create trigger set_initial_deposit_deadline
before insert on public.appointments
for each row execute function public.set_initial_deposit_deadline();

create table if not exists public.deposit_deadline_alert_settings (
  id integer primary key check(id=1),
  activated_at timestamptz not null default now()
);
insert into public.deposit_deadline_alert_settings(id) values(1)
on conflict(id) do nothing;
alter table public.deposit_deadline_alert_settings enable row level security;
revoke all on public.deposit_deadline_alert_settings from public,anon,authenticated;
grant select on public.deposit_deadline_alert_settings to service_role;

-- Only the service-role-backed booking-status Edge Function can record a claim,
-- and ONLY for the matching booking+email. This is NOT payment confirmation.
create or replace function public.customer_report_deposit_sent(
  p_appointment_id uuid,p_booking_email text
)
returns timestamptz
language plpgsql volatile security definer set search_path='' as $$
declare reported_at timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_ONLY' using errcode='42501';
  end if;
  if p_appointment_id is null or p_booking_email is null then
    raise exception 'INVALID_ARGUMENT' using errcode='22023';
  end if;
  update public.appointments as a
    set deposit_reported_sent_at=coalesce(a.deposit_reported_sent_at,now())
  where a.id=p_appointment_id
    and lower(btrim(a.customer_email))=lower(btrim(p_booking_email))
    and a.status in ('pending','approved')
    and a.deposit_received_at is null
    and a.deposit_due_at is not null
  returning a.deposit_reported_sent_at into reported_at;
  return reported_at;
end $$;
revoke all on function public.customer_report_deposit_sent(uuid,text)
  from public,anon,authenticated;
grant execute on function public.customer_report_deposit_sent(uuid,text) to service_role;

create table if not exists public.deposit_deadline_alerts (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  notice_kind text not null check(notice_kind in ('customer_5min','owner_reported','owner_overdue')),
  state text not null default 'processing'
    check(state in ('processing','sent','skipped','failed')),
  attempts integer not null default 1 check(attempts between 1 and 10),
  claimed_at timestamptz not null default now(),
  locked_until timestamptz not null default now()+interval '2 minutes',
  sent_at timestamptz,
  last_error text,
  unique(appointment_id,notice_kind)
);
-- If an early version of this migration was already run, expand the
-- notice-kind check without dropping any existing reminder log rows.
alter table public.deposit_deadline_alerts
  drop constraint if exists deposit_deadline_alerts_notice_kind_check;
alter table public.deposit_deadline_alerts
  add constraint deposit_deadline_alerts_notice_kind_check
  check(notice_kind in ('customer_5min','owner_reported','owner_overdue'));

create index if not exists deposit_deadline_alerts_retry_idx
  on public.deposit_deadline_alerts(state,locked_until);
alter table public.deposit_deadline_alerts enable row level security;
revoke all on public.deposit_deadline_alerts from public,anon,authenticated;
grant all on public.deposit_deadline_alerts to service_role;
grant usage,select on sequence public.deposit_deadline_alerts_id_seq to service_role;

create or replace function public.claim_due_deposit_deadline_alerts(p_limit integer default 20)
returns table(notice_id bigint,appointment_id uuid,notice_kind text,due_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare candidate record; recorded record;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_ONLY' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'INVALID_LIMIT' using errcode='22023';
  end if;
  for candidate in
    select a.id,a.deposit_due_at as deadline,event.kind
    from public.appointments a
    cross join public.deposit_deadline_alert_settings cfg
    cross join lateral (values
      ('customer_5min'::text,a.deposit_due_at-interval '5 minutes',a.deposit_due_at),
      ('owner_reported'::text,a.deposit_reported_sent_at,
                             a.deposit_reported_sent_at+interval '48 hours'),
      ('owner_overdue'::text,a.deposit_due_at,a.deposit_due_at+interval '48 hours')
    ) as event(kind,window_begin,window_end)
    left join public.deposit_deadline_alerts n
      on n.appointment_id=a.id and n.notice_kind=event.kind
    where cfg.id=1 and a.created_at>=cfg.activated_at
      and a.deposit_due_at is not null
      and a.status in ('pending','approved')
      and a.deposit_received_at is null
      and a.starts_at>now()
      and event.window_begin is not null
      and now()>=event.window_begin and now()<event.window_end
      and (event.kind<>'customer_5min' or a.deposit_reported_sent_at is null)
      and (n.id is null or (n.state in ('failed','processing')
                            and n.locked_until<=now() and n.attempts<4))
    order by event.window_begin,a.id
    limit p_limit
    for update of a skip locked
  loop
    insert into public.deposit_deadline_alerts as existing
      (appointment_id,notice_kind,state,attempts,claimed_at,locked_until,last_error,sent_at)
    values(candidate.id,candidate.kind,'processing',1,now(),now()+interval '2 minutes',null,null)
    on conflict(appointment_id,notice_kind) do update
      set state='processing',attempts=existing.attempts+1,
          claimed_at=now(),locked_until=now()+interval '2 minutes',
          last_error=null,sent_at=null
      where existing.state in ('processing','failed')
        and existing.locked_until<=now() and existing.attempts<4
    returning existing.id,existing.appointment_id,existing.notice_kind into recorded;
    if found then
      notice_id:=recorded.id;
      appointment_id:=recorded.appointment_id;
      notice_kind:=recorded.notice_kind;
      due_at:=candidate.deadline;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.claim_due_deposit_deadline_alerts(integer)
  from public,anon,authenticated;
grant execute on function public.claim_due_deposit_deadline_alerts(integer) to service_role;

create or replace function public.finish_deposit_deadline_alert(
  p_notice_id bigint,p_outcome text,p_error text default null
)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_ONLY' using errcode='42501';
  end if;
  if p_notice_id is null or p_outcome not in ('sent','failed','skipped') then
    raise exception 'INVALID_ARGUMENT' using errcode='22023';
  end if;
  update public.deposit_deadline_alerts as n set
    state=p_outcome,
    sent_at=case when p_outcome='sent' then now() else null end,
    locked_until=case when p_outcome='failed' then now()+interval '2 minutes' else now() end,
    last_error=case when p_outcome='failed' then left(coalesce(p_error,'delivery failed'),160) else null end
  where n.id=p_notice_id and n.state='processing';
  if not found then
    raise exception 'NOTICE_NOT_FOUND_OR_CLOSED' using errcode='P0002';
  end if;
end $$;
revoke all on function public.finish_deposit_deadline_alert(bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.finish_deposit_deadline_alert(bigint,text,text)
  to service_role;

notify pgrst,'reload schema';
commit;
