-- Run once in Supabase SQL Editor after deploying notification-dispatch.
-- Replace all placeholders. Keep the cron secret only in Supabase Vault and Edge Function secrets.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://qjrclowuewxpejohzvqc.supabase.co', 'myplan_supabase_url');
select vault.create_secret('REPLACE_WITH_SUPABASE_ANON_OR_PUBLISHABLE_KEY', 'myplan_supabase_anon_key');
select vault.create_secret('REPLACE_WITH_NOTIFICATIONS_CRON_SECRET', 'myplan_notification_cron_secret');

select cron.schedule(
  'myplan-notification-dispatch',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'myplan_supabase_url') || '/functions/v1/notification-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'myplan_supabase_anon_key'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'myplan_notification_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);

select cron.schedule('myplan-notification-retention', '*/15 * * * *', $$delete from public.notifications where expires_at <= now();$$);
