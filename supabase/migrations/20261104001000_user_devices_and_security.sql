-- 010: Connected Devices table, Realtime support and Session Security
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_token text not null unique,
  device_name text not null,
  device_type text not null default 'desktop', -- 'mobile', 'tablet', 'desktop'
  browser_name text not null,
  os_name text not null,
  ip_address text,
  is_active boolean not null default true,
  last_active_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  revoked_at timestamp with time zone
);

-- High-speed indexes for instant (< 2ms) lookup and filtering
create index if not exists idx_user_devices_token on public.user_devices(session_token);
create index if not exists idx_user_devices_user_active on public.user_devices(user_id, is_active);

-- Enable Row Level Security
alter table public.user_devices enable row level security;

-- Drop existing policies if any to prevent conflicts
drop policy if exists "Users can view their own devices" on public.user_devices;
create policy "Users can view their own devices"
  on public.user_devices for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own device session" on public.user_devices;
create policy "Users can insert their own device session"
  on public.user_devices for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own device session" on public.user_devices;
create policy "Users can update their own device session"
  on public.user_devices for update
  using (auth.uid() = user_id);

-- Set replica identity to full for Realtime publication
alter table public.user_devices replica identity full;

-- Add to Realtime publication
do $$
begin
  alter publication supabase_realtime add table public.user_devices;
exception when duplicate_object then
  null;
end $$;
