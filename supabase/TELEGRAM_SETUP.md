# Telegram Booking Alerts — Dashboard Setup

The code is in `supabase/functions/telegram-booking/index.ts`. It is **not deployed** by a GitHub commit. Follow these steps in the Supabase Dashboard.

## 1. Create Lynna's bot
1. Open Telegram and chat with verified **@BotFather**.
2. Send `/newbot`, choose a display name and unique username.
3. Copy its token **privately**, never paste the token into GitHub, messages, or website JavaScript.
4. Lynna opens the new bot and taps **Start**.
5. Find her Telegram chat ID via **@userinfobot**, or a private test of Telegram's `getUpdates`; keep bot token confidential.

## 2. Deploy Edge Function (no CLI)
1. Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name: `telegram-booking`.
3. Replace the editor with the contents of `supabase/functions/telegram-booking/index.ts` from GitHub. Deploy.
4. In Edge Functions settings, turn **Verify JWT** OFF for this function. Authentication is instead handled with the `X-Webhook-Secret` header.

## 3. Add secrets (Supabase → Edge Functions → Secrets)
- `TELEGRAM_BOT_TOKEN`: the BotFather token
- `TELEGRAM_CHAT_ID`: Lynna's Telegram numerical chat ID
- `BOOKING_WEBHOOK_SECRET`: your own random, high-entropy secret, 32+ characters; keep it private

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by Supabase in the hosted Edge Function environment. Never place the service-role key in client-side code.

## 4. Database Webhook
1. Supabase Dashboard → **Database → Webhooks** → **Create webhook**.
2. Name `telegram_booking_changes`; table `public.appointments`; events **INSERT**, **UPDATE**.
3. Webhook method: **POST** to
   `https://bqskepnkkzugkofqjuyv.supabase.co/functions/v1/telegram-booking`.
4. Add HTTP header `X-Webhook-Secret` with exactly the same private value as `BOOKING_WEBHOOK_SECRET`.
5. Save. No SQL migration is required for this webhook.

## 5. Test
Make a test appointment; a Telegram notification should arrive. Approve it in the admin dashboard; a second notification should arrive. Try rescheduling and cancellation too. Edge Function Logs and Database Webhook Logs can help diagnose delivery.

## Limitations
- Alerts are **server-side**; browser need not be open.
- Automatic customer emails are a separate feature.
- Telegram messages contain client name and service, but omit customer email/phone.
- Database webhooks are asynchronous; rare failed deliveries are possible. A retry/outbox can be added for stronger guaranteed delivery.
- Do not share bot credentials or message content publicly.
