#!/usr/bin/env bash
# One-time setup for MYplan notification scheduling. Run from the repo root while logged in:
#   supabase login --token <token>   then   bash scripts/setup-notification-cron.sh
# It rotates NOTIFICATION_CRON_SECRET, stores the same value in Supabase Vault and schedules the
# per-minute dispatcher via pg_cron + pg_net. The secret never touches disk outside a temp file that is deleted.
set -euo pipefail
REF="${SUPABASE_PROJECT_REF:-qjrclowuewxpejohzvqc}"
set -a; . ./.env.local; set +a
: "${NEXT_PUBLIC_SUPABASE_URL:?missing in .env.local}" "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?missing in .env.local}"
SECRET="$(openssl rand -hex 32)"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
supabase secrets set NOTIFICATION_CRON_SECRET="$SECRET" --project-ref "$REF"
# Vault entries are replaced, not duplicated, so the script can be re-run safely.
{
  echo "delete from vault.secrets where name in ('myplan_supabase_url','myplan_supabase_anon_key','myplan_notification_cron_secret');"
  sed -e "s|https://qjrclowuewxpejohzvqc.supabase.co|$NEXT_PUBLIC_SUPABASE_URL|" \
      -e "s|REPLACE_WITH_SUPABASE_ANON_OR_PUBLISHABLE_KEY|$NEXT_PUBLIC_SUPABASE_ANON_KEY|" \
      -e "s|REPLACE_WITH_NOTIFICATIONS_CRON_SECRET|$SECRET|" supabase/manual/notification-scheduler.sql
} > "$TMP"
! grep -q "REPLACE_WITH" "$TMP" || { echo "placeholder left in SQL"; exit 1; }
supabase db query --linked -f "$TMP" >/dev/null
supabase db query --linked "select jobname, schedule, active from cron.job order by jobname;"
echo "Done. Dispatcher now runs every minute."
