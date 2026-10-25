# Hair by Lynna — CSV Export Reports

The **owner-only Statistics / Statistiques tab** now has three download buttons for the month selected in the dashboard:

1. **Appointment history:** Booking reference, customer name, email, hairstyle, Montréal date and times, current status, completion date. Includes **all statuses**, active and archived, for that month.
2. **Payment report:** All appointment columns plus booked service price, expected and confirmed deposit, confirmation dates, confirmed final payment, and unpaid balance **on completed appointments only**. Money fields are numeric **CAD dollars** (for example `45.00`) so Excel and Google Sheets can calculate with them.
3. **Monthly statistics:** Monthly totals, status counts, distinct client count, completed service value, confirmed deposits and final payments, outstanding completed balance, top five hairstyles, plus six months of activity.

## Activate — one small SQL step

1. Ensure [016](./migrations/016_completed_appointments_and_final_payments.sql) and [019](./migrations/019_owner_business_statistics.sql) were previously run in Supabase.
2. Open [020_owner_monthly_csv_exports.sql](./migrations/020_owner_monthly_csv_exports.sql) in GitHub. Copy the entire SQL file.
3. In the Hair by Lynna project, go to **Supabase → SQL Editor → New query**. Paste and **Run**.
4. Cloudflare should automatically deploy the new frontend from GitHub. After that deployment, log in as **owner** at https://hair-by-lynna.pages.dev/admin and select **Statistics**.
5. Select the month, then click **Appointment history**, **Payment report**, or **Monthly statistics**. Your browser downloads `hair-by-lynna-appointments-YYYY-MM.csv`, `hair-by-lynna-payments-YYYY-MM.csv`, or `hair-by-lynna-statistics-YYYY-MM.csv`.

**No new Edge Function, Cron schedule or subscription is necessary.**

## Privacy and behavior

- Only the **owner** can see the Statistics tab. Database functions `owner_export_monthly_appointments` (020) and `owner_monthly_business_statistics` (019) independently verify the authenticated user has role `owner`. Tester or customer accounts cannot call them.
- Appointments are exported by **scheduled Montréal calendar month**, not by when the deposit was received. DST is handled by Supabase.
- Records come directly from all matching database rows, **not** the 300-record active view or the paged 25-record archives. The client requests pages of 500 to avoid the default 1000-row cap. If there are more than 25,000 records in a month, export stops with an error rather than silently giving a partial file.
- CSV files use UTF-8 with a BOM for accented French text, double quotes for proper escaping, and spreadsheet-formula injection prevention on client-entered fields.
- CSV files are generated **in the owner's browser**. No third-party CSV service is used.
- An empty month produces a header-only appointments or payments CSV. Monthly statistics will show zeros and the relevant trend.
- Keep CSVs containing **client names and emails private**. Avoid sharing them publicly or putting them in a public cloud folder.

## Accounting notes

- A recorded deposit or final payment means Lynna **manually confirmed** it; this is not proof of a transfer from the bank.
- Confirmed deposits on cancelled or declined bookings remain counted while still marked received. There is no refund bookkeeping.
- `Outstanding - completed only` is left blank for non-completed bookings, not counted as debt.
- A CSV is **not a tax report**: tips, expenses, refunds, taxes, partial payments and bank reconciliation are not available. The dashboard's recorded payments are grouped by **appointment month**, even if paid earlier or later.
- Historic prices from before migration 016 might represent the service price when the migration ran, rather than the true original sale price.

## Testing

- Export a month containing an approved test booking and a completed booking; check rows against the admin.
- Open the CSV in Excel or Google Sheets. Verify accents, money fields and Montréal dates.
- Switch the website to French and export again; column headers and statuses should be French.
- Export an empty month; the CSV should still contain headers.
- Log in as **tester**; the Statistics tab and export buttons should not appear. The SQL RPC also rejects tester calls.
- If the appointments/payment buttons fail, ensure migration **020** ran successfully. If statistics fails, verify migration **019**.
