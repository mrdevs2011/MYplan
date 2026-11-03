-- 005: Enable Row Level Security and restrict every user's rows to that user.
alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.occurrences enable row level security;
alter table public.progress_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "activities_select_own" on public.activities;
create policy "activities_select_own" on public.activities
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "activities_insert_own" on public.activities;
create policy "activities_insert_own" on public.activities
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "activities_update_own" on public.activities;
create policy "activities_update_own" on public.activities
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "activities_delete_own" on public.activities;
create policy "activities_delete_own" on public.activities
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "occurrences_select_own" on public.occurrences;
create policy "occurrences_select_own" on public.occurrences
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "occurrences_insert_own" on public.occurrences;
create policy "occurrences_insert_own" on public.occurrences
  for insert to authenticated with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.activities a
      where a.id = activity_id and a.user_id = (select auth.uid())
    )
  );
drop policy if exists "occurrences_update_own" on public.occurrences;
create policy "occurrences_update_own" on public.occurrences
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "occurrences_delete_own" on public.occurrences;
create policy "occurrences_delete_own" on public.occurrences
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "progress_events_select_own" on public.progress_events;
create policy "progress_events_select_own" on public.progress_events
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "progress_events_insert_own" on public.progress_events;
create policy "progress_events_insert_own" on public.progress_events
  for insert to authenticated with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.occurrences o
      where o.id = occurrence_id and o.user_id = (select auth.uid())
    )
  );
-- No UPDATE or DELETE policies: progress history is append-only for clients.
