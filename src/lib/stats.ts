// Pure statistics for the Statistics tab. No React, no I/O, no imports: it is unit-tested with node:test.
// Everything is derived from activity definitions + occurrences (+ progress events), so days the user never
// opened the app still count as "expected but not done" instead of silently vanishing from the history.

export interface StatActivity {
  id: string;
  title: string;
  schedule_type: "daily" | "once";
  time_of_day?: string | null;
  schedule_rule?: { weekdays?: number[] } | null;
  measurement_type: "check" | "count";
  target: number | null;
  unit: string | null;
  is_active: boolean;
  starts_on: string;
  ends_on?: string | null;
}
export interface StatOccurrence {
  activity_id: string;
  period_start: string;
  status: "pending" | "completed" | "skipped";
}
export interface StatEvent {
  occurrence_id: string;
  amount: number;
}
export interface StatOccurrenceWithId extends StatOccurrence {
  id: string;
}

export const HISTORY_DAYS = 90;
export const PRAYER_TITLES = ["bomdod", "peshin", "pehshin", "asr", "shom", "xufton"];

// ---------- date helpers (calendar keys "YYYY-MM-DD", no time-zone drift) ----------
const MS = 86_400_000;
const toUtc = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (key: string, n: number) => {
  const d = new Date(toUtc(key) + n * MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
/** Monday = 1 ... Sunday = 7 (same convention as the app's weekday picker). */
export const weekdayOf = (key: string) => {
  const js = new Date(toUtc(key)).getUTCDay();
  return js === 0 ? 7 : js;
};
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / MS);

export function isScheduled(a: StatActivity, key: string): boolean {
  if (!a.is_active) return false;
  if (a.starts_on > key) return false;
  if (a.ends_on && a.ends_on < key) return false;
  if (a.schedule_type === "once") return a.starts_on === key;
  const weekdays = a.schedule_rule?.weekdays;
  return !Array.isArray(weekdays) || weekdays.length === 0 || weekdays.includes(weekdayOf(key));
}

export type StatusMap = Map<string, StatOccurrence["status"]>;
export const statusKey = (activityId: string, date: string) => `${activityId}|${date}`;
export function buildStatusMap(occurrences: StatOccurrence[], liveToday?: { activity_id: string; status: StatOccurrence["status"] }[], todayKey?: string): StatusMap {
  const map: StatusMap = new Map();
  for (const o of occurrences) map.set(statusKey(o.activity_id, o.period_start), o.status);
  // The page's in-memory statuses are fresher than the database for today (optimistic updates).
  if (liveToday && todayKey) for (const o of liveToday) map.set(statusKey(o.activity_id, todayKey), o.status);
  return map;
}

// ---------- per-day series ----------
export interface DayStat {
  date: string;
  expected: number;
  done: number;
  /** 0..100, or null when nothing was scheduled that day. */
  pct: number | null;
}

export function buildDays(activities: StatActivity[], status: StatusMap, todayKey: string, days: number): DayStat[] {
  const out: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(todayKey, -i);
    let expected = 0;
    let done = 0;
    for (const a of activities) {
      if (!isScheduled(a, date)) continue;
      expected++;
      if (status.get(statusKey(a.id, date)) === "completed") done++;
    }
    out.push({ date, expected, done, pct: expected > 0 ? Math.round((done / expected) * 100) : null });
  }
  return out;
}

export const average = (days: DayStat[]): number | null => {
  const withData = days.filter((d) => d.pct !== null);
  if (withData.length === 0) return null;
  return Math.round(withData.reduce((s, d) => s + (d.pct as number), 0) / withData.length);
};

/** Consecutive perfect days (every scheduled task done). Today only counts once it is perfect; an open today never breaks it. */
export function perfectStreak(days: DayStat[]): { current: number; best: number } {
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (d.expected === 0) continue; // a day with nothing scheduled neither extends nor breaks a streak
    if (d.done === d.expected) {
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.expected === 0) continue;
    if (d.done === d.expected) current++;
    else if (i === days.length - 1) continue; // today still open
    else break;
  }
  return { current, best };
}

