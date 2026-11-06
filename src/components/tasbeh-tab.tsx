"use client";

import { useEffect, useState } from "react";
import { IconBeads, IconRepeat, IconClose } from "@/components/icons";
import { TASBEH_TARGETS } from "@/lib/tasbeh";
import type { Tasbeh } from "@/lib/use-tasbeh";
import type { translations } from "@/lib/translations";

type T = Record<keyof (typeof translations)["uz"], string>;

interface TasbehProps {
  t: T;
  tasbeh: Tasbeh;
}

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

/** The counter itself: used as the Sanash tab on mobile and inside the floating panel on desktop. */
export default function TasbehTab({ t, tasbeh }: TasbehProps) {
  const { state, tap, undo, reset, setTarget } = tasbeh;
  const progress = state.target > 0 ? state.count / state.target : 0;

  return (
    <div className="tasbeh-view">
      <div className="tasbeh-targets" role="group" aria-label={t.cnt_target}>
        {TASBEH_TARGETS.map((target) => (
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
          <span className="tasbeh-stat-value">{state.total}</span>
          <span className="tasbeh-stat-label">{t.cnt_total}</span>
        </div>
      </div>

      <div className="time-controls tasbeh-controls">
        <button type="button" className="time-btn" onClick={undo} disabled={state.total === 0}>
          <span>{t.cnt_undo}</span>
        </button>
        <button type="button" className="time-btn" onClick={reset} disabled={state.total === 0}>
          <IconRepeat className="icon-xs" />
          <span>{t.cnt_reset}</span>
        </button>
      </div>
    </div>
  );
}

/** Desktop only (hidden by CSS on phones): a round button that opens the counter over any page. */
export function TasbehFloat({ t, tasbeh }: TasbehProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="tasbeh-float">
      {open && (
        <section className="tasbeh-float-panel" role="dialog" aria-label={t.cnt_title}>
          <header className="tasbeh-float-head">
            <span className="tasbeh-float-title">{t.cnt_title}</span>
            <button type="button" className="tasbeh-float-close" onClick={() => setOpen(false)} aria-label="×">
              <IconClose className="icon-sm" />
            </button>
          </header>
          <TasbehTab t={t} tasbeh={tasbeh} />
        </section>
      )}
      <button
        type="button"
        className={`tasbeh-fab ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t.cnt_title}
        title={t.cnt_title}
      >
        <IconBeads className="icon-md" />
        {!open && tasbeh.state.count > 0 && <span className="tasbeh-fab-badge">{tasbeh.state.count}</span>}
      </button>
    </div>
  );
}
