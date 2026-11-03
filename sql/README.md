# MYPLAN database migrations

Run these files in **Supabase Dashboard → SQL Editor**, in numeric order, once per project:

1. `001_profiles.sql` — profile table and automatic profile creation on Auth signup.
2. `002_activities.sql` — personal activity definitions.
3. `003_occurrences.sql` — scheduled activity periods.
4. `004_progress_events.sql` — append-only progress history.
5. `005_row_level_security.sql` — per-user access policies.

Run each file as a whole and confirm it completes before moving to the next. These scripts are designed to be safely re-run for the initial schema. Do not run them against a production database containing important data without a backup.

## Auth setup required

SQL does **not** create a Supabase project or enable password authentication. In Supabase, enable Email provider under Authentication → Sign In / Providers. Configure email confirmation according to your preference. Then set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only in Vercel → Project → Settings → Environment Variables, then redeploy. Do not create local `.env` files; use `vercel dev` for local development.
