-- 013: Tasbeh (counter) state, one row per user, synced across devices.
create table if not exists public.tasbeh_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  count integer not null default 0 check (count >= 0),
  rounds integer not null default 0 check (rounds >= 0),
  target integer not null default 33 check (target in (0, 33, 99, 100)),
  total_taps bigint not null default 0 check (total_taps >= 0),
  updated_at timestamptz not null default now()
);

alter table public.tasbeh_counters enable row level security;

drop policy if exists "tasbeh_counters_select_own" on public.tasbeh_counters;
create policy "tasbeh_counters_select_own" on public.tasbeh_counters
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "tasbeh_counters_insert_own" on public.tasbeh_counters;
create policy "tasbeh_counters_insert_own" on public.tasbeh_counters
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "tasbeh_counters_update_own" on public.tasbeh_counters;
create policy "tasbeh_counters_update_own" on public.tasbeh_counters
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
