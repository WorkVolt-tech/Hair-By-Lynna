# Hair by Lynna — Private Business Statistics Dashboard

This adds a **Statistics / Statistiques** tab to the existing Admin Dashboard. **Only the owner** sees the tab. The aggregation itself also checks the owner's Supabase Auth role, so tester accounts and customers cannot call it successfully.

## Activate (one SQL migration)

1. **Prerequisite:** Migration [016_completed_appointments_and_final_payments.sql](./migrations/016_completed_appointments_and_final_payments.sql) must already have been run. It adds `service_price_cents`, `completed_at`, `deposit_received_at` and `final_payment_received_at` tracking.
2. Open [019_owner_business_statistics.sql](./migrations/019_owner_business_statistics.sql). Copy the entire file.
3. In Hair by Lynna's **Supabase → SQL Editor → New query**, paste and press **Run**.
4. The React admin dashboard automatically deploys through **GitHub → Cloudflare Pages**. After that deployment, sign in to [Admin](https://hair-by-lynna.pages.dev/admin) with Lynna's **owner** account and select **Statistics**.
5. **No new Edge Function, Cron job, Brevo secret, or API subscription** is needed.

The SQL is read-only: it adds one protected RPC. It does **not** delete, rewrite or duplicate bookings.

## The monthly cards

Every amount relates to appointments **scheduled** in the selected month (Montréal date). For example, a deposit sent in September for an October appointment is counted in October on this dashboard.

- **Completed appointments:** Number of appointments manually marked `completed`.
- **Recorded payments:** Sum of manually confirmed **Interac deposits** and manually confirmed **final payments** linked to that month's appointments. Deposits retained on cancelled/declined bookings are included as recorded receipts until the admin corrects them; refunds are **not** tracked.
- **Outstanding on completed services:** Sum of positive unpaid balances on completed appointments only, calculated as `max(service price - confirmed deposit - confirmed final payment, 0)`.
- **Value of completed services:** Sum of the stored booked service prices for completed appointments. This is **not** profit or cash received.

Additional sections show monthly counts by booking status, separate deposit and final-payment totals, a six-month trend of completed appointments and recorded receipts, and top five hairstyles by booking count (**pending**, **approved** and **completed** only).

## Important limitations

- **Not bank statements:** Payments are counted only when Lynna manually confirms them. This dashboard does not validate Interac transfers or reconcile bank data.
- **Not tax accounting:** Expenses, refunds, taxes, tips, discounts and partial payments are not modeled. In particular, a refunded deposit must be handled outside this dashboard; do not assume it has been subtracted.
- **Historic prices:** Appointments booked *before* migration 016 use the service's price **at migration time**, not necessarily the actual original quoted price.
- **Deletion:** Permanently deleted appointments are no longer counted. Archiving without deletion preserves their totals.
- **Completed bookings:** Past approved appointments are not automatically completed. Lynna needs to mark them complete in Appointments → Active for them to count as completed services.
- **Month convention:** This is an *appointment-month performance view*, **not actual bank cash flow grouped by payment date**.

## Quick checks

1. With owner login, open **Statistics** and switch between October and September (or another month with bookings).
2. Confirm status counts match the existing **Appointments → Active / History** records for that appointment month.
3. Mark a disposable past approved test booking **Completed**; verify the completed count increases after refresh.
4. Mark a deposit or final payment received on a disposable test booking; verify recorded receipts and outstanding balance update.
5. Sign in using a **tester** account; the Statistics tab should **not** appear. The SQL RPC rejects non-owner accounts.
6. Check French labels and mobile display.
7. If stats show zeros unexpectedly, ensure migration 016 has been run and past bookings were manually marked completed.

If the tab displays a migration error, check the Supabase SQL Editor result for migration **019** and Cloudflare's latest build. The live dashboard was not tested by the GitHub code change alone.
