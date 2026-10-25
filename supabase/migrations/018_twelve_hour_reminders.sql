-- Hair by Lynna: one email reminder about 12 hours before an approved booking.
-- Run AFTER migration 014 (reschedule confirmation) and 015 (deposit tracking).
-- This migration does NOT create a cron job or send any emails.
-- It only creates a private idempotency/attempt table and two service-role-only RPCs.

create table if not exists public.appointment_reminders (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  starts_at timestamptz not null,
  state text not null default 'processing'
    check (state in ('processing','sent','failed','skipped')),
  attempts integer not null default 1 check (attempts between 1 and 10),
  claimed_at timestamptz not null default now(),
  locked_until timestamptz not null default now()+interval '5 minutes',
  sent_at timestamptz,
  last_error text,
  unique (appointment_id,starts_at)
);
create index if not exists appointment_reminders_state_idx
  on public.appointment_reminders(state,locked_until);
alter table public.appointment_reminders enable row level security;
-- Neither the public nor logged-in admin clients can read or edit reminder logs.
revoke all on public.appointment_reminders from public, anon, authenticated;
grant all on public.appointment_reminders to service_role;
grant usage, select on sequence public.appointment_reminders_id_seq to service_role;

create or replace function public.claim_due_appointment_reminders(p_limit integer default 20)
returns table(reminder_id bigint, appointment_id uuid, starts_at timestamptz)
language plpgsql volatile security definer set search_path='' as $$
declare
  candidate record;
  newly_claimed record;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_ONLY' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 40 then
    raise exception 'INVALID_LIMIT' using errcode='22023';
  end if;
  -- Run every 15 minutes. This normally sends 11h45–12h before the booking.
  -- A one-hour safety window allows brief cron outages and retries.
  -- Customer must have approved status; do not remind pending/reschedule disputes.
  for candidate in
    select a.id, a.starts_at
    from public.appointments a
    left join public.appointment_reminders r
      on r.appointment_id=a.id and r.starts_at=a.starts_at
    where a.status='approved'
      and a.starts_at>now()+interval '11 hours'
      and a.starts_at<=now()+interval '12 hours'
      and (a.reschedule_response is null or a.reschedule_response='confirmed')
      and (r.id is null or (r.state in ('processing','failed')
                            and r.locked_until<=now() and r.attempts<4))
    order by a.starts_at, a.id
    limit p_limit
    for update of a skip locked
  loop
    insert into public.appointment_reminders as rem
       (appointment_id,starts_at,state,attempts,claimed_at,locked_until,last_error,sent_at)
    values (candidate.id,candidate.starts_at,'processing',1,now(),now()+interval '5 minutes',null,null)
    on conflict (appointment_id,starts_at) do update
      set state='processing',
          attempts=rem.attempts+1,
          claimed_at=now(),
          locked_until=now()+interval '5 minutes',
          last_error=null
      where rem.state in ('processing','failed')
        and rem.locked_until<=now() and rem.attempts<4
    returning rem.id, rem.appointment_id, rem.starts_at
      into newly_claimed;
    if found then
      reminder_id:=newly_claimed.id;
      appointment_id:=newly_claimed.appointment_id;
      starts_at:=newly_claimed.starts_at;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.claim_due_appointment_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_appointment_reminders(integer) to service_role;

create or replace function public.finish_appointment_reminder(
  p_reminder_id bigint, p_outcome text, p_error text default null
)
returns void
language plpgsql volatile security definer set search_path='' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_ONLY' using errcode='42501';
  end if;
  if p_outcome not in ('sent','failed','skipped') or p_reminder_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode='22023';
  end if;
  update public.appointment_reminders r set
    state=p_outcome,
    sent_at=case when p_outcome='sent' then now() else null end,
    locked_until=case when p_outcome='failed' then now()+interval '5 minutes' else now() end,
    last_error=case when p_outcome='failed' then left(coalesce(p_error,'email delivery failed'),160) else null end
  where r.id=p_reminder_id and r.state='processing';
  if not found then raise exception 'REMINDER_NOT_FOUND_OR_CLOSED' using errcode='P0002'; end if;
end $$;
revoke all on function public.finish_appointment_reminder(bigint,text,text) from public, anon, authenticated;
grant execute on function public.finish_appointment_reminder(bigint,text,text) to service_role;
