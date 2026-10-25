# Hair by Lynna — 12-hour appointment reminder (Brevo + Supabase)

**Purpose:** Send **one** branded email **approximately 12 hours before** an *approved* appointment, not immediately after someone books. Booking itself requires at least **24 hours** of notice, so this is not a redundant "just booked" message.

**Status:** Code is in GitHub. The scheduled reminder is **NOT active** until you complete the Supabase steps below.

## One-time activation

1. **Database:** Open [018_twelve_hour_reminders.sql](./migrations/018_twelve_hour_reminders.sql). Copy all its contents into **Supabase → SQL Editor → New query**, then click **Run**. This creates private reminder logs and sending safeguards. It **does not send emails or create a scheduled job**.
2. **Edge Function:** In **Supabase → Edge Functions**, create a new function named exactly **`booking-reminders`**. Copy [booking-reminders/index.ts](./functions/booking-reminders/index.ts) from GitHub into its editor, then **Deploy**. Turn **Verify JWT OFF** for this function; the custom secret header protects it.
3. **Secrets:** Under **Edge Functions → Secrets**, make sure `BREVO_API_KEY` and `BOOKING_EMAIL_FROM` are already present (they are used by your existing booking emails). Add one new secret:
   - Name: `BOOKING_REMINDER_SECRET`
   - Value: a **new, unique random string at least 24 characters long**, ideally 32+ random bytes in hexadecimal. Do not reuse the Telegram bot token, Supabase API keys or customer passwords.
   - You can generate a random value in Supabase SQL Editor with: `select encode(gen_random_bytes(32),'hex') as reminder_secret;` then copy the 64-character result.
4. **Schedule:** Open [REMINDER_12H_CRON_SETUP.sql](./REMINDER_12H_CRON_SETUP.sql). Copy it into the **Supabase SQL Editor**, replace **`PASTE_THE_SAME_LONG_RANDOM_SECRET_HERE`** with the **exact same** secret you added as `BOOKING_REMINDER_SECRET`. Click **Run** *once*. This stores the secret in **Supabase Vault** and installs the **every-15-minutes** Cron job. **Do not commit your filled-in secret to GitHub.**

The function URL is `https://bqskepnkkzugkofqjuyv.supabase.co/functions/v1/booking-reminders`.

**Important:** If you have not deployed the earlier `telegram-booking` and `booking-status` email-logo updates, those remain separate pending deployments; the new reminder function already uses the PNG logo.

## Who receives reminders?

- **Approved only.** Pending, cancelled, declined and completed appointments are excluded.
- Only when the appointment begins **between 11 and 12 hours from the time the reminder runs**, normally close to 12 hours beforehand.
- **One reminder per appointment start time.** Supabase records each attempt to prevent routine duplicate sending.
- A changed appointment time can qualify for another reminder only for its **new** start time, and only after the client **confirmed** the proposed change. Pending or disputed reschedules are skipped.
- A failed Brevo request is retried at most a few times within the 11–12 hour window. If Brevo accepted the email but the function crashed before recording success, a rare duplicate is still theoretically possible; no system can guarantee exactly once across email and database without provider support.

## What the customer gets

A black-and-pink bilingual English/French email with the PNG website logo, hairstyle, Montréal date and time, estimated duration, deposit confirmation, LYN booking reference and their existing private booking-status link. It does **not** charge a card, request another deposit if the customer has already paid, or automatically approve/cancel a booking.

## Verify after activation

1. In Supabase → **Cron** (or Database → Cron Jobs), find `hair-by-lynna-12h-reminders`; it should be **Active** and scheduled for `*/15 * * * *`.
2. In Supabase → **Edge Functions → booking-reminders → Logs**, confirm a successful run. If there are no appointments 11–12 hours away, expected result is `sent: 0`.
3. For a disposable approved test booking, check the reminder at about 12 hours before its scheduled start; email should arrive **only once**.
4. If you cancel the appointment or propose a new time that has not been confirmed, no reminder should send for the old time.
5. If you ever want to stop reminders, run `select cron.unschedule('hair-by-lynna-12h-reminders');` in Supabase SQL Editor. The reminder logs can remain without using meaningful storage.

## Troubleshooting

- `401 Unauthorized`: Secret stored in Cron's Vault entry differs from Edge Function `BOOKING_REMINDER_SECRET`, or Verify JWT is still ON.
- `503 Not configured`: Check `BREVO_API_KEY`, `BOOKING_EMAIL_FROM`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `Could not load reminders`: Migration 018 not applied, or incorrect database project.
- If the schedule exists but no messages appear, verify the booking is approved and begins within 11–12 hours; bookings marked pending or awaiting reschedule confirmation should not receive one.
- Check Cron job run logs and Edge Function logs for the last run (don't post secrets or customer emails publicly).
