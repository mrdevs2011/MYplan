import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "./supabase/env";

/**
 * Per-account Supabase sessions for the multi-account switcher.
 *
 * Supabase only keeps ONE active session per browser, so to let the user hop
 * between accounts without retyping a password we keep each signed-in account's
 * token pair here and restore it with `auth.setSession()` on switch. These are
 * the same tokens Supabase already stores in this browser's cookies/storage.
 * Refresh tokens rotate, so the entry is refreshed on every auth state change.
 */
const SESSIONS_KEY = "myplan_account_sessions";

interface StoredSession {
  access_token: string;
  refresh_token: string;
}

type SessionMap = Record<string, StoredSession>;

function readAll(): SessionMap {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as SessionMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: SessionMap) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable/full: switching falls back to the password login.
  }
}

export function saveAccountSession(session: Session | null | undefined) {
  if (typeof window === "undefined" || !session?.user || !session.refresh_token) return;
  const map = readAll();
  map[session.user.id] = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  };
  writeAll(map);
}

export function removeAccountSession(userId: string) {
  if (typeof window === "undefined") return;
  const map = readAll();
  delete map[userId];
  writeAll(map);
}

/** Drop sessions of accounts that are no longer in the vault. */
export function pruneAccountSessions(keepIds: string[]) {
  if (typeof window === "undefined") return;
  const keep = new Set(keepIds);
  const map = readAll();
  let changed = false;
  for (const id of Object.keys(map)) {
    if (!keep.has(id)) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) writeAll(map);
}

/**
 * Restore a saved account's session. Returns true on success. On failure
 * (expired/revoked refresh token) the stale entry is removed so the caller can
 * fall back to the password login for that account.
 */
export async function restoreAccountSession(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const stored = readAll()[userId];
  if (!stored) return false;
  const { data, error } = await supabase.auth.setSession(stored);
  if (error || data.session?.user.id !== userId) {
    removeAccountSession(userId);
    return false;
  }
  saveAccountSession(data.session);
  return true;
}

/** Revoke a session server-side without touching the browser's current one. */
export async function revokeSessionToken(accessToken: string): Promise<void> {
  try {
    const { url, publishableKey } = getSupabasePublicEnv();
    await fetch(`${url}/auth/v1/logout?scope=global`, {
      method: "POST",
      headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Best effort; the local copy is removed regardless.
  }
}
