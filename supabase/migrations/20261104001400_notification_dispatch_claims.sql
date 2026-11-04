-- Prevent overlapping Cron invocations from dispatching the same notification.
alter table public.notifications
  add column if not exists dispatch_locked_until timestamptz;

create index if not exists notifications_dispatch_claim_idx
  on public.notifications (scheduled_at, dispatch_locked_until)
  where sent_at is null;

create or replace function public.claim_due_notifications(p_limit integer default 100)
returns setof public.notifications
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select n.id
    from public.notifications as n
    where n.sent_at is null
      and n.scheduled_at <= now()
      and n.scheduled_at >= now() - interval '24 hours'
      and n.expires_at > now()
      and (n.dispatch_locked_until is null or n.dispatch_locked_until <= now())
    order by n.scheduled_at asc
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 100)
  )
  update public.notifications as n
  set dispatch_locked_until = now() + interval '4 minutes'
  from candidates as c
  where n.id = c.id
  returning n.*;
$$;

revoke all on function public.claim_due_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(integer) to service_role;


-- A browser push endpoint must never be silently reassigned to a different account.
create or replace function public.prevent_push_subscription_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.user_id <> new.user_id then
    raise exception 'Push subscription ownership cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists push_subscription_owner_immutable on public.push_subscriptions;
create trigger push_subscription_owner_immutable
before update on public.push_subscriptions
for each row execute function public.prevent_push_subscription_owner_change();


-- Reassert server-only access even if the base migration was partially applied before.
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to service_role;

revoke all on public.notification_deliveries from anon, authenticated;
grant all on public.notification_deliveries to service_role;
