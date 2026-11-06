"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconRepeat } from "@/components/icons";
import type { translations } from "@/lib/translations";

type T = Record<keyof (typeof translations)["uz"], string>;

interface TasbehTabProps {
  t: T;
  /** Per-account storage scope so counts don't leak between accounts. */
  scope: string;
}

interface TasbehState {
  count: number; // taps in the current round
  rounds: number; // completed rounds
  target: number; // 0 = endless
}

const TARGETS = [33, 99, 100, 0];
const DEFAULT_STATE: TasbehState = { count: 0, rounds: 0, target: 33 };
const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

const storageKey = (scope: string) => `myplan_account_${scope}_tasbeh`;

function load(scope: string): TasbehState {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<TasbehState>;
    const target = TARGETS.includes(Number(parsed.target)) ? Number(parsed.target) : DEFAULT_STATE.target;
    return {
      count: Math.max(0, Math.floor(Number(parsed.count)) || 0),
      rounds: Math.max(0, Math.floor(Number(parsed.rounds)) || 0),
      target,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Haptics are optional.
  }
}

export default function TasbehTab({ t, scope }: TasbehTabProps) {
  const [state, setState] = useState<TasbehState>(DEFAULT_STATE);
  const loaded = useRef(false);

  // Read the saved count after mount (localStorage is not available during SSR).
  useEffect(() => {
    const id = window.setTimeout(() => {
      setState(load(scope));
      loaded.current = true;
    }, 0);
    return () => {
      window.clearTimeout(id);
      loaded.current = false;
    };
  }, [scope]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(storageKey(scope), JSON.stringify(state));
    } catch {
      // Storage unavailable: counting still works for this session.
    }
  }, [state, scope]);

  const tap = useCallback(() => {
    setState((s) => {
      const count = s.count + 1;
      if (s.target > 0 && count >= s.target) {
        vibrate([40, 60, 40]);
        return { ...s, count: 0, rounds: s.rounds + 1 };
      }
      vibrate(12);
      return { ...s, count };
    });
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      if (s.count > 0) return { ...s, count: s.count - 1 };
      if (s.rounds > 0 && s.target > 0) return { ...s, count: s.target - 1, rounds: s.rounds - 1 };
      return s;
    });
  }, []);

  const reset = useCallback(() => setState((s) => ({ ...s, count: 0, rounds: 0 })), []);
  const setTarget = useCallback((target: number) => setState((s) => ({ ...s, target, count: 0 })), []);

  const total = state.rounds * Math.max(state.target, 0) + state.count;
  const progress = state.target > 0 ? state.count / state.target : 0;

  return (
    <div className="tasbeh-view">
      <div className="tasbeh-targets" role="group" aria-label={t.cnt_target}>
        {TARGETS.map((target) => (
          <button
            key={target}
            type="button"
            className={`time-chip ${state.target === target ? "active" : ""}`}
            aria-pressed={state.target === target}
            onClick={() => setTarget(target)}
          >
            {target === 0 ? "∞" : target}
          </button>
        ))}
      </div>

      <button type="button" className="tasbeh-tap" onClick={tap} aria-label={t.cnt_tap}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="time-ring-track" cx="50" cy="50" r={RING_R} />
          <circle
            className="time-ring-bar"
            cx="50"
            cy="50"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - Math.min(1, progress))}
          />
        </svg>
        <span className="tasbeh-tap-center">
          <span className="tasbeh-count">{state.count}</span>
          <span className="tasbeh-hint">{state.target > 0 ? `/ ${state.target}` : t.cnt_tap}</span>
        </span>
      </button>

      <div className="tasbeh-stats">
        <div className="tasbeh-stat">
          <span className="tasbeh-stat-value">{state.rounds}</span>
          <span className="tasbeh-stat-label">{t.cnt_rounds}</span>
        </div>
        <div className="tasbeh-stat">
          <span className="tasbeh-stat-value">{total}</span>
          <span className="tasbeh-stat-label">{t.cnt_total}</span>
        </div>
      </div>

      <div className="time-controls tasbeh-controls">
        <button type="button" className="time-btn" onClick={undo} disabled={total === 0}>
          <span>{t.cnt_undo}</span>
        </button>
        <button type="button" className="time-btn" onClick={reset} disabled={total === 0}>
          <IconRepeat className="icon-xs" />
          <span>{t.cnt_reset}</span>
        </button>
      </div>
    </div>
  );
}
