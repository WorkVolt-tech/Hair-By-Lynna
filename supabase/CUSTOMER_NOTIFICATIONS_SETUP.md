# Customer booking status and email notifications
## Booking status (available after dashboard deployment)
A read-only bilingual booking status page is available at `/?booking=<appointment-uuid>#booking-status` once deployed. It requires the complete UUID plus the matching booking email; the short LYN reference is **not** an authentication token. Do not implement lookup with just the four-character suffix.
In Supabase Dashboard > Edge Functions create `booking-status` from `supabase/functions/booking-status/index.ts` in GitHub. Turn Verify JWT **OFF**. The function reads using the hosted service role key and only returns minimal fields when both the UUID and email match. RLS on appointments remains unchanged.
The browser uses the existing Supabase public URL and anon key; do NOT put any service key in client code.
## Customer email
A new-booking/approval/decline/cancellation/reschedule email needs a transactional email service and verified sender domain. Resend is one practical option, but a Cloudflare Pages subdomain is not the user's own domain to verify. Don't claim email delivery works until an authorized sender and provider API key are configured, the server-side mailer is deployed, and test email is received. Never store provider keys in GitHub or browser code.
