# Hair by Lynna — Customer status and email setup

## 1. Secure booking-status page

**Deploy this function separately from telegram-booking.** Telegram/Brevo customer emails may work while booking-status is not deployed.

- Supabase Dashboard → **Edge Functions → Deploy a new function → Via Editor**.
- Function name (exact): `booking-status`.
- Paste the full GitHub file `supabase/functions/booking-status/index.ts` and **Deploy**.
- Set **Verify JWT OFF** for this public read-only function. It checks a private appointment UUID together with the matching customer's email. It does not allow public access to the appointments table.
- If `booking-status` already exists, **replace and redeploy** its code; the latest version fixes Supabase SDK CORS preflight headers (`x-client-info`).
- Refresh the deployed Cloudflare site and test using the emailed booking link plus the exact email used when booking.

**What customers see:** The booking status page shows the familiar `LYN-YYYYMMDD-HHMM-XXXX` reference. The long UUID exists only as a private value in the email link, and is not displayed as a booking ID field. New Brevo emails contain a **Check booking status** button instead of a raw URL; the reference remains visible in the message.

**Privacy:** The four-character reference suffix is too short to authenticate customers by itself. Keep the private emailed link plus booking-email verification. An appointment's visible reference may change on rescheduling (the private UUID link remains valid).

An older email link generated before this change still works once booking-status is deployed; it simply lacks the visible reference until a successful lookup.

## 2. Email notifications (Brevo)

The `telegram-booking` Edge Function in GitHub supports optional Brevo transactional emails for new booking requests, approval, decline, cancellation, and rescheduling. It sends independently of Telegram. If secrets are absent, email is disabled.

1. In Brevo, go to **Settings → Senders, Domains & Dedicated IPs → Senders** (wording may vary), add `xhair.dreams@gmail.com` as a sender and verify it. Brevo may substitute its own domain for free-address senders; this is expected. Customers can still reply to `xhair.dreams@gmail.com`.
2. Go to **SMTP & API → API Keys** (sometimes `Settings → SMTP & API`) and create a v3 API key. **Never post the key in chats or GitHub**.
3. Supabase Dashboard → Edge Functions → Secrets, add:
   - `BREVO_API_KEY`: the Brevo API v3 key
   - `BOOKING_EMAIL_FROM`: the **verified sender address** registered in Brevo (initially `xhair.dreams@gmail.com` if accepted).
4. In Supabase Dashboard → Edge Functions → `telegram-booking`, update/redeploy from the latest code in `supabase/functions/telegram-booking/index.ts`. Keep JWT verification OFF; the webhook uses the existing `X-Webhook-Secret` authentication. No new webhook required.
5. Submit a test appointment and test approval, decline, cancellation, and rescheduling; check Brevo transactional logs and recipient inbox/spam.
6. If the API returns an error, check the Supabase function logs. Never paste API keys into a log or chat.

**Gmail limitation:** Gmail domains cannot be authenticated by third-party senders. Brevo may rewrite the From address to a Brevo-controlled domain; the reply-to remains Lynna's Gmail. A custom domain is recommended for long-term reliable deliverability but not required to begin testing.

## Security
Do not copy bot tokens or provider API keys into messages or source files. Because the Telegram bot token was exposed during testing, revoke it via BotFather and update `TELEGRAM_BOT_TOKEN` in Supabase as soon as possible.
