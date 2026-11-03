-- 004: Append-only progress history. Corrections are represented as new events.
create table if not exists public.progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null references public.occurrences(id) on delete cascade,
  amount numeric(12,2) not null,
  note text not null default '',
  recorded_at timestamptz not null default now(),
  check (amount <> 0)
);

create index if not exists progress_events_occurrence_time_idx
  on public.progress_events (occurrence_id, recorded_at);
create index if not exists progress_events_user_time_idx
  on public.progress_events (user_id, recorded_at desc);