// ---------- weekday / time-of-day analysis ----------
export function weekdayAverages(days: DayStat[]): { weekday: number; pct: number | null; samples: number }[] {
  const sums = new Map<number, { total: number; n: number }>();
  for (const d of days) {
    if (d.pct === null) continue;
    const w = weekdayOf(d.date);
    const cur = sums.get(w) ?? { total: 0, n: 0 };
    cur.total += d.pct;
    cur.n++;
    sums.set(w, cur);
  }
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const s = sums.get(weekday);
    return { weekday, pct: s ? Math.round(s.total / s.n) : null, samples: s?.n ?? 0 };
  });
}

export type Slot = "morning" | "afternoon" | "evening" | "anytime" | "custom";
export const slotOf = (a: StatActivity): Slot => {
  const t = a.time_of_day;
  return t === "morning" || t === "afternoon" || t === "evening" || t === "anytime" ? t : t ? "custom" : "anytime";
};
export function slotAverages(activities: StatActivity[], status: StatusMap, todayKey: string, days: number) {
  const acc = new Map<Slot, { expected: number; done: number }>();
  for (let i = 0; i < days; i++) {
    const date = addDays(todayKey, -i);
    if (i === 0) continue; // today is still in progress and would unfairly lower every slot
    for (const a of activities) {
      if (!isScheduled(a, date)) continue;
      const s = slotOf(a);
      const cur = acc.get(s) ?? { expected: 0, done: 0 };
      cur.expected++;
      if (status.get(statusKey(a.id, date)) === "completed") cur.done++;
      acc.set(s, cur);
    }
  }
  return (["morning", "afternoon", "evening", "anytime", "custom"] as Slot[])
    .map((slot) => {
      const v = acc.get(slot);
      return { slot, expected: v?.expected ?? 0, done: v?.done ?? 0, pct: v && v.expected > 0 ? Math.round((v.done / v.expected) * 100) : null };
    })
    .filter((s) => s.expected > 0);
}

// ---------- per task ----------
export interface TaskStat {
  id: string;
  title: string;
  kind: "check" | "count";
  expected: number;
  done: number;
  pct: number | null;
  streak: number;
  lastDone: string | null;
}
export function taskStats(activities: StatActivity[], status: StatusMap, todayKey: string, window = 30): TaskStat[] {
  const from = addDays(todayKey, -(window - 1));
  const out: TaskStat[] = [];
  for (const a of activities) {
    if (!a.is_active) continue;
    let expected = 0;
    let done = 0;
    let lastDone: string | null = null;
    for (let date = from > a.starts_on ? from : a.starts_on; date <= todayKey; date = addDays(date, 1)) {
      if (!isScheduled(a, date)) continue;
      expected++;
      if (status.get(statusKey(a.id, date)) === "completed") {
        done++;
        lastDone = date;
      }
    }
    // streak: consecutive scheduled days done, newest first; an unfinished today does not break it
    let streak = 0;
    for (let i = 0; i < HISTORY_DAYS; i++) {
      const date = addDays(todayKey, -i);
      if (date < a.starts_on) break;
      if (!isScheduled(a, date)) continue;
      if (status.get(statusKey(a.id, date)) === "completed") streak++;
      else if (i === 0) continue;
      else break;
    }
    out.push({ id: a.id, title: a.title, kind: a.measurement_type, expected, done, pct: expected > 0 ? Math.round((done / expected) * 100) : null, streak, lastDone });
  }
  return out;
}

// ---------- counter goals (progress events) ----------
export interface CounterStat {
  id: string;
  title: string;
  unit: string;
  target: number;
  /** Net amount recorded on each of the last 7 days, oldest first. */
  week: number[];
  weekTotal: number;
  weekGoal: number;
}
export function counterStats(activities: StatActivity[], occurrences: StatOccurrenceWithId[], events: StatEvent[], todayKey: string): CounterStat[] {
  const occ = new Map(occurrences.map((o) => [o.id, o]));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(todayKey, -(6 - i)));
  const out: CounterStat[] = [];
  for (const a of activities) {
    if (!a.is_active || a.measurement_type !== "count" || !a.target) continue;
    const perDay = new Map<string, number>();
    for (const e of events) {
      const o = occ.get(e.occurrence_id);
      if (!o || o.activity_id !== a.id) continue;
      perDay.set(o.period_start, (perDay.get(o.period_start) ?? 0) + e.amount);
    }
    const week = dates.map((d) => Math.max(0, perDay.get(d) ?? 0));
    out.push({
      id: a.id,
      title: a.title,
      unit: a.unit ?? "",
      target: a.target,
      week,
      weekTotal: week.reduce((s, n) => s + n, 0),
      weekGoal: a.target * dates.filter((d) => isScheduled(a, d)).length,
    });
  }
  return out;
}

