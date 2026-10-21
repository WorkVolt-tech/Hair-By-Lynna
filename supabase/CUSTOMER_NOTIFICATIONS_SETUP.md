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

## 2. Email notifications (Resend)
The existing `telegram-booking` Edge Function in GitHub now optionally sends customer emails through the Resend API, for new requests, approval, decline, cancellation, and rescheduling. Email is disabled unless both secrets below are configured, so Telegram remains operational while setting it up.

1. Create/use a Resend account and **verify a sender domain that you control**. You cannot verify someone else's `pages.dev` subdomain. Resend trial/test sending may be limited to your own account until domain verification.
2. Supabase Dashboard → Edge Functions → Secrets, add:
   - `RESEND_API_KEY`: API key created in Resend. **Never put it in GitHub, this chat, or frontend code.**
   - `BOOKING_EMAIL_FROM`: a verified sender on that domain, e.g. `Hair by Lynna <bookings@your-own-domain.example>`. Use your real verified sender, not the example.
3. Update/redeploy `telegram-booking` from latest `supabase/functions/telegram-booking/index.ts` in GitHub using the Supabase function editor. Keep JWT verification OFF. No second database webhook needed.
4. Make a test booking using an address that can receive mail; test approval, decline, cancellation and reschedule as well.
5. Edge Function Logs show `customer email accepted` or an explicit Resend error status; **an accepted API response does not guarantee inbox delivery**.
6. Telegram can succeed even if email fails. If both secrets are omitted, existing Telegram notification behavior continues.

If Lynna has no sender domain, obtain one or choose a transactional mail provider that supports her verified sender address. Email is NOT live until provider credentials, verified sender, and deployed code are configured and tested.

## Security
Do not copy bot tokens or provider API keys into messages or source files. Because the Telegram bot token was exposed during testing, revoke it via BotFather and update `TELEGRAM_BOT_TOKEN` in Supabase as soon as possible.
