-- 006: Add a unique username to each profile for MYPLAN's username-based UI.
alter table public.profiles
  add column if not exists username text;

-- Existing accounts receive a stable generated username; users can later change it
-- through a dedicated profile flow with the same uniqueness validation.
update public.profiles
set username = 'user_' || left(replace(id::text, '-', ''), 8)
where username is null or btrim(username) = '';

alter table public.profiles
  alter column username set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format
      check (username ~ '^[a-z0-9_]{3,24}$');
  end if;
end;
$$;

create unique index if not exists profiles_username_lower_unique_idx
  on public.profiles (lower(username));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    lower(coalesce(new.raw_user_meta_data ->> 'username', 'user_' || left(replace(new.id::text, '-', ''), 8)))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
