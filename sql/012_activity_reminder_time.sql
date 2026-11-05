-- Optional per-task reminder time, interpreted in the owner's profile timezone.
alter table public.activities
  add column if not exists reminder_time time;

comment on column public.activities.reminder_time is
  'Local wall-clock time (profile timezone) when notification-dispatch reminds the user about this task. NULL = no reminder.';