// ---------- prayers ----------
export function prayerStats(activities: StatActivity[], status: StatusMap, todayKey: string, window = 30) {
  const prayers = activities.filter((a) => a.is_active && PRAYER_TITLES.includes(a.title.trim().toLowerCase()));
  if (prayers.length === 0) return null;
  const days = buildDays(prayers, status, todayKey, window);
  const { current, best } = perfectStreak(days);
  const past = days.slice(0, -1).filter((d) => d.expected > 0);
  const perfectDays = past.filter((d) => d.done === d.expected).length;
  return { count: prayers.length, avg: average(days), perfectDays, trackedDays: past.length, current, best, days };
}

// ---------- heatmap ----------
export const heatLevel = (pct: number | null): 0 | 1 | 2 | 3 | 4 => (pct === null || pct <= 0 ? 0 : pct < 34 ? 1 : pct < 67 ? 2 : pct < 100 ? 3 : 4);

/** Columns are weeks (Mon..Sun), the last column ends with today. Cells after today are null. */
export function heatmapGrid(days: DayStat[], todayKey: string, weeks = 12): (DayStat | null)[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const lastMonday = addDays(todayKey, -(weekdayOf(todayKey) - 1));
  const grid: (DayStat | null)[][] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = addDays(lastMonday, -7 * w);
    const col: (DayStat | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(monday, d);
      col.push(date > todayKey ? null : byDate.get(date) ?? { date, expected: 0, done: 0, pct: null });
    }
    grid.push(col);
  }
  return grid;
}

// ---------- one call for the UI ----------
export interface StatsResult {
  days90: DayStat[];
  last7: DayStat[];
  last30: DayStat[];
  avg7: number | null;
  avg30: number | null;
  prevAvg7: number | null;
  today: DayStat;
  streak: { current: number; best: number };
  perfectDays30: number;
  weekdays: ReturnType<typeof weekdayAverages>;
  slots: ReturnType<typeof slotAverages>;
  tasks: TaskStat[];
  counters: CounterStat[];
  prayers: ReturnType<typeof prayerStats>;
  heatmap: (DayStat | null)[][];
  totalDone: number;
}

export function computeStats(input: {
  activities: StatActivity[];
  occurrences: StatOccurrenceWithId[];
  events: StatEvent[];
  liveToday?: { activity_id: string; status: StatOccurrence["status"] }[];
  todayKey: string;
}): StatsResult {
  const { activities, occurrences, events, liveToday, todayKey } = input;
  const status = buildStatusMap(occurrences, liveToday, todayKey);
  const active = activities.filter((a) => a.is_active);
  const days90 = buildDays(active, status, todayKey, HISTORY_DAYS);
  const last7 = days90.slice(-7);
  const last30 = days90.slice(-30);
  const prev7 = days90.slice(-14, -7);
  return {
    days90,
    last7,
    last30,
    avg7: average(last7),
    avg30: average(last30),
    prevAvg7: average(prev7),
    today: days90[days90.length - 1],
    streak: perfectStreak(days90),
    perfectDays30: last30.slice(0, -1).filter((d) => d.expected > 0 && d.done === d.expected).length,
    weekdays: weekdayAverages(days90.slice(0, -1)),
    slots: slotAverages(active, status, todayKey, 30),
    tasks: taskStats(active, status, todayKey, 30).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.streak - a.streak),
    counters: counterStats(active, occurrences, events, todayKey),
    prayers: prayerStats(active, status, todayKey, 30),
    heatmap: heatmapGrid(days90, todayKey, 12),
    totalDone: days90.reduce((s, d) => s + d.done, 0),
  };
}
