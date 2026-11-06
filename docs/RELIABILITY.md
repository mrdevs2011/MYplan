# MYPLAN Reliability Notes

## Baseline verification

Run before and after code changes:

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

## Current safeguards

- TypeScript strict mode is enabled.
- ESLint uses the Next.js Core Web Vitals and TypeScript configurations.
- Supabase public environment values are validated centrally before client creation.
- Auth session refresh is handled in `src/proxy.ts`; the proxy is bypassed when Supabase is not configured so static builds/previews remain usable.
- Database access is protected with per-user RLS policies.

- Every progress and status change is written to a durable outbox first, then uploaded in order (`src/lib/progress-sync.ts`). Server snapshots are merged by event id, so a late response cannot move a number or checkbox backwards.
- Background refreshes are silent. Only the first load of a session may show the spinner, and repeated Supabase auth events for the same user do not restart the workspace.
- The plan form saves a draft on every change. Only Cancel and a successful save clear it.
- All notifications pass through `toNotification`; rows without real text are refused.

## Known gaps

- Unit tests cover sync and habit learning only (`npm test`). There is no automated integration or end-to-end suite; lint/typecheck/build passing is not proof of runtime auth correctness.
- Login, signup, email-confirmation, token-refresh, and sign-out flows still need integration tests against a non-production Supabase project.
- Remote Supabase migration state could not be verified from the current linked CLI identity (the API returned missing `database_write` permission).
- The username-only reserved-email authentication flow has no email-based recovery path.
- The v4 clean-slate client epoch signs out a browser and clears MYplan/Supabase local and session storage on its next visit; it does not delete Auth users, database rows, or Storage objects, and cannot force an already-open tab to log out immediately.

## Change policy

- Do not change auth semantics or persisted schema without a backward-compatible plan.
- Keep RLS ownership checks aligned across parent/child records.
- Do not claim a database migration is deployed until the remote schema is checked.
