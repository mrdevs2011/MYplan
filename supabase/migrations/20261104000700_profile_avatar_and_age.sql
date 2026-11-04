-- 007: Enrich profiles with avatar_url, age and automatic updated_at trigger
alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists age integer check (age is null or (age between 6 and 122));

-- Function to automatically maintain updated_at timestamps
create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Attach updated_at triggers
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_current_timestamp_updated_at();

drop trigger if exists set_activities_updated_at on public.activities;
create trigger set_activities_updated_at
before update on public.activities
for each row execute function public.set_current_timestamp_updated_at();

-- Enhanced handle_new_user function to persist username, full_name, age, and avatar_url
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_age integer;
begin
  v_username := lower(coalesce(new.raw_user_meta_data ->> 'username', 'user_' || left(replace(new.id::text, '-', ''), 8)));
  begin
    v_age := (new.raw_user_meta_data ->> 'age')::integer;
  exception when others then
    v_age := null;
  end;

  insert into public.profiles (id, full_name, username, age, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_username,
    v_age,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    username = coalesce(public.profiles.username, excluded.username),
    age = coalesce(excluded.age, public.profiles.age),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now();

  return new;
end;
$$;
