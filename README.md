# MYPLAN

A personal activity planner built around flexible schedules, measurable progress, and meaningful streaks.

## Stack

- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase PostgreSQL, Auth, and Row Level Security
- Vercel deployment

## Environment variables

Set these variables in **Vercel → Project → Settings → Environment Variables** and select the environments where they should apply (Production, Preview, Development):

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable key (`sb_publishable_...`) |

For local development, copy `.env.example` to `.env.local` and fill in the same values. Restart the dev server after changing environment variables. Redeploy after changing Vercel variables; they are injected at build/deployment time.

The Supabase browser and server clients are provided in `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`. Do not put Supabase secret/service-role keys in `NEXT_PUBLIC_*` variables or commit them to Git.

## Development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000.

## Product principles

- Every new account starts completely empty.
- Activities support daily, weekly, monthly, custom, and one-time schedules.
- Completion can be a simple check-off or measurable progress (count, pages, repetitions, volume, etc.).
- Every progress change is recorded as an event so history and analytics remain trustworthy.
- Streaks follow the activity's schedule, not a universal daily rule.

See [`docs/PRODUCT.md`](docs/PRODUCT.md) for the product and data model foundation.
