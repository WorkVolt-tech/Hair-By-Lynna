# Hair by Lynna — Customer status and email setup

## 1. Booking-status page — both customer entry paths

- **From an email:** A confirmation email's private `?booking=<UUID>&ref=LYN-...` link opens a centered, branded check-status card. Customer enters their booking email, taps **Check status**, and sees pending/approved/declined/cancelled and date/service details.
- **From the website directly:** The customer enters their public `LYN-YYYYMMDD-HHMM-XXXX` reference and booking email, then taps **Check status**. To protect privacy, the service emails a *private link* (rather than disclosing appointment details immediately). The customer opens that link and enters their email to view their status.
- A short LYN reference by itself is **never** used as authorization. The emailed UUID is private, even though it remains in the browser link. Customers are never required to type the internal UUID.

### Enable direct-site lookup (one-time steps)

1. Apply the SQL in [`supabase/migrations/013_booking_status_link_rate_limit.sql`](../migrations/013_booking_status_link_rate_limit.sql) using the Supabase SQL Editor. This does not modify appointments; it adds a private email-link request limiter (max 5 per hour per email and 60-second cooldown).
2. In **Supabase → Edge Functions → booking-status → Code**, replace its content with the latest `supabase/functions/booking-status/index.ts` and **Deploy**. Keep **Verify JWT OFF**. This uses the already configured `BREVO_API_KEY` and `BOOKING_EMAIL_FROM` Edge Function secrets.
3. Let Cloudflare finish deploying the updated website code from GitHub.
4. First test the existing private confirmation email link and enter the booking email. Then open the homepage without a link, enter a correct LYN reference and booking email, tap Check status, and use the newly emailed private link.
5. If the direct-site email doesn't arrive, inspect **Edge Functions → booking-status → Logs** and Brevo transactional logs. The endpoint intentionally returns the same generic response even when the reference or email doesn't match, so customers cannot enumerate bookings. No appointment table read permissions are granted to the public.

### Styling and privacy

The status checker is now a centered black/rose-pink card on desktop and mobile; its buttons use the site's pink theme. The browser's internal UUID link is not shown as a text input. The `LYN` reference is shown instead.

## 2. Email notifications (Brevo)

The `telegram-booking` Edge Function in GitHub supports optional Brevo transactional emails for new booking requests, approval, decline, cancellation, and rescheduling. It sends independently of Telegram. If secrets are absent, email is disabled.

1. In Brevo, go to **Settings → Senders, Domains & Dedicated IPs → Senders** (wording may vary), add `hairbylynna@gmail.com` as a sender and verify it. Brevo may substitute its own domain for free-address senders; this is expected. Customers can still reply to `hairbylynna@gmail.com`.
2. Go to **SMTP & API → API Keys** (sometimes `Settings → SMTP & API`) and create a v3 API key. **Never post the key in chats or GitHub**.
3. Supabase Dashboard → Edge Functions → Secrets, add:
   - `BREVO_API_KEY`: the Brevo API v3 key
   - `BOOKING_EMAIL_FROM`: the **verified sender address** registered in Brevo (initially `hairbylynna@gmail.com` if accepted).
4. In Supabase Dashboard → Edge Functions → `telegram-booking`, update/redeploy from the latest code in `supabase/functions/telegram-booking/index.ts`. Keep JWT verification OFF; the webhook uses the existing `X-Webhook-Secret` authentication. No new webhook required.
5. Submit a test appointment and test approval, decline, cancellation, and rescheduling; check Brevo transactional logs and recipient inbox/spam.
6. If the API returns an error, check the Supabase function logs. Never paste API keys into a log or chat.

**Gmail limitation:** Gmail domains cannot be authenticated by third-party senders. Brevo may rewrite the From address to a Brevo-controlled domain; the reply-to remains Lynna's Gmail. A custom domain is recommended for long-term reliable deliverability but not required to begin testing.

## Security
Do not copy bot tokens or provider API keys into messages or source files. Because the Telegram bot token was exposed during testing, revoke it via BotFather and update `TELEGRAM_BOT_TOKEN` in Supabase as soon as possible.
