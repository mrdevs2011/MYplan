-- 003: Scheduled activity occurrences. Historical rows are kept when schedules change.
create table if not exists public.occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  target numeric(12,2),
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped')),
  created_at timestamptz not null default now(),
  unique (activity_id, period_start),
  check (period_end >= period_start),
  check (target is null or target > 0)
);

create index if not exists occurrences_user_period_idx
  on public.occurrences (user_id, period_start, period_end);
create index if not exists occurrences_activity_period_idx
  on public.occurrences (activity_id, period_start desc);
