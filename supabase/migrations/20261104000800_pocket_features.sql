-- 008: Add time_of_day to activities and streak tracking to profiles
alter table public.activities
  add column if not exists time_of_day text not null default 'anytime'
  check (time_of_day in ('morning', 'afternoon', 'evening', 'anytime'));

alter table public.profiles
  add column if not exists streak_count integer not null default 0,
  add column if not exists best_streak integer not null default 0,
  add column if not exists last_active_date date;

-- Index for time_of_day queries
create index if not exists activities_user_timeofday_idx
  on public.activities (user_id, time_of_day, is_active);
