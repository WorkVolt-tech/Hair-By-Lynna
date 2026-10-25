# Hair by Lynna — Honeypot booking spam protection

A **honeypot** is a visually hidden, non-focusable text field in the public customer booking form. People leave it empty; unsophisticated form-filling bots may put a value in it. Supabase checks the value **before creating a booking or triggering emails/Telegram notifications**.

## Activate — one SQL migration

1. Wait for Cloudflare to deploy the updated customer booking form from GitHub. The site temporarily falls back to the old booking RPC if migration 021 is not installed yet, so real bookings can continue.
2. Open [021_booking_honeypot.sql](./migrations/021_booking_honeypot.sql) in GitHub.
3. Copy **all** the SQL into **Supabase → SQL Editor → New query** and press **Run**. It preserves all existing appointments.
4. Refresh the customer booking page at https://hair-by-lynna.pages.dev/#book.

**No new Supabase Edge Function, secret, Cloudflare setting, CAPTCHA service or subscription is needed.**

## How it works

- The form includes a regular text input named `company_website`. CSS moves it far off-screen, and the field is hidden from screen readers and keyboard navigation. It is **not** required for real customers.
- The public React form sends the field value as `p_company_website` when requesting a booking. It should always be an empty string for a real visitor.
- Migration 021 renames the existing 7-argument `request_appointment` database function to `request_appointment_core`, **revokes its public/anonymous/authenticated execution permissions**, and exposes an 8-argument `request_appointment` wrapper that requires an empty honeypot field.
- If a bot submits a nonempty honeypot, Supabase rejects it **before** running the original booking logic. It cannot create a fake booking or trigger emails.
- The core booking function still enforces service validity, 24-hour lead time, existing appointment overlap protection, the One client per day rule, plus **3 bookings per email per 24 hours** and **80 bookings globally per hour**.
- The honeypot by itself **cannot stop a targeted bot** that copies the network request and leaves the field empty. For stronger protection against persistent spam, the next step is **Cloudflare Turnstile**, verified on the server.

## Test

1. Select a real published service, day and time, and complete a legitimate **test booking**. It should work normally after SQL 021.
2. To verify honeypot rejection without changing the form UI, open the public page in desktop Chrome/Edge DevTools → Console and enter:
   ```js
   document.querySelector('[name="company_website"]').value='spam-site.test';
   document.querySelector('[name="company_website"]').dispatchEvent(new Event('input',{bubbles:true}));
   ```
   (React controls the field value; if it is not updated by a direct DevTools assignment, you can use the browser's React DevTools instead to set its state.) Submit a test request and verify a generic error, not a new appointment. Do not test on a real customer's booking.
3. From Supabase SQL Editor, you can verify the legacy API is closed:
   ```sql
   select proname,pronargs,has_function_privilege('anon',oid,'EXECUTE') as anonymous_can_execute
   from pg_proc
   where pronamespace='public'::regnamespace
     and proname in ('request_appointment','request_appointment_core')
   order by proname;
   ```
   Expected: `request_appointment` with **8 arguments** is executable; `request_appointment_core` with **7 arguments** is **not**.
4. Verify that normal booking approval, Telegram/Brevo customer email, deposit tracking and one-client-per-day still work. Those features are not modified.

If the form says **Unable to submit** immediately after migration, refresh the page after the Cloudflare frontend deployment and ensure SQL 021 ran successfully. The new code is compatible with the old database before activation, but **the old frontend is not compatible with the protected database after activation**.

## Privacy and accessibility

The field contains no tracking scripts or fingerprints; it is just form data and has no impact on how clients fill out their details. It is removed from keyboard navigation and from assistive technology's accessibility tree.

## Important limitations

Honeypots are a low-friction layer, **not a CAPTCHA replacement**. Sophisticated spam scripts can read JavaScript and submit an empty field, and the site's existing email-based/global rate limits do not prevent all abuse. If malicious requests continue, add Cloudflare Turnstile with server-side validation.
