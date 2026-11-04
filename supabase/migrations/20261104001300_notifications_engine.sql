-- Durable notification center and per-device Web Push subscriptions.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('daily','streak','productivity','motivation','evening','system')),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  data jsonb not null default '{}'::jsonb,
  dedupe_key text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  expires_at timestamptz not null default (now() + interval '3 days'),
  created_at timestamptz not null default now(),
  constraint notifications_user_dedupe_unique unique (user_id, dedupe_key)
);
create index if not exists notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index if not exists notifications_pending_idx on public.notifications(scheduled_at) where sent_at is null;
create index if not exists notifications_expiry_idx on public.notifications(expires_at);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_label text,
  is_active boolean not null default true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_active_idx on public.push_subscriptions(user_id) where is_active;

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  push_enabled boolean not null default false,
  quiet_hours_enabled boolean not null default true,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '08:00',
  daily_limit smallint not null default 3 check (daily_limit between 0 and 10),
  category_settings jsonb not null default '{"daily":true,"streak":true,"productivity":true,"motivation":true,"evening":true,"system":true}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
grant select on public.notifications to authenticated;
alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Push endpoints and encryption keys are server-only. Clients must never read or write this table directly.
revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to service_role;

drop policy if exists notification_preferences_read_own on public.notification_preferences;
create policy notification_preferences_read_own on public.notification_preferences for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own on public.notification_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own on public.notification_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.notifications replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- Per-device delivery ledger: prevents duplicate pushes and supports bounded retries.
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','dead')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  unique (notification_id, subscription_id)
);
create index if not exists notification_deliveries_retry_idx on public.notification_deliveries(next_attempt_at) where status in ('pending','failed');
alter table public.notification_deliveries enable row level security;

-- Clients may only mark their own notification as read; all content and delivery fields are server-owned.
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
