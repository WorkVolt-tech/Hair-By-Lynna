-- ONE-TIME setup for Hair by Lynna's 12-hour appointment reminder scheduler.
-- First: run migrations/018_twelve_hour_reminders.sql, deploy the
-- booking-reminders Edge Function (Verify JWT OFF), and set BOOKING_REMINDER_SECRET
-- plus the existing BREVO_API_KEY and BOOKING_EMAIL_FROM in Edge Function Secrets.
--
-- IMPORTANT: Replace the value of reminder_secret with the SAME new random
-- secret you entered in BOOKING_REMINDER_SECRET. It must be at least 24 characters.
-- Edit this only in Supabase SQL Editor; NEVER commit your filled-in secret to GitHub.
-- Run ONCE only after the Edge Function is deployed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $setup$
declare
  reminder_secret text := 'PASTE_THE_SAME_LONG_RANDOM_SECRET_HERE';
begin
  if reminder_secret = 'PASTE_THE_SAME_LONG_RANDOM_SECRET_HERE'
    or length(reminder_secret) < 24 then
    raise exception 'REPLACE_REMINDER_SECRET_BEFORE_RUNNING';
  end if;
  perform vault.create_secret(reminder_secret,'hair_by_lynna_12h_cron_secret');
end
$setup$;

-- Every 15 minutes, invoke the protected Edge Function. The secret is fetched
-- from Supabase Vault at runtime, not embedded in the stored cron job text.
select cron.schedule(
  'hair-by-lynna-12h-reminders',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := 'https://bqskepnkkzugkofqjuyv.supabase.co/functions/v1/booking-reminders',
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

-- Verify: select jobname,schedule,active from cron.job
--         where jobname='hair-by-lynna-12h-reminders';
-- To pause: select cron.unschedule('hair-by-lynna-12h-reminders');
