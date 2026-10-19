# Hair by Lynna

React + Vite website, based on the client's original black/pink/cream branding and screenshot references.

## Current state

This is the **first visual foundation**, not a live booking system. The **Book** section is intentionally informational until the appointment database, admin permissions, availability calculations, and customer email confirmations are implemented and tested. No customer information is collected or stored by this version.

## Free deployment with Cloudflare Pages

Connect this repository in Cloudflare > Workers & Pages > Pages. Set framework preset **Vite**, build command **npm run build**, output directory **dist**. No local terminal needed.

## Supabase

Project URL: `https://bqskepnkkzugkofqjuyv.supabase.co`

When booking features are built, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to Cloudflare Pages environment variables. Anon keys are public-facing; **never** publish the service-role key, database password, Telegram bot token, or other server-side secrets. Enable RLS and server-side authorization before opening bookings.

## Upcoming

- Replace placeholder service cards with client's original hairstyle photos, service names, durations and pricing.
- Admin authentication and visually managed availability in Supabase.
- Appointment requests, approval workflow, prevention of overlapping bookings, expiration policies.
- Secure Telegram alerts to Lynna and customer email notifications using providers' free tiers.
- Add complete and client-approved policy text before allowing bookings.

## Deployment note (2026-10-18)

Cloudflare Pages is connected to the `main` branch. This documentation update requests a fresh build after restoring the GitHub connection; it does not change the website's design or features.
