"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconPlay, IconPause, IconRepeat, IconPlus, IconClock, IconBell } from "@/components/icons";
import { playMelody, type MelodyHandle } from "@/lib/timer-melody";
import { useSyncedState } from "@/lib/use-synced-state";
import type { Language, translations } from "@/lib/translations";

type T = Record<keyof (typeof translations)["uz"], string>;
type SubTab = "timer" | "stopwatch" | "clock";

interface TimeTabProps {
  t: T;
  language: Language;
  /** Signed-in account: timer, stopwatch and melody choice follow it across devices. */
  userId: string | null;
  soundEnabled: boolean;
}

const LOCALES: Record<Language, string> = { uz: "uz-UZ", en: "en-US", ru: "ru-RU" };

// Browsers ship incomplete Uzbek locale data (it renders "M11 5, Thu"), so spell it out.
const UZ_WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

function formatDate(d: Date, language: Language) {
  if (language === "uz") return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]}, ${UZ_WEEKDAYS[d.getDay()]}`;
  const text = d.toLocaleDateString(LOCALES[language] || "en-US", { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const pad = (n: number) => String(n).padStart(2, "0");

function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatStopwatch(ms: number) {
  const total = Math.max(0, Math.floor(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000);
  return { main: `${pad(m)}:${pad(s)}`, cs: pad(cs) };
}

function beep() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [0, 0.25, 0.5].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.21);
    });
  } catch {
    // Sound is optional.
  }
}

/** Wall-clock "now" (epoch ms), refreshed every `ms` while `active`. 0 until the first tick. */
function useNow(active: boolean, ms: number) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, ms);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [active, ms]);
  return now;
}

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

function Ring({ progress, children, done }: { progress: number; children: React.ReactNode; done?: boolean }) {
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <div className={`time-ring ${done ? "is-done" : ""}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="time-ring-track" cx="50" cy="50" r={RING_R} />
        <circle
          className="time-ring-bar"
          cx="50"
          cy="50"
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - clamped)}
        />
      </svg>
      <div className="time-ring-center">{children}</div>
    </div>
  );
}

/* ----------------------------------------------------------------- Timer */

interface TimerState {
  duration: number; // ms
  endAt: number | null; // epoch ms while running
  remaining: number; // ms while paused / idle
  done: boolean;
}

const DEFAULT_TIMER: TimerState = { duration: 5 * 60000, endAt: null, remaining: 5 * 60000, done: false };

function normalizeTimer(raw: unknown): TimerState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<TimerState>;
  const duration =
    typeof r.duration === "number" && Number.isFinite(r.duration)
      ? Math.min(99 * 60000, Math.max(60000, r.duration))
      : DEFAULT_TIMER.duration;
  const endAt = typeof r.endAt === "number" && Number.isFinite(r.endAt) ? r.endAt : null;
  const remaining = typeof r.remaining === "number" && r.remaining >= 0 ? Math.min(r.remaining, duration) : duration;
  // Finished while nobody was looking: show it as finished, without beeping.
  if (endAt !== null && endAt <= Date.now()) return { duration, endAt: null, remaining: 0, done: true };
  return { duration, endAt, remaining, done: Boolean(r.done) };
}

