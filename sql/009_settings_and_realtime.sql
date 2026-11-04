-- 009: Cloud Sync for Settings and Realtime enablement
alter table public.profiles
  add column if not exists language text not null default 'uz',
  add column if not exists counter_steps jsonb not null default '[10, 5, 1]'::jsonb,
  add column if not exists sound_enabled boolean not null default true,
  add column if not exists notifications_enabled boolean not null default true,
  add column if not exists auto_archive_delay integer not null default 7;

-- Set replica identity to full so update/delete events have complete row data in Realtime
alter table public.profiles replica identity full;
alter table public.activities replica identity full;
alter table public.occurrences replica identity full;

-- Add tables to supabase_realtime publication
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.activities;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.occurrences;
exception when duplicate_object then
  null;
end $$;
