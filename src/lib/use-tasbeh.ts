"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  EMPTY_TASBEH,
  normalizeTasbeh,
  resetTasbeh,
  setTasbehTarget,
  tapTasbeh,
  undoTasbeh,
  type TasbehState,
} from "@/lib/tasbeh";

const localKey = (scope: string) => `myplan_account_${scope}_tasbeh`;
const SYNC_DELAY_MS = 700;

function readLocal(scope: string): TasbehState {
  try {
    const raw = localStorage.getItem(localKey(scope));
    return raw ? normalizeTasbeh(JSON.parse(raw)) : EMPTY_TASBEH;
  } catch {
    return EMPTY_TASBEH;
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Haptics are optional.
  }
}

export interface Tasbeh {
  state: TasbehState;
  tap: () => void;
  undo: () => void;
  reset: () => void;
  setTarget: (target: number) => void;
}

/**
 * Tasbeh state, kept on the device first (instant, works offline) and mirrored to the server so the count
 * follows the account across devices. The copy with the newer `updatedAt` wins when they differ.
 */
export function useTasbeh(userId: string | null): Tasbeh {
  const scope = userId || "guest";
  const [state, setState] = useState<TasbehState>(EMPTY_TASBEH);
  const stateRef = useRef(state);
  const ready = useRef(false);
  const lastSynced = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const flush = useCallback(async () => {
    if (!userId) return;
    const s = stateRef.current;
    if (s.updatedAt <= lastSynced.current) return;
    try {
      const { error } = await createClient().from("tasbeh_counters").upsert({
        user_id: userId,
        count: s.count,
        rounds: s.rounds,
        target: s.target,
        total_taps: s.total,
        updated_at: new Date(s.updatedAt).toISOString(),
      });
      if (error) throw error;
      lastSynced.current = Math.max(lastSynced.current, s.updatedAt);
    } catch (error) {
      // Offline or table not created yet: the local copy stays and the next change or reconnect retries.
      console.warn("Tasbeh sync failed:", error);
    }
  }, [userId]);

  // Load: local copy first, then the server copy if it is newer.
  useEffect(() => {
    let cancelled = false;
    ready.current = false;
    lastSynced.current = 0;
    const id = window.setTimeout(async () => {
      let next = readLocal(scope);
      stateRef.current = next;
      if (userId) {
        try {
          const { data, error } = await createClient()
            .from("tasbeh_counters")
            .select("count, rounds, target, total_taps, updated_at")
            .eq("user_id", userId)
            .maybeSingle();
          if (error) throw error;
          if (data) {
            const serverAt = Date.parse(data.updated_at) || 0;
            lastSynced.current = serverAt;
            if (serverAt > next.updatedAt) {
              next = normalizeTasbeh({
                count: data.count,
                rounds: data.rounds,
                target: data.target,
                total: data.total_taps,
                updatedAt: serverAt,
              });
            }
          }
        } catch (error) {
          console.warn("Tasbeh could not load from the server:", error);
        }
      }
      if (cancelled) return;
      stateRef.current = next;
      setState(next);
      ready.current = true;
      void flush(); // a newer local copy (made offline) goes up now
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      window.clearTimeout(timer.current);
      ready.current = false;
      void flush();
    };
  }, [scope, userId, flush]);

  // Save: device now, server shortly after the last tap.
  useEffect(() => {
    if (!ready.current) return;
    try {
      localStorage.setItem(localKey(scope), JSON.stringify(state));
    } catch {
      // Storage unavailable: counting still works for this session.
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SYNC_DELAY_MS);
  }, [state, scope, flush]);

  // Push right away when the page is hidden or the connection returns.
  useEffect(() => {
    const push = () => {
      window.clearTimeout(timer.current);
      void flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") push();
    };
    window.addEventListener("online", push);
    window.addEventListener("pagehide", push);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", push);
      window.removeEventListener("pagehide", push);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  const apply = useCallback((change: (s: TasbehState) => TasbehState) => {
    setState((s) => {
      const next = change(s);
      return next === s ? s : { ...next, updatedAt: Math.max(Date.now(), s.updatedAt + 1) };
    });
  }, []);

  const tap = useCallback(() => {
    apply((s) => {
      const next = tapTasbeh(s);
      vibrate(next.rounds > s.rounds ? [40, 60, 40] : 12);
      return next;
    });
  }, [apply]);
  const undo = useCallback(() => apply(undoTasbeh), [apply]);
  const reset = useCallback(() => apply(resetTasbeh), [apply]);
  const setTarget = useCallback((target: number) => apply((s) => setTasbehTarget(s, target)), [apply]);

  return { state, tap, undo, reset, setTarget };
}
