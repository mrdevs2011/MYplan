-- 012: Cross-device realtime synchronization for counter progress.
-- Progress is append-only and scoped by the existing per-user RLS policies.
alter table public.progress_events replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.progress_events;
exception when duplicate_object then
  null;
end $$;
