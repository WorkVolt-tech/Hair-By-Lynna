# Hair by Lynna — $20 CAD Interac deposit tracking

The public policy already states a **$20 CAD non-refundable deposit**, deducted from the final bill. This implementation tracks whether **Lynna has manually verified** receipt of that deposit. It does not receive or process e-Transfers, access bank accounts, or automatically mark an appointment approved.

**Interac e-Transfer receiving email shown to customers:** `Magdalynnajoseph@gmail.com` (Lynna's requested personal payment email). This is separate from the site's general contact and Brevo reply-to address. Lynna should confirm this address is registered to receive Interac e-Transfers before accepting real payments.

## Activate (Supabase Dashboard — no terminal)

**Order matters:**

1. In Supabase **SQL Editor**, run the complete GitHub file:
   `supabase/migrations/015_deposit_tracking.sql`. This must run after migration 014. It adds three optional deposit receipt fields, defaults the deposit to $20 CAD, updates the existing appointment notification trigger, and creates an **owner-only** confirmation RPC. It does **not** mark old deposits as received or alter appointments.
2. Supabase **Edge Functions → booking-status → Code**: replace with the latest
   `supabase/functions/booking-status/index.ts`, click **Deploy**. Keep **Verify JWT OFF**, as already configured. It returns payment status only after the client submits their private booking link and matching booking email.
3. Supabase **Edge Functions → telegram-booking → Code**: replace with the latest
   `supabase/functions/telegram-booking/index.ts`, click **Deploy**. Keep **Verify JWT OFF** and the existing Database Webhook `X-Webhook-Secret` protection. Uses existing Brevo secrets.
4. Cloudflare Pages automatically deploys changes to `src/Admin.jsx`, `src/BookingStatus.jsx`, `src/CustomerBooking.jsx`, and styles. Refresh the page if necessary.

**Do not deploy the modified booking-status function before running migration 015**, because it queries the new columns.

## Test with a fake booking

1. Book a test appointment using an email you control. On the booking success screen, confirm the **$20 CAD deposit** and Interac payee are shown, together with a reminder to include the **LYN** booking reference in the transfer message.
2. The new-booking email should contain **Deposit: $20.00 — Not received** and matching transfer instructions. No transfer has been verified yet.
3. Open the private booking-status link; enter the original customer email. Status should show **Not yet received** and the Interac payee.
4. Sign in as an **owner** at `/admin`, open **Appointments**, and click **Confirm deposit received** for the test booking. The confirmation dialog must ask you to verify payment first. (For testing only, you can mark the fake deposit without sending a real transfer and later undo it.)
5. Re-check the customer status: **Received and confirmed**. Verify the customer gets a **Deposit received** email and Telegram receives **Deposit verified as received**.
6. Test **Undo deposit confirmation** on the test booking: the portal returns to **Not yet received**. A corrective email and Telegram notice are sent. This corrects the record, **not** a refund.
7. Confirm that a non-owner account cannot confirm a deposit. Check French as well as English, and mobile and desktop layouts.
8. Test that approving or rescheduling the appointment preserves deposit status; neither marking a deposit paid nor a deposit pending automatically approves/cancels the appointment. Deposit is independent of appointment approval.
9. Check cancellation behavior: if a paid appointment is cancelled, the deposit receipt remains recorded. Refund/forfeiture decisions and bank transfers are handled separately based on the published policy.

## How it works

- **Admin records**: `deposit_amount_cents` (default 2000), `deposit_received_at` (nullable), `deposit_received_by` (nullable).
- `admin_set_deposit_received(uuid,boolean)` requires an authenticated `owner`; repeated clicks in the same state don't send extra notifications.
- A database trigger assigns a reliable `last_booking_event` for a payment receipt or correction. The existing webhook informs the Telegram group and sends a customer email through Brevo.
- **Booking-status** only exposes amount and receipt date to a customer who provides a private UUID plus matching booking email. No public payment self-confirmation button.
- The website uses the existing $20 policy. If Lynna changes the amount, review the published policy, database default, and messaging together.
- The original Telegram bot token was previously exposed; rotate it with BotFather and update the Supabase secret.
