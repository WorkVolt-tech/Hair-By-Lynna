# Hair by Lynna — emails in the customer's booking language

**Result:** Customers booking in **French receive emails fully in French**. Customers booking in **English receive emails fully in English**. The preference is stored when the booking request is created, and used for later confirmation, cancellations, reschedules, deposits, the 12-hour appointment reminder, the 5-minute deposit warning, and private status-link emails.

The **owner's Telegram messages remain in English**.

## Activate — do these in order

**1. Run one SQL file.**

- Open **Supabase → SQL Editor → New query** for project `bqskepnkkzugkofqjuyv`.
- Open [migration 023](./migrations/023_customer_email_language.sql) on GitHub, **copy all SQL**, paste into SQL Editor and click **Run**.
- This requires **migration 021** (honeypot), which was previously installed. If you see “Migration 021 must be applied before 023”, stop and verify 021 first.
- The migration adds one `preferred_language` column, a small insert trigger and a secure 9-argument booking RPC. All booking validation, limits, admin features and existing bookings remain intact.

**2. Redeploy the two functions that send most customer messages.**

In **Supabase → Edge Functions**, open each function, go to **Code**, replace its content with the code from the corresponding GitHub link, and click **Deploy updates**:

1. [telegram-booking/index.ts](./functions/telegram-booking/index.ts) → the **telegram-booking** function (initial receipt, approval, cancellation, deposits, reschedules).
2. [booking-status/index.ts](./functions/booking-status/index.ts) → the **booking-status** function (email of private status links).

**3. Redeploy the reminder function (already active).**

3. [booking-reminders/index.ts](./functions/booking-reminders/index.ts) → **booking-reminders** (12-hour reminder).

**4. Only if the deposit-deadlines function is active**, redeploy:

4. [deposit-deadlines/index.ts](./functions/deposit-deadlines/index.ts) → **deposit-deadlines** (five-minute deposit warning).

**5. Frontend:** Cloudflare Pages builds the updated booking form automatically from GitHub `main`. Customers do **not** need a language dropdown in the form: the site's existing **EN / FR** switch is used.

**You do NOT need to rerun any cron setup SQL, change secrets or redeploy the database webhooks.** This feature does not alter the cron jobs.

## Check that it works

- Select **FR** at the top of the website. Create a fresh test booking for an available date and time (more than 24 hours ahead), using an email that hasn't hit the daily test-booking rate limit.
- Confirm the first email has a French subject and French body, including the service name, date, deposit instructions and **J'ai envoyé mon dépôt** link where applicable.
- In Admin, mark a fresh test booking approved. Its next customer email should be French and include the private appointment address.
- Repeat a fresh booking with the website in **EN**; its email should be fully English.
- Later reminders use the same stored choice even if the customer subsequently changes their website language.
- An existing booking created before this SQL defaults to **EN**, since its original site language was not saved. Testing should use **new** bookings.

## Deployment order / temporary compatibility

- **SQL first**, then Edge Functions. Updated Edge Functions read the new column; deploying them before the SQL will cause database-select errors.
- The new frontend first attempts the **9-argument** RPC. During rollout, if it is not yet in the PostgREST schema cache, it can fall back to the existing **8-argument** honeypot RPC (and older 7-argument RPC only on databases without 021). This keeps existing booking availability safe, but **French capture is not guaranteed until migration 023 is applied**.
- 023 stores the language in a **BEFORE INSERT** database trigger. The first booking email can't race ahead of a later update; there is no second update or duplicate booking event.
