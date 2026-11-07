"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tasbeh } from "@/lib/use-tasbeh";
import { suggestTarget, type TasbehPlan } from "@/lib/tasbeh-plans";

const FLUSH_AFTER_MS = 1000;

export interface TasbehLinked extends Tasbeh {
  /** Open plans the taps can be booked on, best first. */
  plans: TasbehPlan[];
  linked: TasbehPlan | null;
  /** Taps still missing on the linked plan, counting the ones not booked yet. */
  remaining: number | null;
  autoChosen: boolean;
  setPlan: (activityId: string | null) => void;
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Haptics are optional.
  }
}

/**
 * Books tasbeh taps on today's plan. Taps are collected for a second and booked together (one progress record,
 * not one per tap); leaving the page, switching plan, resetting or reaching the goal books them at once.
 */
export function useTasbehPlans(
  tasbeh: Tasbeh,
  allPlans: TasbehPlan[],
  autoId: string | null,
  onLog: (activityId: string, delta: number) => void,
): TasbehLinked {
  const { state, ready, tap: baseTap, undo: baseUndo, reset: baseReset, setTarget, setActivity } = tasbeh;
  const [pending, setPending] = useState(0);
  const [autoChosen, setAutoChosen] = useState(false);
  const pendingRef = useRef(0);
  const sinceLink = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const onLogRef = useRef(onLog);
  const activityRef = useRef<string | null>(state.activityId);
  const linkedRef = useRef<TasbehPlan | null>(null);
  const countRef = useRef(state.count);
  const explicitNone = useRef(false);

  const linked = useMemo(() => allPlans.find((plan) => plan.id === state.activityId) ?? null, [allPlans, state.activityId]);
  const plans = useMemo(() => allPlans.filter((plan) => !plan.done), [allPlans]);

  useEffect(() => {
    onLogRef.current = onLog;
    activityRef.current = state.activityId;
    linkedRef.current = linked;
    countRef.current = state.count;
  });

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const amount = pendingRef.current;
    const id = activityRef.current;
    pendingRef.current = 0;
    setPending(0);
    if (amount > 0 && id) onLogRef.current(id, amount);
  }, []);

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const tap = useCallback(() => {
    baseTap();
    const plan = linkedRef.current;
    if (!plan || plan.done || !activityRef.current) return;
    pendingRef.current += 1;
    sinceLink.current += 1;
    setPending(pendingRef.current);
    if (plan.remaining - pendingRef.current <= 0) {
      vibrate([60, 80, 60, 80, 140]);
      flush();
    } else {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, FLUSH_AFTER_MS);
    }
  }, [baseTap, flush]);

  const undo = useCallback(() => {
    baseUndo();
    if (!activityRef.current || sinceLink.current <= 0) return;
    sinceLink.current -= 1;
    if (pendingRef.current > 0) {
      pendingRef.current -= 1;
      setPending(pendingRef.current);
    } else {
      onLogRef.current(activityRef.current, -1);
    }
  }, [baseUndo]);

  const reset = useCallback(() => {
    flush();
    sinceLink.current = 0;
    baseReset();
  }, [baseReset, flush]);

  const link = useCallback(
    (activityId: string | null, plan: TasbehPlan | null) => {
      setActivity(activityId);
      sinceLink.current = 0;
      // A round only when the plan is exactly 33, 66 or 99 taps; otherwise endless. Never disturb a round in progress.
      if (countRef.current === 0) setTarget(suggestTarget(plan?.remaining ?? 0));
    },
    [setActivity, setTarget],
  );

  const setPlan = useCallback(
    (activityId: string | null) => {
      flush();
      explicitNone.current = activityId === null;
      setAutoChosen(false);
      link(activityId, activityId ? allPlans.find((plan) => plan.id === activityId) ?? null : null);
    },
    [allPlans, flush, link],
  );

  // A quiet pre-selection, only while nothing is chosen and no round is under way.
  useEffect(() => {
    if (!ready || state.activityId || explicitNone.current || !autoId || state.count > 0) return;
    const plan = plans.find((item) => item.id === autoId);
    if (!plan) return;
    const timeout = window.setTimeout(() => {
      link(plan.id, plan);
      setAutoChosen(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [ready, state.activityId, state.count, autoId, plans, link]);

  // The plan is finished (here or on another device): let go of it, so later taps are not booked on a done plan.
  useEffect(() => {
    if (!linked?.done) return;
    const timeout = window.setTimeout(() => {
      flush();
      setActivity(null);
      setAutoChosen(false);
      if (countRef.current === 0) setTarget(0);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [linked?.done, flush, setActivity, setTarget]);

  const remaining = linked && !linked.done ? Math.max(0, linked.remaining - pending) : null;

  return { ...tasbeh, tap, undo, reset, plans, linked: linked && !linked.done ? linked : null, remaining, autoChosen, setPlan };
}
