"use client";

import { useCallback } from "react";
import { useSyncedState } from "@/lib/use-synced-state";
import {
  EMPTY_TASBEH,
  normalizeTasbeh,
  resetTasbeh,
  setTasbehActivity,
  setTasbehTarget,
  tapTasbeh,
  undoTasbeh,
  type TasbehState,
} from "@/lib/tasbeh";

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
  setActivity: (activityId: string | null) => void;
  /** The saved copy has been read: only then is it safe to decide anything from `state`. */
  ready: boolean;
}

/** Tasbeh counter: instant locally, saved on the server and mirrored live to the account's other devices. */
export function useTasbeh(userId: string | null): Tasbeh {
  const { value: state, set, ready } = useSyncedState<TasbehState>(userId, "tasbeh", EMPTY_TASBEH, normalizeTasbeh);

  const tap = useCallback(() => {
    set((s) => {
      const next = tapTasbeh(s);
      vibrate(next.rounds > s.rounds ? [40, 60, 40] : 12);
      return next;
    });
  }, [set]);
  const undo = useCallback(() => set(undoTasbeh), [set]);
  const reset = useCallback(() => set(resetTasbeh), [set]);
  const setTarget = useCallback((target: number) => set((s) => setTasbehTarget(s, target)), [set]);

  const setActivity = useCallback((activityId: string | null) => set((s) => setTasbehActivity(s, activityId)), [set]);

  return { state, tap, undo, reset, setTarget, setActivity, ready };
}
