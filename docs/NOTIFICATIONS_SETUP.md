# MYplan Notifications — Supabase Edge Functions

All notification backend operations run in **Supabase Edge Functions**. Vercel hosts only the Next.js frontend. There are no notification Next.js API routes in the runtime flow.

## Functions

- `notification-compose`: authenticated user-triggered notification; checks preferences, quiet hours, daily cap and dedupe, calls Ollama Cloud, and persists one notification.
- `notification-dispatch`: cron-only worker; creates local-time morning/evening companion notifications, sends Web Push to every subscribed device, records delivery attempts, atomically claims due rows to prevent overlapping Cron runs from double-dispatching, and removes expired history.
- `notification-public-key`: returns the public VAPID key.
- `notification-subscribe`: authenticated device subscribe/unsubscribe endpoint.
- `notifications`: authenticated history and read-state endpoint.

## 1. Apply database migrations

Apply `supabase/migrations/20261104001300_notifications_engine.sql`, `supabase/migrations/20261104001400_notification_dispatch_claims.sql`, `supabase/migrations/20261105000100_activity_reminder_time.sql` (adds `activities.reminder_time`), and any earlier unapplied migrations to the linked project. Do not assume that a file in the repository has already been applied to Supabase.

## 2. Set Edge Function secrets

`OLLAMA_KEY` may also exist in Vercel, but Supabase Edge Functions cannot read Vercel environment variables. Add the same private key separately to the Supabase project. In Supabase Dashboard open **Project Settings → Edge Functions → Secrets** (or the Edge Functions Secrets page) and add the secrets below. Do not prefix the Ollama key with `NEXT_PUBLIC_` and do not put it in frontend code.

Set secrets in the Supabase project:

```bash
supabase secrets set \
  OLLAMA_KEY='THE_SAME_PRIVATE_KEY_CONFIGURED_IN_VERCEL' \
  OLLAMA_MODEL='gpt-oss:20b' \
  VAPID_PUBLIC_KEY='...' \
  VAPID_PRIVATE_KEY='...' \
  VAPID_SUBJECT='mailto:YOUR-REAL-CONTACT-EMAIL' \
  NOTIFICATION_CRON_SECRET='...'
```

Generate VAPID keys with `npx web-push generate-vapid-keys`. Generate the cron secret with `openssl rand -hex 32`. Never expose the VAPID private key, Ollama key, service-role key or cron secret to the browser.

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not manually copy the service-role key into Vercel or expose it to the browser. The service-role key is only used inside server-side Edge Function code.

## 3. Deploy functions

```bash
supabase functions deploy notification-compose
supabase functions deploy notification-dispatch --no-verify-jwt
supabase functions deploy notification-public-key
supabase functions deploy notification-subscribe
supabase functions deploy notifications
```

`notification-dispatch` verifies `x-cron-secret` itself. The other user-facing functions require the signed-in user's Supabase JWT.

## 4. Schedule dispatch

Open `supabase/manual/notification-scheduler.sql`, replace the anon key and cron secret placeholders, then run it once in Supabase SQL Editor. It calls the Edge Function every minute using Supabase Cron + pg_net. This works while the website is closed; Edge Functions are invoked by Cron and are not permanently running processes.

The Free Ollama plan includes starter credits and only a starter-model set; it is not an unlimited free inference API. The default `gpt-oss:20b` is the lower-usage option; the larger `gpt-oss:120b` can consume paid credits. Keep the Edge Function fallback enabled so notification delivery does not depend on AI availability.

## Task reminder ladder

Every active task scheduled for today climbs a ladder until it is completed: **10 minutes before**, **at the time**, **+20 min** and **+60 min**, plus pending-task summaries at 12:00, 15:00, 18:00 and 20:30 local time. The time is the task's `reminder_time`; tasks without one are spread evenly over their time-of-day window (morning 08:00–11:30, afternoon 12:00–16:30, evening 17:30–20:30, otherwise 09:00–20:00) so many tasks never fire in the same minute. With 15–20 tasks this produces 30+ notifications per day. Task reminders bypass quiet hours and the companion daily cap (they are explicit user requests), expire at the push service after 30 minutes, use high urgency and stay on screen until dismissed. Later stages of the same task replace the earlier notification on the device but still alert. Planning logic lives in `supabase/functions/_shared/reminders.ts` and is unit-tested.

## Companion digests

The worker creates at most one morning notification (08:00–08:59) and one evening check-in (20:30–21:29) per user's local timezone, then sends due pushes. AI wording is generated in small language/time templates and user-specific task counts are added server-side; task titles are not sent to Ollama for these scheduled messages. Notification history expires after 3 days. The default daily cap is 3.

## 5. Browser setup

Deploy the frontend over HTTPS. A user signs in and enables browser notifications on every device/browser. Each device has its own Web Push subscription. iOS push generally requires an installed Home Screen web app and compatible OS/browser version. Push delivery is best-effort and remains subject to permission, connectivity and OS policies: the Web Push standard cannot offer a 100% guarantee (battery savers and force-stopped browsers can delay or drop pushes). While notifications are not enabled on a device, the app shows a persistent full-screen prompt that returns every minute after being snoozed. On each page load the app silently re-registers an existing subscription with the server, and takes the device over if another account on the same browser still owned it.

## 6. Test

Call `notification-dispatch` through the scheduler or manually with the `x-cron-secret` header. Check Supabase Edge Function logs, Cron run history and `notification_deliveries` for delivery diagnostics.