function TimerPanel({ t, userId, soundEnabled }: Pick<TimeTabProps, "t" | "userId" | "soundEnabled">) {
  // This panel only mounts client-side (after login), so the device copy can be read right away.
  const { value: state, set: setState } = useSyncedState<TimerState>(userId, "timer", DEFAULT_TIMER, normalizeTimer, {
    lazyLocal: true,
  });
  const soundRef = useRef(soundEnabled);
  useEffect(() => {
    soundRef.current = soundEnabled;
  }, [soundEnabled]);

  // The melody can be switched off for good; the choice is remembered per account.
  const { value: music, set: setMusic } = useSyncedState<{ on: boolean }>(
    userId,
    "timer_music",
    { on: true },
    (raw) => ({ on: !(raw && typeof raw === "object" && (raw as { on?: unknown }).on === false) }),
    { lazyLocal: true },
  );
  const musicOn = music.on;
  const musicRef = useRef(musicOn);
  useEffect(() => {
    musicRef.current = musicOn;
  }, [musicOn]);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const melodyRef = useRef<MelodyHandle | null>(null);

  // Browsers only let a page make sound after a tap. Starting the timer is that tap, so the audio is unlocked
  // silently here and reused when the time is up, minutes later. Nothing plays at this point.
  const unlockAudio = useCallback(() => {
    try {
      if (!audioRef.current) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) audioRef.current = new AudioCtx();
      }
      void audioRef.current?.resume();
    } catch {
      // Sound is optional.
    }
  }, []);

  const stopMelody = useCallback(() => {
    melodyRef.current?.stop();
    melodyRef.current = null;
    setPlaying(false);
  }, []);

  const toggleMusic = () => {
    const next = !musicOn;
    musicRef.current = next;
    setMusic({ on: next });
    if (!next) stopMelody();
  };

  useEffect(() => () => melodyRef.current?.stop(), []);

  const running = state.endAt !== null;
  const now = useNow(running, 100);
  const remaining = running ? Math.max(0, state.endAt! - Math.max(now, state.endAt! - state.duration)) : state.remaining;

  useEffect(() => {
    if (running && remaining <= 0) {
      setState((s) => ({ ...s, endAt: null, remaining: 0, done: true }));
      if (soundRef.current && musicRef.current) {
        const ctx = audioRef.current;
        void ctx?.resume();
        const handle = ctx ? playMelody(ctx, () => { melodyRef.current = null; setPlaying(false); }) : null;
        if (handle) {
          melodyRef.current = handle;
          setPlaying(true);
        } else {
          beep();
        }
      } else if (soundRef.current) {
        beep();
      }
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        // Not supported.
      }
    }
  }, [running, remaining, setState]);

  const setDuration = (ms: number) => {
    const duration = Math.min(99 * 60000, Math.max(60000, ms));
    setState({ duration, endAt: null, remaining: duration, done: false });
  };

  const toggle = () => {
    stopMelody();
    unlockAudio();
    if (running) {
      setState((s) => ({ ...s, endAt: null, remaining: Math.max(0, s.endAt! - Date.now()) }));
    } else {
      const left = state.done || state.remaining <= 0 ? state.duration : state.remaining;
      setState((s) => ({ ...s, done: false, remaining: left, endAt: Date.now() + left }));
    }
  };

  const reset = () => {
    stopMelody();
    setState((s) => ({ ...s, endAt: null, remaining: s.duration, done: false }));
  };
  const idle = !running && remaining === state.duration && !state.done;
  const pristine = !running && !state.done && remaining === state.duration;

  return (
    <>
      <Ring progress={state.duration ? remaining / state.duration : 0} done={state.done}>
        <span className="time-digits">{state.done ? "00:00" : formatClock(remaining)}</span>
        <span className="time-note">{state.done ? t.clk_up : `${Math.round(state.duration / 60000)} ${t.clk_min}`}</span>
      </Ring>

      <div className="time-extra">
        {idle || pristine ? (
          <div className="time-presets">
            <button type="button" className="time-chip" onClick={() => setDuration(state.duration - 60000)} aria-label="−1">
              −
            </button>
            {[1, 5, 10, 25].map((m) => (
              <button
                key={m}
                type="button"
                className={`time-chip ${state.duration === m * 60000 ? "active" : ""}`}
                onClick={() => setDuration(m * 60000)}
              >
                {m}
              </button>
            ))}
            <button type="button" className="time-chip" onClick={() => setDuration(state.duration + 60000)} aria-label="+1">
              <IconPlus className="icon-xs" />
            </button>
          </div>
        ) : null}
      </div>

      {playing ? (
        <button type="button" className="time-btn music-stop-btn" onClick={stopMelody}>
          <IconBell className="icon-xs" />
          <span>{t.clk_music_stop}</span>
        </button>
      ) : null}

      <div className="time-controls">
        <button type="button" className="time-btn primary" onClick={toggle}>
          {running ? <IconPause className="icon-xs" /> : <IconPlay className="icon-xs" />}
          <span>{running ? t.clk_pause : state.remaining < state.duration && !state.done ? t.clk_resume : t.clk_start}</span>
        </button>
        <button type="button" className="time-btn" onClick={reset} disabled={idle && !state.done}>
          <IconRepeat className="icon-xs" />
          <span>{t.clk_reset}</span>
        </button>
      </div>

      <button
        type="button"
        className={`time-chip music-toggle ${musicOn ? "active" : ""}`}
        onClick={toggleMusic}
        aria-pressed={musicOn}
        disabled={!soundEnabled}
      >
        <IconBell className="icon-xs" />
        <span>{musicOn ? t.clk_music_on : t.clk_music_off}</span>
      </button>
    </>
  );
}

