-- Grant full Hair by Lynna application Owner permissions to the existing tester account.
-- No expiration. Run in Supabase SQL Editor. This does not alter appointments.
do $$
declare changed integer;
begin
  update public.admin_users a
  set role = 'owner'
  from auth.users u
  where a.user_id = u.id
    and lower(u.email) = 'chezmaxo@outlook.com'
    and a.role in ('tester', 'owner');
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected exactly one existing tester/admin account; found %', changed;
  end if;
end $$;

select u.email, a.role
from public.admin_users a
join auth.users u on u.id = a.user_id
where lower(u.email) = 'chezmaxo@outlook.com';
