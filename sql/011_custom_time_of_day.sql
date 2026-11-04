-- 011: Allow custom time_of_day slots (e.g. custom_xxx or user-defined time names)
alter table public.activities
  drop constraint if exists activities_time_of_day_check;

alter table public.activities
  add constraint activities_time_of_day_check
  check (char_length(trim(time_of_day)) between 1 and 50);
