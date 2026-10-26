# Hair by Lynna — emails in the customer's booking language

> **STATUS: LIVE (Oct 26, 2026).** Customers who book with the website in **FR** receive every email in French; customers who book in **EN** receive every email in English. Lynna's Telegram alerts stay in English and now include a "Customer language" line.

## How it works

1. The booking form sends the site's EN/FR choice with the booking (`p_language`, 9-argument `request_appointment`).
2. Migration 023 saves it on the appointment as `preferred_language` (`en` or `fr`) before the booking is inserted.
3. Every email function reads `preferred_language` and writes the whole email in that language:

| Function | Emails | Live version |
|---|---|---|
| `telegram-booking` | request received, approved, declined, cancelled, rescheduled, reschedule confirmed / needs contact, deposit received / corrected | v24 |
| `booking-status` | private status link | v10 |
| `booking-reminders` | 12-hour reminder | v4 |
| `deposit-deadlines` | 5-minute deposit warning | v5 |

The code in `supabase/functions/` matches what is live in Supabase. If you ever redeploy a function, deploy it from this folder.

## Tested

- Oct 26, 2026: one EN and one FR test booking (“TEST — Maxo”), then cancelled. All four emails (request received + cancelled, in each language) were accepted by Brevo; Telegram alerts delivered.

## If something goes wrong

- Bookings never fail because of the language: if the 9-argument endpoint is unavailable, the form books without it and emails fall back to English.
- A Brevo/email error never blocks Lynna's Telegram alert.
- Existing bookings made before this change stay English (their original site language was not saved).
