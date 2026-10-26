# Hair by Lynna — deposit sent button, 5-minute email warning, owner Telegram alerts

**What happens:** A customer can tap **I've sent my deposit / J'ai envoyé mon dépôt** in the booking email. The link opens the existing private booking-status page; the customer must provide their original booking email and then click the deposit-sent confirmation button. **This does not mark the deposit paid:** Lynna verifies Interac in her bank and manually clicks **Confirm deposit received** as before.

New booking requests have a fixed deposit due time, calculated **from the original submission**, not rescheduling:

- Appointment starts **more than 48 hours after request**: deposit due **24 hours** after booking request.
- Appointment starts **48 hours or less after request**: deposit due **2 hours** after booking request.
- **5 minutes before** that due time, if unpaid **and not reported sent**, send one bilingual Brevo email warning the customer the request may be manually cancelled and including the report button.
- **As soon as a customer reports sending it**, alert Lynna once on Telegram: **Customer says sent; CHECK INTERAC**.
- **At the due time**, if Lynna has not yet confirmed receipt, alert her once on Telegram: **Deadline passed; CHECK BANK; cancel manually only if unpaid**. This alert is still useful if the customer claimed sending it.
- Owner Admin → Appointments shows **deposit deadline**, **reported sent (unverified)**, and **overdue** labels. Marking a deposit received stops future deadline alerts.
- This job is separate from the existing **12-hour appointment reminder**, which remains unchanged.

## Enable carefully — in this order

1. **Supabase SQL Editor:** Copy and Run all of [migration 022](./migrations/022_deposit_deadline_alerts.sql). It adds two optional columns and a new insert trigger for future bookings, service-role-only RPCs and private idempotency logs. It preserves old bookings. **It does not automatically send anything or cancel appointments.** Run after migration 015.
2. **Frontend:** Cloudflare automatically deploys the changed React pages from GitHub. Wait for the new **J'ai envoyé mon dépôt** button in the booking-status page. The frontend alone won't activate until the next steps.
3. **Supabase → Edge Functions → booking-status → Code → Deploy updates:** Copy the updated [booking-status/index.ts](./functions/booking-status/index.ts). This function authenticates the booking UUID plus original customer email, then calls the new service-role-only database RPC. **This must be redeployed after migration 022**, because it selects the new columns.
4. **Supabase → Edge Functions → telegram-booking → Code → Deploy updates:** Copy the updated [telegram-booking/index.ts](./functions/telegram-booking/index.ts). Customer booking emails now include the payment-reported link. Do this after 022, because it reads `deposit_reported_sent_at`.
5. **Supabase → Edge Functions → Create Function:** Name **`deposit-deadlines`**. Copy [deposit-deadlines/index.ts](./functions/deposit-deadlines/index.ts) and deploy. Set **Verify JWT OFF**, exactly as with the existing 12-hour reminder function. The endpoint independently checks a long `X-Reminder-Secret`; unauthorized requests receive HTTP 401.
6. **Secrets:** This function uses existing Edge Function secrets: `BOOKING_REMINDER_SECRET` (same one used by your 12-hour reminder), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY`, `BOOKING_EMAIL_FROM`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`. All are Supabase project secrets; do not paste them in GitHub or customer-facing code. The first five are already needed by booking/reminders, and Telegram tokens by the booking notification function.
7. **Supabase SQL Editor:** Run [DEPOSIT_DEADLINES_CRON_SETUP.sql](./DEPOSIT_DEADLINES_CRON_SETUP.sql). It checks the existing 12-hour reminders Vault entry `hair_by_lynna_12h_cron_secret` and schedules a **separate once-per-minute** Cron job named `hair-by-lynna-deposit-deadlines`. No new secret or separate payment integration is needed.

**IMPORTANT:** Do not run the Cron SQL until the new Edge Function is deployed. Cron never calls a customer-facing endpoint. The new workflow does not change the 12-hour reminders job or its schedule.

## Testing

- Test with a fresh disposable booking created **after migration 022** and with a valid service/date. Existing bookings are deliberately excluded to prevent floods of old payment warnings.
- In Admin → Appointments, verify **Deposit deadline** appears (in Montréal time); for next-day test bookings, it should be approximately two hours after request.
- Open the initial booking email, click **I've sent my deposit**. The website should ask for the original booking email, and a second explicit click should record the claim.
- Without Lynna confirming actual receipt, the booking-status screen should show **Reported sent — awaiting verification**; the admin screen should show the same. No payment has been confirmed.
- Within the next minute or two, Telegram should notify Lynna to check Interac (provided Cron is running). The customer should **not receive an as-yet-unsent five-minute deposit warning**.
- After Lynna checks the transfer and marks **Confirm deposit received**, both screens should show payment confirmed.
- Test the **5-minute warning** using a disposable booking that does not report payment, allowing its natural deadline to approach. Expect email near 5 minutes before deadline (subject to Cron and email-provider delays).
- At the due time of an unconfirmed booking, Telegram should alert Lynna to **check her bank and manually cancel if unpaid**.
- Test French and English page views. No clicks in a customer email directly mark a payment received; the browser must submit a verified form.
- Verify the 12-hour appointment reminder continues to work independently.

## Operational details and limitations

- Email messages are **scheduled approximately 5 minutes before** the due time; a once-per-minute check and Brevo delivery can shift actual arrival. If the customer reports sending the payment after the warning has already been sent, it cannot be recalled.
- Customer claims suppress only the **deposit payment warning**, not the unrelated approved-appointment reminder 12 hours before the appointment.
- Telegram is **not proof of payment**. Lynna must verify the Interac transfer; if received, she confirms it manually. **There is no automatic cancellation** because Interac delivery can be delayed or unverified.
- The original deposit deadline is fixed at the initial request; rescheduling an appointment does not automatically change it.
- Both alert types require the booking to remain pending/approved, future-dated, and not manually marked received.
- Each type of alert has a private unique database log. Most failures retry a few times. Very rare duplicates may occur if an external provider accepted a message but the server crashed before saving success.
- An owner alert can go out even if a customer says the transfer was sent; that is intentional so Lynna checks the bank and doesn't wrongly cancel it.
- To pause only these alerts: `select cron.unschedule('hair-by-lynna-deposit-deadlines');`. This does not disable the existing 12-hour reminder.
- To inspect status: `select jobname,schedule,active from cron.job where jobname in ('hair-by-lynna-deposit-deadlines','hair-by-lynna-12h-reminders');`
