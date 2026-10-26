-- Hair by Lynna — independent deposit alerts scheduler (every minute).
-- This no longer depends on 12-hour reminder setup.
-- FIRST: run migration 022; deploy/update Edge Function deposit-deadlines.
-- After running this SQL, copy the returned secret into:
-- Supabase > Edge Functions > Secrets > DEPOSIT_DEADLINES_SECRET.
-- Keep the secret private. It must match on the function and the Cron side.
-- This SQL is safe to rerun: it REUSES the same Vault secret.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $setup$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name='hair_by_lynna_deposit_cron_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'hair_by_lynna_deposit_cron_secret',
      'Hair by Lynna deposit alert scheduler'
    );
  end if;
end
$setup$;

-- Separate job and Vault secret: the 12-hour reminder job is not changed.
select cron.schedule(
  'hair-by-lynna-deposit-deadlines',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://bqskepnkkzugkofqjuyv.supabase.co/functions/v1/deposit-deadlines',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Deposit-Secret',v.decrypted_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    )
    from vault.decrypted_secrets v
    where v.name='hair_by_lynna_deposit_cron_secret'
    limit 1;
  $job$
);

-- IMPORTANT: COPY this result into Edge Functions Secrets.
-- The secret is not placed in GitHub or in the public site.
select decrypted_secret as "COPY_THIS_VALUE_TO_DEPOSIT_DEADLINES_SECRET"
from vault.decrypted_secrets
where name='hair_by_lynna_deposit_cron_secret';

-- To check the schedule: select jobname,schedule,active from cron.job
-- where jobname='hair-by-lynna-deposit-deadlines';
-- To stop only deposit alerts:
-- select cron.unschedule('hair-by-lynna-deposit-deadlines');
