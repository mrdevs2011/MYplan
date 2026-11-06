// Pure reminder-ladder planning, kept free of I/O so it can be unit-tested.
// A reminder earns its place: one at the moment, one follow-up. "pre" exists only for a time the person set themselves.
export const STAGES = [
  { id: "pre", offset: -10, window: 10 },
  { id: "due", offset: 0, window: 20 },
  { id: "late1", offset: 45, window: 20 },
] as const;
export type StageId = typeof STAGES[number]["id"];

/** Reminders per day for plans without a time the person chose. Chosen times are always honoured. */
export const DAILY_NUDGE_LIMIT = 6;
/** Someone who logged progress this recently is already working: leave them alone. */
export const ACTIVE_WINDOW_MS = 15 * 60_000;
const MIN_LEARNED_DAYS = 3;
const SLOT_MINUTES = 30;
const CHAIN_GAP_MINUTES = 20;

export const SLOT_WINDOWS: Record<string, [number, number]> = { morning: [480, 690], afternoon: [720, 990], evening: [1050, 1230] };
export const OTHER_WINDOW: [number, number] = [540, 1200];
// One gentle check-in late in the day; the evening recap follows on its own.
export const SUMMARY_TIMES = [1080];

export interface PlannableTask {
  id: string;
  time_of_day: string | null;
  created_at: string;
  reminder_time?: string | null;
}

export interface ProgressPoint {
  activityId: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Local minutes after midnight. */
  minute: number;
}

/** When this person really starts each plan: the median first touch per day, once there are enough days. */
export function learnUsualMinutes(points: ProgressPoint[]): Map<string, number> {
  const firstByDay = new Map<string, Map<string, number>>();
  for (const point of points) {
    const days = firstByDay.get(point.activityId) ?? new Map<string, number>();
    const known = days.get(point.date);
    if (known === undefined || point.minute < known) days.set(point.date, point.minute);
    firstByDay.set(point.activityId, days);
  }
  const usual = new Map<string, number>();
  for (const [activityId, days] of firstByDay) {
    if (days.size < MIN_LEARNED_DAYS) continue;
    const sorted = [...days.values()].sort((a, b) => a - b);
    usual.set(activityId, sorted[Math.floor((sorted.length - 1) / 2)]);
  }
  return usual;
}

export interface ReminderContext {
  stage: StageId;
  hasChosenTime: boolean;
  isQuiet: boolean;
  isActiveNow: boolean;
  nudgesToday: number;
}

/** Whether this reminder is worth interrupting the person for right now. */
export function shouldRemind({ stage, hasChosenTime, isQuiet, isActiveNow, nudgesToday }: ReminderContext): boolean {
  if (hasChosenTime) {
    if (stage === "pre") return !isActiveNow;
    return stage === "late1" ? !isActiveNow && !isQuiet : true;
  }
  if (stage === "pre" || isQuiet || isActiveNow) return false;
  return nudgesToday < DAILY_NUDGE_LIMIT;
}

/** True inside a run of back-to-back plans: the person is already there, so "starts in 10 minutes" says nothing new. */
export function followsAnotherPlan(base: number, otherBases: number[]): boolean {
  return otherBases.some((other) => other < base && base - other <= CHAIN_GAP_MINUTES);
}

/** Plans due within the same half hour travel in one notification. */
export function reminderSlot(base: number): number {
  return Math.floor(base / SLOT_MINUTES);
}

/** Local minute-of-day each task should fire at. Explicit reminder_time wins; the rest are spread evenly across their slot. */
export function planReminderMinutes(tasks: PlannableTask[], usual: Map<string, number> = new Map()): Map<string, number> {
  const at = new Map<string, number>();
  const groups = new Map<string, PlannableTask[]>();
  for (const task of tasks) {
    const match = String(task.reminder_time ?? "").match(/^(\d{2}):(\d{2})/);
    if (match) { at.set(task.id, Number(match[1]) * 60 + Number(match[2])); continue; }
    const learned = usual.get(task.id);
    if (learned !== undefined) { at.set(task.id, learned); continue; }
    const key = task.time_of_day && SLOT_WINDOWS[task.time_of_day] ? task.time_of_day : "other";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  for (const [key, group] of groups) {
    const [start, end] = SLOT_WINDOWS[key] ?? OTHER_WINDOW;
    group.sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id));
    group.forEach((task, index) => at.set(task.id, Math.floor(start + (index + 0.5) * (end - start) / group.length)));
  }
  return at;
}

/** Stages whose catch-up window contains `nowMinutes` for a task due at `base`. */
export function dueStageIds(base: number, nowMinutes: number): StageId[] {
  return STAGES.filter((stage) => nowMinutes >= base + stage.offset && nowMinutes < base + stage.offset + stage.window).map((stage) => stage.id);
}

export function dueSummaryTime(nowMinutes: number): number | undefined {
  return SUMMARY_TIMES.find((time) => nowMinutes >= time && nowMinutes < time + 20);
}
