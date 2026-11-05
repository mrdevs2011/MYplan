// Pure reminder-ladder planning, kept free of I/O so it can be unit-tested.
export const STAGES = [
  { id: "pre", offset: -10, window: 10 },
  { id: "due", offset: 0, window: 20 },
  { id: "late1", offset: 20, window: 20 },
  { id: "late2", offset: 60, window: 20 },
] as const;
export type StageId = typeof STAGES[number]["id"];

export const SLOT_WINDOWS: Record<string, [number, number]> = { morning: [480, 690], afternoon: [720, 990], evening: [1050, 1230] };
export const OTHER_WINDOW: [number, number] = [540, 1200];
export const SUMMARY_TIMES = [720, 900, 1080, 1230];

export interface PlannableTask {
  id: string;
  time_of_day: string | null;
  created_at: string;
  reminder_time?: string | null;
}

/** Local minute-of-day each task should fire at. Explicit reminder_time wins; the rest are spread evenly across their slot. */
export function planReminderMinutes(tasks: PlannableTask[]): Map<string, number> {
  const at = new Map<string, number>();
  const groups = new Map<string, PlannableTask[]>();
  for (const task of tasks) {
    const match = String(task.reminder_time ?? "").match(/^(\d{2}):(\d{2})/);
    if (match) { at.set(task.id, Number(match[1]) * 60 + Number(match[2])); continue; }
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
