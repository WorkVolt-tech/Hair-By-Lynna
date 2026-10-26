# Hair by Lynna

Bilingual (English/French) hairstyling website and booking management system for Montréal.

**Customer website:** https://hair-by-lynna.pages.dev/  
**Owner dashboard:** https://hair-by-lynna.pages.dev/admin

## Implemented features

- Service catalog with descriptions, duration and prices managed in the admin dashboard.
- Calendar showing published appointment availability, including a 24-hour minimum notice.
- Appointment booking requests with conflict prevention and optional **one client per day** rule.
- Server-validated honeypot anti-spam field (requires SQL migration 021).
- Owner/admin login and role-based access control through Supabase.
- Approval, decline, cancellation, rescheduling and client confirmation of changed times.
- Booking reference and private email-verified booking-status lookup.
- Manual Interac deposit confirmation, completed appointment history and final-payment recording.
- Customer booking notifications by email through Brevo and owner notifications by Telegram.
- 12-hour reminder email workflow (requires Supabase cron/secrets/deployed Edge Function).
- Private monthly business statistics with CSV exports for appointments, payments and summaries.
- Responsive black/pink/cream design and English/French customer-facing interface.

## Deployment architecture

- **React + Vite** frontend deployed to **Cloudflare Pages** from GitHub `main`.
- **Supabase Postgres** for appointments, services, availability and authorization.
- **Supabase Edge Functions** for booking notifications, private booking-status emails and reminders.
- **Brevo** for customer mail; **Telegram** for owner alerts.

The frontend deploys automatically through Cloudflare Pages. **Changes to `supabase/functions/` do not deploy automatically through Cloudflare.** Update each changed function separately in Supabase **Dashboard → Edge Functions → Code → Deploy updates**, or configure a dedicated deployment workflow.

The Cloudflare Pages build configuration uses **Vite**, with build command `npm run build`, output directory `dist`, and public `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` environment variables.

## Database setup and operations

Database migrations are stored in `supabase/migrations/` in numerical order. If already installed, do not re-run older migrations casually; use the next required migration in **Supabase → SQL Editor**.

Recent operational guides are stored in `supabase/`:

- `BOOKING_HONEYPOT_SETUP.md` (SQL 021)
- `CSV_EXPORTS_SETUP.md` (SQL 020)
- `BUSINESS_STATISTICS_SETUP.md` (SQL 019)
- `REMINDER_12H_SETUP.md` (SQL 018 + scheduled function)
- `CUSTOMER_NOTIFICATIONS_SETUP.md`

## Before accepting real bookings

- Confirm migrations through **021** are applied successfully.
- Verify deployed Edge Function versions match the repository.
- Test pending → approved → customer confirmation email; ensure the **street address is only disclosed to approved customers**, not pending requests.
- Verify 12-hour reminder delivery using a suitable disposable approved test booking.
- Test mobile booking, rescheduling, declines/cancellations and one-client-per-day behavior.
- Verify both languages, no unexpected page jumps, and that customer CSV details remain owner-only.
- Publish a reviewed privacy policy, document a data-retention process, and confirm the business's privacy contact.
- Verify the **service address and postal code with Lynna** before the updated notification emails are used.
- Complete ownership transfer of GitHub, Supabase and hosting only after the website is stable and the client is ready.

### Maintainer note

The public booking system is implemented. Older text describing this project as a "coming soon" landing page is obsolete. Bulk replacement of already published calendar availability remains intentionally restricted; individual edits are supported.
