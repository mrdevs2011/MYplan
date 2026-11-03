# MYPLAN Reliability Notes

## Baseline verification

Run before and after code changes:

```bash
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

## Known gaps

- There is no automated unit, integration, or end-to-end test suite yet. Lint/typecheck/build passing is not proof of runtime auth correctness.
- Login, signup, email-confirmation, token-refresh, and sign-out flows still need integration tests against a non-production Supabase project.
- The dashboard and activity lifecycle are not implemented yet.
- SQL migrations have not been verified as applied to the remote Supabase database.

## Change policy

- Do not change auth semantics or persisted schema without a backward-compatible plan.
- Keep RLS ownership checks aligned across parent/child records.
- Do not claim a database migration is deployed until the remote schema is checked.
