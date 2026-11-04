-- 002: User-owned activity definitions. New accounts start with no activities.
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '',
  schedule_type text not null check (schedule_type in ('daily', 'weekly', 'monthly', 'custom', 'once')),
  schedule_rule jsonb not null default '{}'::jsonb,
  measurement_type text not null default 'check' check (measurement_type in ('check', 'count', 'pages', 'duration', 'volume', 'custom')),
  target numeric(12,2),
  unit text not null default '',
  is_active boolean not null default true,
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target is null or target > 0),
  check (ends_on is null or ends_on >= starts_on)
);

create index if not exists activities_user_active_idx
  on public.activities (user_id, is_active, created_at desc);
