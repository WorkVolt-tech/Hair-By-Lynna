# Download & archive past appointments

**Status: live in Supabase (migration 025 applied Oct 26, 2026).** The button appears in Admin → Statistics once this code is on GitHub.

## What Lynna sees
1. **Download past appointments**: one Excel file, `hair-by-lynna-archive-YYYY-MM_to_YYYY-MM.xlsx`, with 3 tabs:
   - **Appointments**: every appointment that has already ended (any month).
   - **Payments**: prices, deposits and final payments for the same appointments.
   - **Statistics**: one combined total for the whole period.
2. **"Did the file save?"**: nothing is deleted until she taps **Yes, file saved. Delete N appointments**. She can also tap *Download again* or *Not now*.

## Safety rules (enforced by the database)
- Owner account only.
- Only appointments that have already **ended**. Upcoming or in-progress appointments are never exported for archive and can't be deleted.
- Only the appointments that were **in the downloaded file**, and only if they **haven't changed** since the download. Changed ones are kept; download again to archive them.
- Deleting sends no client email and no Telegram alert. Linked reminder/deposit-alert records are removed automatically.

## Important
- Deleting is permanent. The Excel file becomes the only copy: store it safely. Canadian business records should be kept at least 6 years.
- Archived months show zero on the Statistics page afterwards, because the page is calculated from the appointments still in the database.
- The file does not include client phone numbers (same columns as the previous CSV exports).
