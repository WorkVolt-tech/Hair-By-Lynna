# Hair by Lynna — automatic notifications: current setup

**Status: working (fixed and tested Oct 26, 2026).**

| What | Function | Schedule (Supabase Cron) | Verify JWT |
|---|---|---|---|
| Booking emails (request, approved, declined, cancelled, rescheduled, deposits) + Lynna's Telegram | `telegram-booking` (v24) | Database webhook on `appointments` | OFF |
| 5-minute deposit warning (client) + "deposit sent" / "deadline passed" alerts (Lynna, Telegram) | `deposit-deadlines` (v6) | `hair-by-lynna-deposit-deadlines`, every minute | OFF |
| 12-hour appointment reminder (client, approved bookings only) | `booking-reminders` (v5) | `hair-by-lynna-12h-reminders`, every 15 minutes | OFF |
| Private status-link email | `booking-status` (v10) | Called by the website | OFF |

All client emails are sent in the language the client booked in (EN/FR).

## How the scheduled jobs authenticate
Both jobs send the header `X-Deposit-Secret`, read at runtime from Supabase Vault (`hair_by_lynna_deposit_cron_secret`).
Both functions compare it with the Edge Function secret `DEPOSIT_DEADLINES_SECRET` (they also still accept `X-Reminder-Secret` / `BOOKING_REMINDER_SECRET`).
**Verify JWT must stay OFF** on these functions: the jobs don't send a login token, so with it ON every call is rejected before the code runs.

## What was wrong before Oct 26
1. `deposit-deadlines` had Verify JWT ON → every call rejected ("Missing authorization header").
2. The deposit job sent `X-Deposit-Secret`, but the function only accepted `X-Reminder-Secret`.
3. Both claim database functions crashed with error 42702 ("ambiguous column") whenever something was due.
4. The 12-hour reminder job had never been created, and `booking-reminders` also had Verify JWT ON.
All four are fixed (see `migrations/024_...`).

## Quick health check (SQL Editor, read-only)
```sql
select to_char(created,'MM-DD HH24:MI') t, status_code, left(content::text,80) body
from net._http_response order by created desc limit 10;
```
Healthy: status 200 with `{"sent":…,"failed":0}` (deposit, every minute) and `{"ok":true,…}` (reminders, every 15 min).
