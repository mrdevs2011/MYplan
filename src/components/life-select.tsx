"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface LifeSelectOption {
  value: string;
  label: string;
  group?: string;
  detail?: string;
  icon?: ReactNode;
}

interface LifeSelectProps {
  value: string;
  options: LifeSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}

export function LifeSelect({ value, options, onChange, ariaLabel, className = "", placeholder, id, disabled = false }: LifeSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popupPosition, setPopupPosition] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const groups = options.reduce<Array<{ label?: string; items: Array<{ option: LifeSelectOption; index: number }> }>>((result, option, index) => {
    const last = result[result.length - 1];
    if (!last || last.label !== option.group) result.push({ label: option.group, items: [] });
    result[result.length - 1].items.push({ option, index });
    return result;
  }, []);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const below = window.innerHeight - anchor.bottom;
      const above = anchor.top;
      const openAbove = below < 250 && above > below;
      const available = Math.max(150, (openAbove ? above : below) - 20);
      setPopupPosition({
        left: anchor.left,
        width: anchor.width,
        maxHeight: Math.min(390, window.innerHeight * 0.55, available),
        ...(openAbove ? { bottom: window.innerHeight - anchor.top + 9 } : { top: anchor.bottom + 9 }),
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const choose = (option: LifeSelectOption) => {
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div className={`life-select ${className}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        role="combobox"
        className={`life-select-trigger ${open ? "is-open" : ""}`}
        aria-label={ariaLabel}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-option-${activeIndex}` : undefined}
        onClick={() => {
          setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            setActiveIndex((current) => event.key === "ArrowDown" ? Math.min(options.length - 1, current + 1) : Math.max(0, current - 1));
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            const option = options[activeIndex];
            if (option) choose(option);
          }
        }}
      >
        <span className="life-select-current">
          {selected?.icon && <span className="life-select-current-icon" aria-hidden="true">{selected.icon}</span>}
          <span className="life-select-current-copy">
            <span className="life-select-current-label">{selected?.label ?? placeholder}</span>
            {selected?.group && <span className="life-select-current-meta">{selected.group}</span>}
          </span>
        </span>
        <svg className="life-select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && popupPosition && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          className="life-select-popover"
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={{ position: "fixed", left: popupPosition.left, width: popupPosition.width, top: popupPosition.top, bottom: popupPosition.bottom, maxHeight: popupPosition.maxHeight }}
        >
          {groups.map((group, groupIndex) => (
            <div className="life-select-group" key={`${group.label ?? "options"}-${groupIndex}`}>
              {group.label && <div className="life-select-group-label">{group.label}</div>}
              {group.items.map(({ option, index }) => (
                <button
                  type="button"
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={`life-select-option ${option.value === value ? "is-selected" : ""} ${activeIndex === index ? "is-active" : ""}`}
                  key={option.value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  {option.icon && <span className="life-select-option-icon" aria-hidden="true">{option.icon}</span>}
                  <span className="life-select-option-copy">
                    <span className="life-select-option-label">{option.label}</span>
                    {option.detail && <span className="life-select-option-detail">{option.detail}</span>}
                  </span>
                  {option.value === value && <svg className="life-select-check" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
