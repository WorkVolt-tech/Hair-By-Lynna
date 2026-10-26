-- Hair by Lynna — 024: make deposit alerts and 12-hour reminders actually run.
-- ALREADY APPLIED to Supabase on Oct 26, 2026. Kept here for history; safe to rerun.
--
-- 1) Fix 42702 "column reference is ambiguous" in both claim functions.
--    Their RETURNS TABLE output names (appointment_id, notice_kind, starts_at)
--    collided with table columns in INSERT ... ON CONFLICT (...), so they failed
--    as soon as anything was due. "#variable_conflict use_column" fixes it;
--    the rest of each function body is unchanged.
do $fix$
declare fn text; def text;
begin
  foreach fn in array array[
    'public.claim_due_deposit_deadline_alerts(integer)',
    'public.claim_due_appointment_reminders(integer)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if position('#variable_conflict' in def) = 0 then
      def := replace(def, 'AS $function$', 'AS $function$' || chr(10) || '#variable_conflict use_column');
      execute def;
    end if;
  end loop;
end
$fix$;

-- 2) 12-hour reminder job (was never created). Every 15 minutes.
--    Reuses the deposit job's Vault secret (hair_by_lynna_deposit_cron_secret),
--    which matches the DEPOSIT_DEADLINES_SECRET Edge Function secret.
do $job$
begin
  if not exists (select 1 from cron.job where jobname = 'hair-by-lynna-12h-reminders') then
    perform cron.schedule(
      'hair-by-lynna-12h-reminders',
      '*/15 * * * *',
      $cmd$
        select net.http_post(
          url := 'https://bqskepnkkzugkofqjuyv.supabase.co/functions/v1/booking-reminders',
          headers := jsonb_build_object('Content-Type','application/json','X-Deposit-Secret', v.decrypted_secret),
          body := '{}'::jsonb,
          timeout_milliseconds := 15000
        )
        from vault.decrypted_secrets v
        where v.name = 'hair_by_lynna_deposit_cron_secret'
        limit 1;
      $cmd$
    );
  end if;
end
$job$;
