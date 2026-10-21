# Hair by Lynna — Customer status and email setup

## 1. Secure booking-status page
The bilingual public website now includes a status lookup. On successful new booking it displays a private link of the form:
`https://hair-by-lynna.pages.dev/?booking=<full-appointment-uuid>#booking-status`

The customer enters **the same email used at booking** to view their status. The shorter `LYN-YYYYMMDD-HHMM-XXXX` reference is displayed, but is intentionally NOT accepted as authentication because the 4-digit hex suffix is too easy to guess.

In Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor:
- Name `booking-status`
- Paste the GitHub code in `supabase/functions/booking-status/index.ts`
- Deploy, then set **Verify JWT OFF** for this function (it validates UUID and email internally).
- Public frontend uses existing Supabase URL and anon key; NEVER put the service role key in the frontend.
- Check a new test booking and verify the status link requires the correct booking email.

No SQL migration is required. Appointments remain protected by the existing database RLS.

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
