"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlay, IconPause, IconRepeat, IconPlus, IconClock, IconBell } from "@/components/icons";
import { playMelody, type MelodyHandle } from "@/lib/timer-melody";
import { useSyncedState } from "@/lib/use-synced-state";
import { formatTimeLeft } from "@/lib/counter-steps";
import { defaultMinutesFor, freezeOrder, minutesToLog, smartPresets, type TimeTask } from "@/lib/time-tasks";
import type { Language, translations } from "@/lib/translations";

type T = Record<keyof (typeof translations)["uz"], string>;
type SubTab = "timer" | "stopwatch" | "clock";

interface TimeTabProps {
  t: T;
  language: Language;
  /** Signed-in account: timer, stopwatch and melody choice follow it across devices. */
  userId: string | null;
  soundEnabled: boolean;
  /** Today's plans the timer and stopwatch can be linked to (already in the best order). */
  tasks: TimeTask[];
  /** The plan the app would pick right now; offered as one tap, never forced. */
  suggestedTaskId: string | null;
  /** A plan so clearly the right one that an idle timer or stopwatch is simply set to it (and can be changed). */
  autoTaskId: string | null;
  /** A session was started for this plan (feeds what the app offers next time). */
  onUseTask: (activityId: string) => void;
  /** This browser. The device that started a session is the one that books its time. */
  deviceId: string;
  /** "Start a timer for this plan" from a task card. */
  launch: { activityId: string; nonce: number } | null;
  onLogMinutes: (activityId: string, minutes: number) => void;
  onCompleteTask: (activityId: string) => void;
}

interface TaskLinkProps {
  t: T;
  tasks: TimeTask[];
  suggestedTaskId: string | null;
  value: string | null;
  disabled: boolean;
  /** The plan was chosen by the app, not by the person: say so, quietly. */
  autoChosen: boolean;
  onChange: (activityId: string | null) => void;
}

/** Which plan this session is for. Quiet by default: the suggestion is one chip, nothing is chosen for the person. */
function TaskLink({ t, tasks, suggestedTaskId, value, disabled, autoChosen, onChange }: TaskLinkProps) {
  const labels = { sec: t.step_sec, min: t.step_min };
  const current = tasks.find((task) => task.id === value) ?? null;
  const suggested = !value ? tasks.find((task) => task.id === suggestedTaskId && !task.done) ?? null : null;
  const describe = (task: TimeTask) =>
    task.minuteBased && task.remainingMin !== null && !task.done
      ? `${task.title} · ${formatTimeLeft(task.remainingMin, labels)} ${t.step_left}`
      : task.title;
  return (
    <div className="time-task-link">
      <select
        className="time-task-select"
        value={value ?? ""}
        disabled={disabled}
        aria-label={t.clk_task_label}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{t.clk_task_none}</option>
        {tasks.map((task) => (
          <option key={task.id} value={task.id}>
            {describe(task)}
          </option>
        ))}
        {value && !current ? <option value={value}>…</option> : null}
      </select>
      {suggested && !disabled ? (
        <button type="button" className="time-task-suggest" onClick={() => onChange(suggested.id)}>
          {t.clk_task_suggest}: {suggested.title}
        </button>
      ) : null}
      {autoChosen && value ? <span className="time-task-auto">{t.clk_task_auto}</span> : null}
    </div>
  );
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
  activityId: string | null; // the plan this session is for
  owner: string | null; // the browser that started it: only that one books the time
  logged: boolean; // the time has been put on the plan
}

const DEFAULT_TIMER: TimerState = {
  duration: 5 * 60000,
  endAt: null,
  remaining: 5 * 60000,
  done: false,
  activityId: null,
  owner: null,
  logged: false,
};

function normalizeTimer(raw: unknown): TimerState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<TimerState>;
  const duration =
    typeof r.duration === "number" && Number.isFinite(r.duration)
      ? Math.min(99 * 60000, Math.max(60000, r.duration))
      : DEFAULT_TIMER.duration;
  const endAt = typeof r.endAt === "number" && Number.isFinite(r.endAt) ? r.endAt : null;
  const remaining = typeof r.remaining === "number" && r.remaining >= 0 ? Math.min(r.remaining, duration) : duration;
  const link = {
    activityId: typeof r.activityId === "string" ? r.activityId : null,
    owner: typeof r.owner === "string" ? r.owner : null,
    logged: Boolean(r.logged),
  };
  // Finished while nobody was looking: show it as finished, without beeping.
  if (endAt !== null && endAt <= Date.now()) return { duration, endAt: null, remaining: 0, done: true, ...link };
  return { duration, endAt, remaining, done: Boolean(r.done), ...link };
}

