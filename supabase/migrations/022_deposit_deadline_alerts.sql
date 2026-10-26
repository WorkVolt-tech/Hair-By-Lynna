-- Hair by Lynna: 5-minute customer warning + overdue owner Telegram review.
-- Run AFTER 015_deposit_tracking.sql. Does not automatically cancel bookings,
-- mark deposits received, charge clients, or change the booking function.
-- Deadlines are fixed at REQUEST CREATION, not recalculated on reschedule:
-- starts_at <= created_at + 48h: 2h; otherwise: 24h.
-- Applies to NEW pending requests after activation, to avoid retroactive spam.

begin;

create table if not exists public.deposit_deadline_alert_settings (
  id integer primary key check(id=1),
  activated_at timestamptz not null default now()
);
insert into public.deposit_deadline_alert_settings(id) values(1)
on conflict(id) do nothing;
alter table public.deposit_deadline_alert_settings enable row level security;
revoke all on public.deposit_deadline_alert_settings from public,anon,authenticated;
grant select on public.deposit_deadline_alert_settings to service_role;

create table if not exists public.deposit_deadline_alerts (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  notice_kind text not null check(notice_kind in ('customer_5min','owner_overdue')),
  state text not null default 'processing'
    check(state in ('processing','sent','skipped','failed')),
  attempts integer not null default 1 check(attempts between 1 and 10),
  claimed_at timestamptz not null default now(),
  locked_until timestamptz not null default now()+interval '2 minutes',
  sent_at timestamptz,
  last_error text,
  unique(appointment_id,notice_kind)
);
create index if not exists deposit_deadline_alerts_retry_idx
  on public.deposit_deadline_alerts(state,locked_until);
alter table public.deposit_deadline_alerts enable row level security;
revoke all on public.deposit_deadline_alerts from public,anon,authenticated;
grant all on public.deposit_deadline_alerts to service_role;
grant usage,select on sequence public.deposit_deadline_alerts_id_seq to service_role;

create or replace function public.claim_due_deposit_deadline_alerts(p_limit integer default 20)
returns table(notice_id bigint,appointment_id uuid,notice_kind text,due_at timestamptz)
language plpgsql volatile security definer set search_path=''
as $$
declare
  candidate record;
  recorded record;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_ONLY' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'INVALID_LIMIT' using errcode='22023';
  end if;

  for candidate in
    select a.id,d.deadline,
      case when now()<d.deadline then 'customer_5min' else 'owner_overdue' end::text as kind
    from public.appointments a
    cross join public.deposit_deadline_alert_settings cfg
    cross join lateral (
      select a.created_at + case
        when a.starts_at<=a.created_at+interval '48 hours'
          then interval '2 hours' else interval '24 hours'
      end as deadline
    ) d
    left join public.deposit_deadline_alerts n
      on n.appointment_id=a.id
      and n.notice_kind=case when now()<d.deadline then 'customer_5min' else 'owner_overdue' end
    where cfg.id=1
      and a.created_at>=cfg.activated_at
      and a.status='pending'
      and a.deposit_received_at is null
      and a.starts_at>now()
      and (
        (now()>=d.deadline-interval '5 minutes' and now()<d.deadline)
        or (now()>=d.deadline and now()<d.deadline+interval '48 hours')
      )
      and (n.id is null or (n.state in ('failed','processing')
                            and n.locked_until<=now() and n.attempts<4))
    order by d.deadline,a.id
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
    returning existing.id,existing.appointment_id,existing.notice_kind
      into recorded;
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
returns void language plpgsql volatile security definer set search_path=''
as $$
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
