-- Hair by Lynna: throttle requests for private booking status email links.
-- This migration changes no existing appointments or availability.
-- Limits each normalized email address to 5 link requests per hour,
-- with at least 60 seconds between requests.
create table if not exists public.booking_status_link_limits (
  request_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1,
  last_requested_at timestamptz not null default now()
);
alter table public.booking_status_link_limits enable row level security;
revoke all on public.booking_status_link_limits from public, anon, authenticated;
grant select, insert, update on public.booking_status_link_limits to service_role;

create or replace function public.booking_status_allow_link_request(p_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
  if p_key is null or length(p_key)<>64 or p_key !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  insert into public.booking_status_link_limits as r
    (request_key,window_started_at,request_count,last_requested_at)
  values (p_key,now(),1,now())
  on conflict(request_key) do update set
    window_started_at=case when r.window_started_at<=now()-interval '1 hour' then now() else r.window_started_at end,
    request_count=case when r.window_started_at<=now()-interval '1 hour' then 1 else r.request_count+1 end,
    last_requested_at=now()
  where (r.window_started_at<=now()-interval '1 hour' or r.request_count<5)
    and r.last_requested_at<=now()-interval '60 seconds'
  returning true into allowed;
  return coalesce(allowed,false);
end;
$$;
revoke all on function public.booking_status_allow_link_request(text) from public, anon, authenticated;
grant execute on function public.booking_status_allow_link_request(text) to service_role;