function TimerPanel({
  t, userId, soundEnabled, tasks, suggestedTaskId, autoTaskId, deviceId, launch, onLogMinutes, onCompleteTask, onUseTask,
}: Pick<TimeTabProps, "t" | "userId" | "soundEnabled" | "tasks" | "suggestedTaskId" | "autoTaskId" | "deviceId" | "launch" | "onLogMinutes" | "onCompleteTask" | "onUseTask">) {
  // This panel only mounts client-side (after login), so the device copy can be read right away.
  const { value: state, set: setState, ready } = useSyncedState<TimerState>(userId, "timer", DEFAULT_TIMER, normalizeTimer, {
    lazyLocal: true,
  });
  const soundRef = useRef(soundEnabled);
  useEffect(() => {
    soundRef.current = soundEnabled;
  }, [soundEnabled]);

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

  useEffect(() => () => melodyRef.current?.stop(), []);

  const running = state.endAt !== null;
  const now = useNow(running, 100);
  const remaining = running ? Math.max(0, state.endAt! - Math.max(now, state.endAt! - state.duration)) : state.remaining;

  const linked = tasks.find((task) => task.id === state.activityId) ?? null;
  const [logNote, setLogNote] = useState("");
  const noteTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  const labels = { sec: t.step_sec, min: t.step_min };

  /** Put `ms` of work on the linked minute plan (once), and say so quietly. */
  const bookTime = (ms: number) => {
    if (!state.activityId || !linked?.minuteBased) return;
    const minutes = minutesToLog(ms, 0, linked.remainingMin);
    if (minutes <= 0) return;
    onLogMinutes(state.activityId, minutes);
    setLogNote(`✓ ${linked.title}: +${formatTimeLeft(minutes, labels)}`);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setLogNote(""), 7000);
  };

  // A finished session books its time, once, on the browser that started it. This also catches up when the page
  // was closed while the time ran out: the work is counted as soon as the person is back.
  const booked = useRef(false);
  useEffect(() => {
    if (!state.done) booked.current = false;
  }, [state.done]);
  useEffect(() => {
    if (!state.done || state.logged || !state.activityId || state.owner !== deviceId) return;
    if (tasks.length === 0) return; // today's plans are still loading
    if (booked.current) return; // never twice, even if this runs again before the state is saved
    booked.current = true;
    const task = tasks.find((item) => item.id === state.activityId);
    if (task?.minuteBased) {
      const minutes = minutesToLog(state.duration, 0, task.remainingMin);
      if (minutes > 0) {
        onLogMinutes(state.activityId, minutes);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLogNote(`✓ ${task.title}: +${formatTimeLeft(minutes, { sec: t.step_sec, min: t.step_min })}`);
        window.clearTimeout(noteTimer.current);
        noteTimer.current = window.setTimeout(() => setLogNote(""), 7000);
      }
    }
    setState((s) => ({ ...s, logged: true }));
  }, [state.done, state.logged, state.activityId, state.owner, state.duration, deviceId, tasks, onLogMinutes, setState, t.step_sec, t.step_min]);

  const pickTask = (activityId: string | null) => {
    setAutoChosen(false);
    const task = tasks.find((item) => item.id === activityId) ?? null;
    const minutes = defaultMinutesFor(task);
    setState((s) => {
      const fresh = s.endAt === null && !s.done && s.remaining === s.duration;
      const duration = fresh && minutes ? minutes * 60000 : s.duration;
      return { ...s, activityId, owner: null, logged: false, duration, remaining: fresh ? duration : s.remaining };
    });
  };

  // An idle timer with no plan, and one plan clearly the right one right now: it is simply set to it. Once per visit,
  // only after the saved state was read (so a plan chosen on another device is never overwritten), and always
  // changeable. Nothing starts and nothing is logged without the person pressing Start.
  const [autoChosen, setAutoChosen] = useState(false);
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || !ready || !autoTaskId || state.activityId) return;
    if (state.endAt !== null || state.done || state.remaining !== state.duration) return;
    const task = tasks.find((item) => item.id === autoTaskId);
    if (!task) return;
    autoTried.current = true;
    const minutes = defaultMinutesFor(task);
    const timer = window.setTimeout(() => {
      setState((s) => ({
        ...s,
        activityId: task.id,
        owner: null,
        logged: false,
        duration: minutes ? minutes * 60000 : s.duration,
        remaining: minutes ? minutes * 60000 : s.remaining,
      }));
      setAutoChosen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, autoTaskId, tasks, state.activityId, state.endAt, state.done, state.remaining, state.duration, setState]);

  // "Start a timer for this plan" from a task card: the plan is chosen and the length is what is left (or what
  // this person usually does). Starting stays one tap away, because browsers only allow sound after a tap.
  const handledLaunch = useRef(0);
  useEffect(() => {
    if (!launch || launch.nonce === handledLaunch.current || running) return;
    const task = tasks.find((item) => item.id === launch.activityId);
    if (!task) return;
    handledLaunch.current = launch.nonce;
    const minutes = defaultMinutesFor(task);
    const duration = (minutes ?? 5) * 60000;
    const timer = window.setTimeout(() => {
      setState({ duration, endAt: null, remaining: duration, done: false, activityId: task.id, owner: null, logged: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [launch, tasks, running, setState]);

  useEffect(() => {
    if (running && remaining <= 0) {
      setState((s) => ({ ...s, endAt: null, remaining: 0, done: true }));
      if (soundRef.current) {
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
    setState((s) => ({ ...s, duration, endAt: null, remaining: duration, done: false, owner: null, logged: false }));
  };

  const toggle = () => {
    stopMelody();
    unlockAudio();
    if (running) {
      setState((s) => ({ ...s, endAt: null, remaining: Math.max(0, s.endAt! - Date.now()) }));
    } else {
      const left = state.done || state.remaining <= 0 ? state.duration : state.remaining;
      setState((s) => ({ ...s, done: false, logged: false, owner: deviceId, remaining: left, endAt: Date.now() + left }));
      if (state.activityId) onUseTask(state.activityId);
    }
  };

  // The plan still has time missing after a session: one tap runs a timer for exactly that.
  const missingMs = linked?.minuteBased && !linked.done && linked.remainingMin ? Math.round(linked.remainingMin * 60000) : 0;
  const again = () => {
    if (!state.activityId || missingMs < 10_000) return;
    stopMelody();
    unlockAudio();
    const duration = Math.min(99 * 60000, Math.max(60000, missingMs));
    setState((s) => ({ ...s, duration, remaining: duration, endAt: Date.now() + duration, done: false, owner: deviceId, logged: false }));
    onUseTask(state.activityId);
  };

  const reset = () => {
    stopMelody();
    // Stopping early still counts the work done so far.
    if (!state.done && !state.logged && state.owner === deviceId) bookTime(state.duration - remaining);
    setState((s) => ({ ...s, endAt: null, remaining: s.duration, done: false, owner: null, logged: false }));
  };
  const idle = !running && remaining === state.duration && !state.done;
  const pristine = !running && !state.done && remaining === state.duration;

  return (
    <>
      <TaskLink t={t} tasks={tasks} suggestedTaskId={suggestedTaskId} value={state.activityId} disabled={running} autoChosen={autoChosen} onChange={pickTask} />
      <Ring progress={state.duration ? remaining / state.duration : 0} done={state.done}>
        <span className="time-digits">{state.done ? "00:00" : formatClock(remaining)}</span>
        {state.done ? <span className="time-note">{t.clk_up}</span> : null}
      </Ring>

      <div className="time-extra">
        {idle || pristine ? (
          <div className="time-presets">
            <button type="button" className="time-chip" onClick={() => setDuration(state.duration - 60000)} aria-label="−1">
              −
            </button>
            {smartPresets(linked).map((m) => (
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

      {logNote ? <span className="time-note time-task-note">{logNote}</span> : null}
      {state.done && state.logged && missingMs >= 10_000 ? (
        <button type="button" className="time-btn time-task-mark" onClick={again}>
          <IconRepeat className="icon-xs" />
          <span>{t.clk_task_again} {formatTimeLeft(linked!.remainingMin!, labels)}</span>
        </button>
      ) : null}
      {state.done && linked && !linked.minuteBased && !linked.done ? (
        <button type="button" className="time-btn time-task-mark" onClick={() => onCompleteTask(linked.id)}>
          <span>{t.clk_task_mark}</span>
        </button>
      ) : null}

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
    </>
  );
}

/* ------------------------------------------------------------- Stopwatch */

interface StopwatchState {
  startedAt: number | null; // epoch ms while running
  base: number; // accumulated ms before the current run
  laps: number[]; // cumulative ms at each lap
  activityId: string | null; // the plan this session is for
  loggedMs: number; // how much of `base` is already on that plan
}

const DEFAULT_STOPWATCH: StopwatchState = { startedAt: null, base: 0, laps: [], activityId: null, loggedMs: 0 };

function normalizeStopwatch(raw: unknown): StopwatchState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<StopwatchState>;
  return {
    startedAt: typeof r.startedAt === "number" && Number.isFinite(r.startedAt) ? r.startedAt : null,
    base: typeof r.base === "number" && r.base >= 0 ? r.base : 0,
    laps: Array.isArray(r.laps) ? r.laps.filter((lap): lap is number => typeof lap === "number" && lap >= 0) : [],
    activityId: typeof r.activityId === "string" ? r.activityId : null,
    loggedMs: typeof r.loggedMs === "number" && r.loggedMs >= 0 ? r.loggedMs : 0,
  };
}

function StopwatchPanel({
  t, userId, tasks, suggestedTaskId, autoTaskId, onLogMinutes, onUseTask,
}: Pick<TimeTabProps, "t" | "userId" | "tasks" | "suggestedTaskId" | "autoTaskId" | "onLogMinutes" | "onUseTask">) {
  const { value: state, set: setState, ready } = useSyncedState<StopwatchState>(
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

  const linked = tasks.find((task) => task.id === state.activityId) ?? null;
  const [logNote, setLogNote] = useState("");
  const noteTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(noteTimer.current), []);

  /** Time since the last booking goes onto the linked minute plan; a pause or a reset is the moment to do it. */
  const bookTime = (totalMs: number): number => {
    if (!state.activityId || !linked?.minuteBased) return state.loggedMs;
    const minutes = minutesToLog(totalMs, state.loggedMs, linked.remainingMin);
    if (minutes <= 0) return state.loggedMs;
    onLogMinutes(state.activityId, minutes);
    setLogNote(`✓ ${linked.title}: +${formatTimeLeft(minutes, { sec: t.step_sec, min: t.step_min })}`);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setLogNote(""), 7000);
    return totalMs;
  };

  // The same quiet pre-selection as the timer: only when idle, only once, only after the saved state was read.
  const [autoChosen, setAutoChosen] = useState(false);
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || !ready || !autoTaskId || state.activityId) return;
    if (state.startedAt !== null || state.base > 0) return;
    if (!tasks.some((item) => item.id === autoTaskId)) return;
    autoTried.current = true;
    const timer = window.setTimeout(() => {
      setState((s) => ({ ...s, activityId: autoTaskId, loggedMs: s.base }));
      setAutoChosen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, autoTaskId, tasks, state.activityId, state.startedAt, state.base, setState]);

  // Reaching what the plan still needs books it by itself, without stopping the clock; one soft buzz says so.
  const needMs = linked?.minuteBased && !linked.done && linked.remainingMin ? Math.round(linked.remainingMin * 60000) : 0;
  const goalBooked = useRef<number | null>(null);
  const reached = running && needMs > 0 && elapsed - state.loggedMs >= needMs;
  useEffect(() => {
    if (!reached || goalBooked.current === state.loggedMs) return;
    goalBooked.current = state.loggedMs;
    const loggedMs = bookTime(elapsed);
    setState((s) => ({ ...s, loggedMs }));
    try {
      navigator.vibrate?.(120);
    } catch {
      // Not supported.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reached]);

  const toggle = () => {
    if (state.startedAt !== null) {
      const total = state.base + (Date.now() - state.startedAt);
      const loggedMs = bookTime(total);
      setState((s) => ({ ...s, startedAt: null, base: total, loggedMs }));
    } else {
      setState((s) => ({ ...s, startedAt: Date.now() }));
      if (state.activityId) onUseTask(state.activityId);
    }
  };
  const pickTask = (activityId: string | null) => {
    setAutoChosen(false);
    // What was already measured belongs to the previous plan.
    setState((s) => ({ ...s, activityId, loggedMs: s.base }));
  };
  const lap = () =>
    setState((s) => {
      const total = s.base + (s.startedAt ? Date.now() - s.startedAt : 0);
      const prev = s.laps.length ? s.laps[s.laps.length - 1] : 0;
      // Ignore accidental double taps (a real lap is never < 0.25s after the last one).
      if (total - prev < 250) return s;
      return { ...s, laps: [...s.laps, total].slice(-99) };
    });
  const reset = () => {
    bookTime(state.base);
    setState((s) => ({ startedAt: null, base: 0, laps: [], activityId: s.activityId, loggedMs: 0 }));
  };

  // Full history (up to 99 laps), newest first so the lap you just took is always on top; the list scrolls.
  const lastLaps = state.laps
    .map((total, index) => ({ n: index + 1, split: total - (index > 0 ? state.laps[index - 1] : 0), total }))
    .reverse();

  return (
    <>
      <TaskLink t={t} tasks={tasks} suggestedTaskId={suggestedTaskId} value={state.activityId} disabled={running} autoChosen={autoChosen} onChange={pickTask} />
      <div className="stopwatch-face">
        <span className="stopwatch-digits">
          {main}
          <span className="stopwatch-cs">.{cs}</span>
        </span>
        {linked?.minuteBased ? (
          <span className="stopwatch-goal">
            {linked.done || (needMs === 0 && !running)
              ? `✓ ${t.done}`
              : `${formatTimeLeft(Math.max(0, needMs - Math.max(0, elapsed - state.loggedMs)) / 60000, { sec: t.step_sec, min: t.step_min })} ${t.step_left}`}
          </span>
        ) : null}
      </div>

      {lastLaps.length > 0 ? (
        <div className="time-extra time-extra-laps">
          <ul className="time-laps">
            {lastLaps.map((l) => (
              <li key={l.n}>
                <span>#{l.n}</span>
                <span>{formatStopwatch(l.split).main}.{formatStopwatch(l.split).cs}</span>
                <span className="time-lap-total">{formatStopwatch(l.total).main}.{formatStopwatch(l.total).cs}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="time-extra" />
      )}

      {logNote ? <span className="time-note time-task-note">{logNote}</span> : null}

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

export default function TimeTab({ t, language, userId, soundEnabled, tasks: rankedTasks, suggestedTaskId, autoTaskId, deviceId, launch, onLogMinutes, onCompleteTask, onUseTask }: TimeTabProps) {
  const [sub, setSub] = useState<SubTab>("timer");
  // The picker keeps the order it first showed: ranks change as time is logged, and nothing may move under a finger.
  const [seenOrder, setSeenOrder] = useState<string[]>([]);
  const tasks = useMemo(() => freezeOrder(rankedTasks, seenOrder).items, [rankedTasks, seenOrder]);
  useEffect(() => {
    const { order } = freezeOrder(rankedTasks, seenOrder);
    if (order.join("|") === seenOrder.join("|")) return;
    const timer = window.setTimeout(() => setSeenOrder(order), 0);
    return () => window.clearTimeout(timer);
  }, [rankedTasks, seenOrder]);
  const tabs: Array<{ id: SubTab; label: string }> = [
    { id: "timer", label: t.clk_timer },
    { id: "stopwatch", label: t.clk_stopwatch },
    { id: "clock", label: t.clk_clock },
  ];
  const select = useCallback((id: SubTab) => setSub(id), []);
  // A task card opened the timer: show it (on phones only one tool is visible at a time).
  const launchNonce = launch?.nonce;
  useEffect(() => {
    if (!launchNonce) return;
    const timer = window.setTimeout(() => setSub("timer"), 0);
    return () => window.clearTimeout(timer);
  }, [launchNonce]);

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
          <TimerPanel
            t={t}
            userId={userId}
            soundEnabled={soundEnabled}
            tasks={tasks}
            suggestedTaskId={suggestedTaskId}
            autoTaskId={autoTaskId}
            deviceId={deviceId}
            launch={launch}
            onLogMinutes={onLogMinutes}
            onCompleteTask={onCompleteTask}
            onUseTask={onUseTask}
          />
        </section>
        <section className="time-card" data-active={sub === "stopwatch"}>
          <h2 className="time-card-title">{t.clk_stopwatch}</h2>
          <StopwatchPanel t={t} userId={userId} tasks={tasks} suggestedTaskId={suggestedTaskId} autoTaskId={autoTaskId} onLogMinutes={onLogMinutes} onUseTask={onUseTask} />
        </section>
        <section className="time-card" data-active={sub === "clock"}>
          <h2 className="time-card-title">{t.clk_clock}</h2>
          <ClockPanel language={language} />
        </section>
      </div>
    </div>
  );
}