/* ------------------------------------------------------------- Stopwatch */

interface StopwatchState {
  startedAt: number | null; // epoch ms while running
  base: number; // accumulated ms before the current run
  laps: number[]; // cumulative ms at each lap
}

const DEFAULT_STOPWATCH: StopwatchState = { startedAt: null, base: 0, laps: [] };

function normalizeStopwatch(raw: unknown): StopwatchState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<StopwatchState>;
  return {
    startedAt: typeof r.startedAt === "number" && Number.isFinite(r.startedAt) ? r.startedAt : null,
    base: typeof r.base === "number" && r.base >= 0 ? r.base : 0,
    laps: Array.isArray(r.laps) ? r.laps.filter((lap): lap is number => typeof lap === "number" && lap >= 0) : [],
  };
}

function StopwatchPanel({ t, userId }: Pick<TimeTabProps, "t" | "userId">) {
  const { value: state, set: setState } = useSyncedState<StopwatchState>(
    userId,
    "stopwatch",
    DEFAULT_STOPWATCH,
    normalizeStopwatch,
    { lazyLocal: true },
  );

  const running = state.startedAt !== null;
  const now = useNow(running, 40);
  const elapsed = state.base + (running ? Math.max(0, now - state.startedAt!) : 0);
  const { main, cs } = formatStopwatch(elapsed);

  const toggle = () =>
    setState((s) =>
      s.startedAt !== null
        ? { ...s, startedAt: null, base: s.base + (Date.now() - s.startedAt) }
        : { ...s, startedAt: Date.now() },
    );
  const lap = () =>
    setState((s) => {
      const total = s.base + (s.startedAt ? Date.now() - s.startedAt : 0);
      const prev = s.laps.length ? s.laps[s.laps.length - 1] : 0;
      // Ignore accidental double taps (a real lap is never < 0.25s after the last one).
      if (total - prev < 250) return s;
      return { ...s, laps: [...s.laps, total].slice(-99) };
    });
  const reset = () => setState({ startedAt: null, base: 0, laps: [] });

  // Full history (up to 99 laps), newest first so the lap you just took is always on top; the list scrolls.
  const lastLaps = state.laps
    .map((total, index) => ({ n: index + 1, split: total - (index > 0 ? state.laps[index - 1] : 0), total }))
    .reverse();

  return (
    <>
      <Ring progress={(elapsed % 60000) / 60000}>
        <span className="time-digits">{main}</span>
        <span className="time-note time-cs">.{cs}</span>
      </Ring>

      <div className="time-extra time-extra-laps">
        <ul className="time-laps">
          {lastLaps.length === 0 ? (
            <li className="time-lap-empty">{t.clk_no_laps}</li>
          ) : (
            lastLaps.map((l) => (
              <li key={l.n}>
                <span>#{l.n}</span>
                <span>{formatStopwatch(l.split).main}.{formatStopwatch(l.split).cs}</span>
                <span className="time-lap-total">{formatStopwatch(l.total).main}.{formatStopwatch(l.total).cs}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="time-controls">
        <button type="button" className="time-btn primary" onClick={toggle}>
          {running ? <IconPause className="icon-xs" /> : <IconPlay className="icon-xs" />}
          <span>{running ? t.clk_pause : state.base > 0 ? t.clk_resume : t.clk_start}</span>
        </button>
        {running ? (
          <button type="button" className="time-btn" onClick={lap}>
            <IconClock className="icon-xs" />
            <span>{t.clk_lap}</span>
          </button>
        ) : (
          <button type="button" className="time-btn" onClick={reset} disabled={state.base === 0 && state.laps.length === 0}>
            <IconRepeat className="icon-xs" />
            <span>{t.clk_reset}</span>
          </button>
        )}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- Clock */

function ClockPanel({ language }: Pick<TimeTabProps, "language">) {
  const nowMs = useNow(true, 250);
  const now = nowMs ? new Date(nowMs) : null;
  const d = now ?? new Date(0);
  const sec = d.getSeconds();
  const min = d.getMinutes() + sec / 60;
  const hour = (d.getHours() % 12) + min / 60;
  let timeZone = "";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Ignore.
  }

  return (
    <>
      <div className="time-ring time-analog">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="time-ring-track" cx="50" cy="50" r={RING_R} />
          {Array.from({ length: 12 }, (_, i) => (
            <line
              key={i}
              className="time-tick"
              x1="50"
              y1="8"
              x2="50"
              y2={i % 3 === 0 ? "13" : "11"}
              transform={`rotate(${i * 30} 50 50)`}
            />
          ))}
          <line className="time-hand hour" x1="50" y1="50" x2="50" y2="29" transform={`rotate(${hour * 30} 50 50)`} />
          <line className="time-hand minute" x1="50" y1="50" x2="50" y2="18" transform={`rotate(${min * 6} 50 50)`} />
          <line className="time-hand second" x1="50" y1="56" x2="50" y2="14" transform={`rotate(${sec * 6} 50 50)`} />
          <circle className="time-pin" cx="50" cy="50" r="2.2" />
        </svg>
      </div>

      <div className="time-extra time-clock-info">
        <span className="time-digits time-digital">
          {now ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : "--:--:--"}
        </span>
        <span className="time-note">
          {now ? formatDate(d, language) : ""}
        </span>
        {timeZone ? <span className="time-note time-tz">{timeZone}</span> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Tab */

export default function TimeTab({ t, language, userId, soundEnabled }: TimeTabProps) {
  const [sub, setSub] = useState<SubTab>("timer");
  const tabs: Array<{ id: SubTab; label: string }> = [
    { id: "timer", label: t.clk_timer },
    { id: "stopwatch", label: t.clk_stopwatch },
    { id: "clock", label: t.clk_clock },
  ];
  const select = useCallback((id: SubTab) => setSub(id), []);

  return (
    <div className="time-view">
      {/* Mobile only: switch between the three tools. Desktop shows all three. */}
      <div className="time-subtabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={sub === tab.id}
            className={`time-subtab ${sub === tab.id ? "active" : ""}`}
            onClick={() => select(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="time-grid">
        <section className="time-card" data-active={sub === "timer"}>
          <h2 className="time-card-title">{t.clk_timer}</h2>
          <TimerPanel t={t} userId={userId} soundEnabled={soundEnabled} />
        </section>
        <section className="time-card" data-active={sub === "stopwatch"}>
          <h2 className="time-card-title">{t.clk_stopwatch}</h2>
          <StopwatchPanel t={t} userId={userId} />
        </section>
        <section className="time-card" data-active={sub === "clock"}>
          <h2 className="time-card-title">{t.clk_clock}</h2>
          <ClockPanel language={language} />
        </section>
      </div>
    </div>
  );
}
