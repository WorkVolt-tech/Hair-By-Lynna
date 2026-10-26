-- ONE-TIME setup: deposit alert check every minute, independent of 12h reminders.
-- Run AFTER migration 022 and AFTER deploying Edge Function "deposit-deadlines".
-- Uses the SAME existing Vault reminder secret as the 12-hour reminder cron,
-- so do not paste another secret or change BOOKING_REMINDER_SECRET.
-- Requires existing pg_cron, pg_net and Vault from 12h reminder setup.
-- Confirm this Vault entry exists before running:
-- select name from vault.decrypted_secrets
-- where name='hair_by_lynna_12h_cron_secret';
-- The real secret value should remain private.

do $setup$
begin
  if not exists(select 1 from vault.decrypted_secrets
                where name='hair_by_lynna_12h_cron_secret') then
    raise exception 'RUN_REMINDER_12H_CRON_SETUP_FIRST_TO_CREATE_VAULT_SECRET';
  end if;
end $setup$;

-- Safe to run again; pg_cron replaces an existing job with this name.
select cron.schedule(
  'hair-by-lynna-deposit-deadlines',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://bqskepnkkzugkofqjuyv.supabase.co/functions/v1/deposit-deadlines',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'X-Reminder-Secret',v.decrypted_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    )
    from vault.decrypted_secrets v
    where v.name='hair_by_lynna_12h_cron_secret'
    limit 1;
  $job$
);
-- Verify both jobs remain active:
-- select jobname,schedule,active from cron.job
-- where jobname in ('hair-by-lynna-12h-reminders','hair-by-lynna-deposit-deadlines');
-- Stop only deposit alerts:
-- select cron.unschedule('hair-by-lynna-deposit-deadlines');
