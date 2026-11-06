"use client";

import { useEffect, useRef, useState } from "react";
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

interface Offset {
  x: number;
  y: number;
}

/** Desktop only (hidden by CSS on phones): a round button that opens the counter over any page.
 *  Both the button and the panel's title bar can be dragged; the spot is kept until the page reloads. */
export function TasbehFloat({ t, tasbeh, open, onOpenChange }: TasbehProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // A smaller window must not strand the button off-screen.
  useEffect(() => {
    const onResize = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const shiftX = rect.left < 0 ? -rect.left : rect.right > window.innerWidth ? window.innerWidth - rect.right : 0;
      const shiftY = rect.top < 0 ? -rect.top : rect.bottom > window.innerHeight ? window.innerHeight - rect.bottom : 0;
      if (shiftX !== 0 || shiftY !== 0) setOffset((o) => ({ x: o.x + shiftX, y: o.y + shiftY }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = (e: React.PointerEvent<HTMLElement>, bounds: HTMLElement | null) => {
    if (e.button !== 0 || !bounds || (e.target as HTMLElement).closest("[data-no-drag]")) return;
    const handle = e.currentTarget;
    const rect = bounds.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const base = offset;
    moved.current = false;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved.current) {
        if (Math.hypot(dx, dy) < 4) return;
        moved.current = true;
        setDragging(true);
      }
      // Keep the whole dragged element inside the window.
      const cx = Math.min(Math.max(dx, -rect.left), window.innerWidth - rect.right);
      const cy = Math.min(Math.max(dy, -rect.top), window.innerHeight - rect.bottom);
      setOffset({ x: base.x + cx, y: base.y + cy });
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setDragging(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      ref={anchorRef}
      className={`tasbeh-float ${dragging ? "is-dragging" : ""}`}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {open ? (
        <section ref={panelRef} className="tasbeh-float-panel" role="dialog" aria-label={t.cnt_title}>
          <header className="tasbeh-float-head" onPointerDown={(e) => startDrag(e, panelRef.current)}>
            <span className="tasbeh-float-title">{t.cnt_title}</span>
            <button type="button" data-no-drag className="tasbeh-float-close" onClick={() => onOpenChange(false)} aria-label="×">
              <IconClose className="icon-sm" />
            </button>
          </header>
          <TasbehTab t={t} tasbeh={tasbeh} />
        </section>
      ) : (
        <button
          ref={fabRef}
          type="button"
          className="tasbeh-fab"
          onPointerDown={(e) => startDrag(e, fabRef.current)}
          onClick={() => {
            if (moved.current) {
              moved.current = false;
              return;
            }
            onOpenChange(true);
          }}
          aria-label={t.cnt_title}
          title={t.cnt_title}
        >
          <IconBeads className="icon-md" />
          {tasbeh.state.count > 0 && <span className="tasbeh-fab-badge">{tasbeh.state.count}</span>}
        </button>
      )}
    </div>
  );
}
