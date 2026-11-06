# MYPLAN database deployment

The SQL files in this directory are the canonical schema scripts. Matching Supabase CLI migrations are mirrored in `supabase/migrations/` and the project is linked in `supabase/config.toml`.

**Do not run `supabase db push` until the remote migration history is reconciled.** The live tables already exist, but the current CLI identity cannot read the remote migration history (`database_write` permission is missing). If these scripts were previously applied through the Dashboard SQL Editor, first verify all 11 schema changes on the linked project, then use `supabase migration repair --status applied <version>` for each verified version. Only then use `supabase db push` for future migrations. Take a database backup before any schema change.

## Migration order

1. `001_profiles.sql` — profiles and automatic profile creation on Auth signup.
2. `002_activities.sql` — activity definitions, schedules, and ownership.
3. `003_occurrences.sql` — scheduled activity occurrences.
4. `004_progress_events.sql` — append-only progress history.
5. `005_row_level_security.sql` — per-user RLS policies for core tables.
6. `006_username_auth.sql` — unique usernames and username signup metadata.
7. `007_profile_avatar_and_age.sql` — profile fields and `updated_at` triggers.
8. `008_pocket_features.sql` — time-of-day, streak, and preference fields.
9. `009_settings_and_realtime.sql` — settings columns and Realtime publication.
10. `010_user_devices_and_security.sql` — device registry and device-session RLS.
11. `011_custom_time_of_day.sql` — custom time-of-day values.
12. `012_activity_reminder_time.sql` — optional per-task reminder time (`activities.reminder_time`).
13. `013_tasbeh_counters.sql` — tasbeh (counter) state per user, with owner-only RLS.

The scripts use `IF NOT EXISTS`/replace patterns where practical, but they are not a substitute for reviewing the target schema and backing up production data. Do not blindly replay modified scripts against a live database.

## Auth configuration

- Enable the Email provider under **Authentication → Sign In / Providers**.
- The current username-only UI maps normalized usernames to a reserved non-deliverable address under `@users.myplan.invalid`, because Supabase password auth requires an email or phone identifier.
- Disable email confirmation only if this username-only flow is intentionally retained. These addresses cannot receive email, so email-based password recovery is unavailable. Before production use, add and verify a real recovery method or change the identity flow.
- Configure allowed redirect URLs and site URL for the real production domain.
- Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the deployment environment. Never expose a service-role key in browser code or commit it.

## Production verification checklist

- Confirm all 11 migrations have been applied to the correct Supabase project and reconcile the CLI migration history before using `supabase db push`.
- Verify RLS is enabled on `profiles`, `activities`, `occurrences`, `progress_events`, and `user_devices`.
- Test two separate accounts to confirm one user cannot read or mutate another user's rows.
- Test signup, login, session refresh, logout, password update, and device revocation against a non-production project first.
- Configure Auth rate limits, CAPTCHA/abuse protection, backup/PITR policy, database alerts, and Realtime only for tables that need it.
- Do not delete Auth users or application rows until the target project and the intended data scope have been independently verified.
- A browser clean-slate epoch only signs out/clears browser-local MYplan state on the next visit; it does not delete Auth users, database rows, or Storage objects.

## Important current limitations

The client app currently depends on public Supabase access plus RLS. Administrative operations such as deleting Auth users require a trusted server-side service-role context; they must never be implemented using the browser publishable key. The username-only reserved-email flow also has no email recovery path.
