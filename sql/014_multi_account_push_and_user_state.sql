-- 014: (1) Several accounts on one browser share its push endpoint.
--      (2) user_state: small per-user settings and tools (timer, stopwatch, tasbeh, theme, ...) synced in realtime.

-- 1. A push subscription belongs to the browser, not to one account: one row per (account, endpoint).
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_key;
create unique index if not exists push_subscriptions_user_endpoint_key
  on public.push_subscriptions (user_id, endpoint);
create index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions (endpoint);

-- 2. Generic synced state: one JSON document per user and key, last write (updated_at) wins.
create table if not exists public.user_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 64),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_state enable row level security;

drop policy if exists "user_state_select_own" on public.user_state;
create policy "user_state_select_own" on public.user_state
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "user_state_insert_own" on public.user_state;
create policy "user_state_insert_own" on public.user_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "user_state_update_own" on public.user_state;
create policy "user_state_update_own" on public.user_state
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "user_state_delete_own" on public.user_state;
create policy "user_state_delete_own" on public.user_state
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.user_state replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.user_state;
exception when duplicate_object then
  null;
end $$;

-- Tasbeh moved from tasbeh_counters to user_state; carry over anything already saved (the old table is kept).
insert into public.user_state (user_id, key, value, updated_at)
select user_id, 'tasbeh',
       jsonb_build_object('count', count, 'rounds', rounds, 'target', target, 'total', total_taps),
       updated_at
from public.tasbeh_counters
on conflict (user_id, key) do nothing;
