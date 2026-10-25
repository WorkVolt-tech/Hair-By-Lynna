# Completed appointments, History and final payments — setup & test

This feature adds an **owner-controlled "Mark as completed" action** and **History / Archives** under Admin → Appointments. Completed appointments stay as **one row** in Supabase; archiving does **not** duplicate data. The history tab also shows cancelled and declined appointments in pages of 25.

## Activate

1. **Prerequisite:** Run [015_deposit_tracking.sql](./migrations/015_deposit_tracking.sql) first if you have not already. The new migration depends on its deposit columns and rescheduling event trigger. If you already ran 015, **do not need to re-run it**.
2. Open [016_completed_appointments_and_final_payments.sql](./migrations/016_completed_appointments_and_final_payments.sql) in GitHub. Copy its full contents.
3. In the Hair by Lynna **Supabase project → SQL Editor → New query**, paste the SQL and press **Run**. This adds columns, constraints, owner-only RPCs, and an index. It does **not** delete appointments.
4. The Admin frontend deploys automatically through GitHub → Cloudflare Pages. Open [Admin](https://hair-by-lynna.pages.dev/admin) after that deployment. **No new Edge Function deployment is needed for this specific feature.**

> Separately, the **PNG email logo** changes made previously still need the latest `telegram-booking` and `booking-status` Edge Functions redeployed when convenient. You do not need to redeploy them just to activate the archive and admin payment buttons.

## Workflow

1. Admin → Appointments → **Active** shows pending and approved bookings.
2. Only **owner** sees **Mark as completed** on an **approved** booking whose scheduled end time has passed. The action asks for confirmation in the site's black-and-pink modal.
3. Once manually marked completed, the appointment leaves Active and appears in **History / Archives** (refresh History if already open). Past bookings are **not** automatically completed.
4. For approved and completed appointments, the admin sees **Booked service price**, **Deposit received** (only counted if owner confirmed), **Final payment recorded**, and **Remaining balance**.
5. On a completed appointment, only **owner** can press **Confirm final payment received**. This records the **entire remaining balance at that moment**, after the recorded deposit. It never initiates a charge. Use **Undo final payment confirmation** to correct a mistaken entry. Undo does **not** refund money.
6. If payment differs from the displayed balance (discounts, tips, partial payments), **do not mark the final balance as fully received**: this first version records full remaining-balance payments only.

## Data and protections

- `appointments.service_price_cents` is captured **once** when the customer books. Later edits to a service's price do not rewrite past booking prices.
- On pre-existing bookings, the migration uses the service's price **at migration time** because their original booked price was not stored. Verify historical amounts before using them for accounting.
- `appointments.status='completed'`, `completed_at`, `completed_by` track actual completion.
- `final_payment_received_at`, `final_payment_received_by`, `final_payment_amount_cents` record payment acknowledgment, not an actual bank transaction.
- Database RPCs require authenticated **owner** role; the update guard also blocks non-owner changes to the new completion/payment fields.
- Completion requires an approved appointment whose scheduled end has passed. It does not override cancellations, change deposits, or email the client.
- **History / Archives** loads 25 entries at a time, without duplicating rows. Permanent deletion, if chosen separately, remains an irreversible owner action.

## Quick safe test

1. Use an existing approved **past** test booking (never a future appointment). Go to Admin → Appointments → Active.
2. Press **Mark as completed**, confirm, and check it disappears from Active.
3. Switch to **History / Archives** and confirm the record appears.
4. Check the price and deposit deduction. Do not claim a payment was received unless you truly received it, except for clearly designated disposable test records.
5. For a disposable test record, verify Confirm final payment / Undo works and that the remaining balance updates.
6. Switch to French to verify labels; test on mobile. Other records should be unchanged.
7. Verify the customer's private status page shows **Completed / Terminé** after their normal identity check.

### Troubleshooting

- Missing buttons or SQL RPC errors: ensure **016** ran in the correct Supabase project and Cloudflare has deployed the latest admin code.
- If 016 says `column deposit_received_at does not exist`, run **015** first.
- If the current database has more than 300 active appointments, an admin pagination expansion is recommended; the current Active view limits to the earliest 300.
