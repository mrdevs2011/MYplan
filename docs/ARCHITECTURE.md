# MYPLAN Architecture

## Current stack

- Next.js App Router with React and TypeScript.
- Supabase Auth through `@supabase/ssr` and `@supabase/supabase-js`.
- Vercel-hosted public Supabase configuration (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Local `.env*` files are intentionally not used.

## Application boundaries

- `src/app`: route entry points, page UI, metadata, and global styling.
- `src/lib/supabase/env.ts`: validates the two public Supabase environment values.
- `src/lib/supabase/client.ts`: browser Supabase client.
- `src/lib/supabase/server.ts`: server Supabase client with cookie integration.
- `src/proxy.ts`: refreshes the Supabase auth session on matched requests.
- `sql/`: ordered database schema and Row Level Security migrations.

## Authentication flow

1. The landing page checks whether public Supabase configuration exists.
2. Sign-up uses `auth.signUp`; sign-in uses `auth.signInWithPassword`.
3. The browser auth listener mirrors the current session into the page state.
4. The proxy calls `auth.getUser()` to refresh/validate the request session and forwards refreshed cookies.

The current authenticated UI is a signed-in confirmation state. A protected dashboard and activity CRUD flows have not yet been implemented.

## Username authentication

The UI accepts a username and password only. Since Supabase password auth requires an email or phone identifier, MYPLAN deterministically maps a normalized username to `username@users.myplan.invalid` internally. The username is also stored in `profiles.username` by the Auth signup trigger. Email confirmation must be disabled for this flow because the reserved address cannot receive mail. Email-based recovery is therefore unavailable until a verified recovery channel is added. Apply `sql/006_username_auth.sql` after the earlier migrations.

## Data ownership and security

- `profiles.id` references `auth.users.id`.
- `activities`, `occurrences`, and `progress_events` carry `user_id` ownership.
- RLS policies scope reads and writes to `auth.uid()`.
- Occurrence writes must reference an activity owned by the same authenticated user.
- Progress events are append-only for client roles (no UPDATE/DELETE policies).

Run SQL migrations in numeric order as documented in `sql/README.md`. These files describe the intended schema; committing them does not apply them to the Supabase database.

## Operational constraints

- Keep secrets out of source control and local `.env*` files. Configure public Supabase values in Vercel Environment Variables.
- Use `vercel dev` for local development when Vercel environment values are needed.
- Preserve existing auth and data contracts when adding dashboard features.
