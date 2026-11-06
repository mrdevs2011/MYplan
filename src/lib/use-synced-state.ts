"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const SYNC_DELAY_MS = 250;

interface Box<T> {
  value: T;
  /** Epoch ms of the last change. The newer copy wins, on this device and on the server. */
  at: number;
}

export interface SyncedState<T> {
  value: T;
  set: (next: T | ((prev: T) => T)) => void;
  /** Time of the last change (0 = never written anywhere). */
  at: number;
  /** True once the saved copy (device, then server) has been read. */
  ready: boolean;
}

/**
 * One small piece of per-account state (timer, stopwatch, tasbeh, theme, ...) kept in three places:
 * React state (instant), the device (works offline) and the `user_state` table. Other devices of the same
 * account receive every change through Realtime. Newer `at` wins; a device's own echo is ignored.
 */
export function useSyncedState<T>(
  userId: string | null,
  key: string,
  fallback: T,
  normalize: (raw: unknown) => T,
  options: { lazyLocal?: boolean; merge?: (local: T, remote: T) => T } = {},
): SyncedState<T> {
  const scope = userId || "guest";
  const localKey = `myplan_account_${scope}_state_${key}`;

  const readLocal = useCallback((): Box<T> & { synced: number } => {
    try {
      const raw = localStorage.getItem(localKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { value?: unknown; at?: unknown; synced?: unknown };
        return { value: normalize(parsed.value), at: Number(parsed.at) || 0, synced: Number(parsed.synced) || 0 };
      }
    } catch {
      // Unreadable copy: start from the default.
    }
    return { value: fallback, at: 0, synced: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localKey]);

  const [box, setBox] = useState<Box<T>>(() =>
    options.lazyLocal && typeof window !== "undefined" ? readLocal() : { value: fallback, at: 0 },
  );
  const [ready, setReady] = useState(false);
  const boxRef = useRef(box);
  const readyRef = useRef(false);
  // Time of the newest copy known to be on the server. A device copy newer than this has NOT been uploaded yet.
  const lastSynced = useRef(0);
  const mergeRef = useRef(options.merge);
  useEffect(() => {
    mergeRef.current = options.merge;
  }, [options.merge]);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    boxRef.current = box;
  }, [box]);

  const flush = useCallback(async () => {
    if (!userId) return;
    const b = boxRef.current;
    if (b.at <= lastSynced.current) return;
    try {
      const { error } = await createClient().from("user_state").upsert({
        user_id: userId,
        key,
        value: b.value as never,
        updated_at: new Date(b.at).toISOString(),
      });
      if (error) throw error;
      lastSynced.current = Math.max(lastSynced.current, b.at);
      try {
        localStorage.setItem(localKey, JSON.stringify({ ...b, synced: lastSynced.current }));
      } catch {
        // Storage unavailable: the next load simply treats the copy as not uploaded yet.
      }
    } catch (error) {
      // Offline: the device copy stays and the next change or reconnect pushes it.
      console.warn(`State "${key}" could not sync:`, error);
    }
  }, [userId, key, localKey]);

  const adopt = useCallback(
    (raw: unknown, at: number) => {
      const local = boxRef.current;
      // Both sides changed since they last agreed (this device offline, another one online): combine them
      // when the data allows it, instead of letting the newer clock erase the other side's work.
      if (mergeRef.current && local.at > lastSynced.current && at > lastSynced.current) {
        const merged: Box<T> = { value: mergeRef.current(local.value, normalize(raw)), at: Math.max(local.at, at) + 1 };
        lastSynced.current = Math.max(lastSynced.current, at);
        boxRef.current = merged;
        setBox(merged);
        return;
      }
      if (at <= local.at) return;
      lastSynced.current = Math.max(lastSynced.current, at);
      const next = { value: normalize(raw), at };
      boxRef.current = next;
      setBox(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pull = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await createClient()
        .from("user_state")
        .select("value, updated_at")
        .eq("user_id", userId)
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      if (data) adopt(data.value, Date.parse(data.updated_at) || 0);
    } catch (error) {
      console.warn(`State "${key}" could not load:`, error);
    }
  }, [userId, key, adopt]);

  // Load: device copy, then the server copy, then push a newer device copy (changed offline).
  useEffect(() => {
    let cancelled = false;
    readyRef.current = false;
    lastSynced.current = 0;
    const id = window.setTimeout(async () => {
      const local = readLocal();
      lastSynced.current = local.synced;
      boxRef.current = { value: local.value, at: local.at };
      setBox({ value: local.value, at: local.at });
      await pull();
      if (cancelled) return;
      readyRef.current = true;
      setReady(true);
      void flush();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      window.clearTimeout(timer.current);
      readyRef.current = false;
      setReady(false);
      void flush();
    };
  }, [readLocal, pull, flush]);

  // Realtime: changes made on other devices arrive here.
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`user_state:${key}:${userId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_state", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { key?: string; value?: unknown; updated_at?: string } | null;
          if (!row || row.key !== key || !row.updated_at) return;
          adopt(row.value, Date.parse(row.updated_at) || 0);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, key, adopt]);

  // Persist on the device and schedule the server write.
  useEffect(() => {
    if (!readyRef.current || box.at === 0) return;
    try {
      localStorage.setItem(localKey, JSON.stringify({ ...box, synced: lastSynced.current }));
    } catch {
      // Storage unavailable: the state still works for this session.
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SYNC_DELAY_MS);
  }, [box, localKey, flush]);

  // Catch up right away when the page returns or the connection comes back; push before the page goes away.
  useEffect(() => {
    const catchUp = () => {
      void pull().then(flush);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") catchUp();
      else {
        window.clearTimeout(timer.current);
        void flush();
      }
    };
    const onHide = () => {
      window.clearTimeout(timer.current);
      void flush();
    };
    window.addEventListener("online", catchUp);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", catchUp);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pull, flush]);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setBox((b) => {
      const value = typeof next === "function" ? (next as (prev: T) => T)(b.value) : next;
      if (Object.is(value, b.value)) return b;
      return { value, at: Math.max(Date.now(), b.at + 1) };
    });
  }, []);

  return { value: box.value, set, at: box.at, ready };
}
