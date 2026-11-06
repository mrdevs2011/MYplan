import { createClient as createPlainClient } from "@supabase/supabase-js";
import { listAccountSessions, saveAccountSession } from "./account-sessions";
import { getSupabasePublicEnv } from "./supabase/env";

/**
 * Notification permission and the push subscription belong to the BROWSER, not to one account. The server keeps one
 * row per (account, browser endpoint), so every account saved in this browser must register that same endpoint:
 * then a notification for any of them reaches this browser, whichever account is open right now.
 */

function tokenExpiresSoon(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return !payload.exp || payload.exp * 1000 - Date.now() < 60_000;
  } catch {
    return true;
  }
}

async function usableToken(stored: { access_token: string; refresh_token: string }): Promise<string | null> {
  if (!tokenExpiresSoon(stored.access_token)) return stored.access_token;
  const { url, publishableKey } = getSupabasePublicEnv();
  // A separate, memory-only client: refreshing here must not touch the session of the account that is open.
  const client = createPlainClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.setSession(stored);
  if (error || !data.session) return null;
  saveAccountSession(data.session); // refresh tokens rotate: keep the new pair
  return data.session.access_token;
}

const registered = new Set<string>();

/** Register this browser's push subscription for every OTHER saved account. Best effort, once per endpoint+account. */
export async function registerPushForSavedAccounts(
  currentUserId: string,
  subscription: PushSubscriptionJSON,
  userAgent: string,
): Promise<void> {
  if (!subscription.endpoint) return;
  const { url, publishableKey } = getSupabasePublicEnv();
  for (const [accountId, stored] of Object.entries(listAccountSessions())) {
    if (accountId === currentUserId) continue;
    const mark = `${subscription.endpoint}|${accountId}`;
    if (registered.has(mark)) continue;
    try {
      const token = await usableToken(stored);
      if (!token) continue;
      const response = await fetch(`${url}/functions/v1/notification-subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: publishableKey, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...subscription, userAgent }),
      });
      if (response.ok) registered.add(mark);
    } catch (error) {
      console.warn("Push registration for a saved account failed:", error);
    }
  }
}
