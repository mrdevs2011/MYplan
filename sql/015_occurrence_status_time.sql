-- 015: When a status was last changed, so a change queued offline never overwrites a newer one made elsewhere.
alter table public.occurrences add column if not exists status_changed_at timestamptz;
update public.occurrences set status_changed_at = created_at where status_changed_at is null;
alter table public.occurrences alter column status_changed_at set default now();
alter table public.occurrences alter column status_changed_at set not null;

create or replace function public.touch_occurrence_status_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A client replaying an old offline change passes its own time; every other status change is "now".
  if new.status is distinct from old.status and new.status_changed_at is not distinct from old.status_changed_at then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists occurrence_status_time on public.occurrences;
create trigger occurrence_status_time
before update on public.occurrences
for each row execute function public.touch_occurrence_status_time();
