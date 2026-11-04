# MYPLAN

A personal activity planner built around flexible schedules, measurable progress, and meaningful streaks.

## Stack

- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase PostgreSQL, Auth, and Row Level Security
- Vercel deployment

## Environment variables

Configure the two public Supabase values in **Vercel → Project → Settings → Environment Variables** for Production, Preview, and Development as needed:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable key; legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted as a fallback |

`OLLAMA_KEY` is a private credential used by the notification **Supabase Edge Functions**, not by the Next.js browser app. The Vercel variable with that name is not automatically available to Supabase. Add the same Ollama key separately in **Supabase Dashboard → Edge Functions → Secrets** (or with `supabase secrets set OLLAMA_KEY=...`). Never rename it to `NEXT_PUBLIC_OLLAMA_KEY` or expose it to the browser. See [`docs/NOTIFICATIONS_SETUP.md`](docs/NOTIFICATIONS_SETUP.md) for the full notification secrets and deployment setup.

The Supabase browser and server clients are provided in `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`. Do not put Supabase secret/service-role keys in `NEXT_PUBLIC_*` variables or commit them to Git.

Vercel injects its environment variables at build/deployment time. Redeploy after changing them. For local development, use `vercel dev` after linking and authenticating the Vercel CLI; `.env.example` documents the public variables only.

## Development

```bash
npm install
npx vercel dev
```

Open http://localhost:3000.

## Product principles

- Every new account starts completely empty.
- Activities support daily, weekly, monthly, custom, and one-time schedules.
- Completion can be a simple check-off or measurable progress (count, pages, repetitions, volume, etc.).
- Every progress change is recorded as an event so history and analytics remain trustworthy.
- Streaks follow the activity's schedule, not a universal daily rule.

See [`docs/PRODUCT.md`](docs/PRODUCT.md) for the product and data model foundation.
