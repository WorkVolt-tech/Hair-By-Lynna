# Hair by Lynna — Reschedule confirmation setup

## Why
When Lynna changes the time of an approved booking, customers must be told it was **rescheduled**, not newly approved. They can **confirm the new time** or **say it doesn't work** from their private booking-status link (plus matching booking email). Their response is shown in the admin dashboard and sent to the Telegram group.

## Activate in this order (Supabase dashboard; no terminal)

1. **Run migration 014 first** in Supabase SQL Editor: `supabase/migrations/014_customer_reschedule_confirmation.sql` in GitHub. This adds optional response/history fields and an UPDATE trigger. Running it does not modify or cancel existing appointments, and does not touch any other booking policies.
2. Open **Supabase → Edge Functions → booking-status → Code**. Replace the editor contents with the latest GitHub `supabase/functions/booking-status/index.ts`, then click Deploy. Keep Verify JWT OFF. The function continues to require the private UUID from the emailed link and the customer's matching email, and checks the proposal revision before accepting a response.
3. Open **Supabase → Edge Functions → telegram-booking → Code**. Replace contents with the latest GitHub `supabase/functions/telegram-booking/index.ts`, then Deploy. Keep Verify JWT OFF, keep `X-Webhook-Secret` protection and the existing webhook. It now reads the database-recorded event type rather than assuming every approved booking UPDATE is an approval.
4. Wait for Cloudflare Pages to build the latest GitHub `src/Admin.jsx`, `src/BookingStatus.jsx`, `src/booking.css`, `src/admin.css` changes.

## Test the full lifecycle

1. Create and approve a **test** appointment; confirm approval email arrives.
2. In Admin, use Edit appointment to change its date/time to an available slot. Confirm the new email says **Your appointment time has changed**, not approved; shows both old and new appointment times. Telegram should say a customer confirmation is pending.
3. Open the updated email's **Respond to new appointment time** link; enter the original booking email. The status page displays the old time, new time and the two buttons.
4. Choose **Confirm new time**. Check that the status page records the response and the admin dashboard shows **Customer confirmed the new time**. Telegram should notify the group.
5. Reschedule that same approved test appointment again to another free time. Now choose **I can't make this time**. Admin should show **Customer cannot attend — please contact them** and Telegram should alert the group.
6. If the customer cannot attend, Lynna can reschedule manually. That creates a **new** pending response, and stale proposal responses are rejected. No appointment is automatically cancelled or moved back.
7. Also test cancellation after a reschedule; the notification should say **Appointment cancelled**, not approved or rescheduled.

## Behavioral limitations

- This is **confirmation of the time proposed by Lynna**, not self-service customer rescheduling.
- The proposed slot stays reserved (the appointment remains admin-approved) until Lynna changes/cancels it, even if the customer indicates they cannot attend.
- Historical appointments and prior reschedules before migration 014 won't retroactively receive pending response prompts.
- As with existing booking-status lookup, a full private UUID link and matching booking email are required; the short LYN reference alone cannot approve anything.
- The Telegram bot token was exposed during an earlier test; revoke it via BotFather and update the Supabase secret when practical.

