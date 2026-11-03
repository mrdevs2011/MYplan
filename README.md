# MYPLAN

A personal activity planner built around flexible schedules, measurable progress, and meaningful streaks.

## Product principles

- Every new account starts completely empty.
- Activities support daily, weekly, monthly, custom, and one-time schedules.
- Completion can be a simple check-off or measurable progress (count, pages, repetitions, volume, etc.).
- Every progress change is recorded as an event so history and analytics remain trustworthy.
- Streaks follow the activity's schedule, not a universal daily rule.

## Planned stack

- Next.js + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase: PostgreSQL, Auth, Row Level Security
- Vercel deployment

## Local development

The application scaffold will be added after the Supabase project configuration is ready.

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase project URL and publishable key.
3. Install dependencies with `npm install`.
4. Start the app with `npm run dev`.

Never commit `.env.local`, Supabase secret keys, or service-role keys.
