export interface FocusTimeSlot {
  id: string;
  label: string;
}

export interface FocusActivity {
  id: string;
  is_active: boolean;
  time_of_day?: string | null;
}

export interface FocusOccurrence {
  activity_id: string;
  status: "pending" | "completed";
}

interface TimeWindow {
  start: number;
  end: number;
  duration: number;
}

function parseClock(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function getCustomWindow(label: string): TimeWindow | null {
  const match = label.match(/(?:^|\D)(\d{1,2}:\d{2})\s*(?:-|–|—|to|до)\s*(\d{1,2}:\d{2})(?:$|\D)/i);
  if (!match) return null;
  const start = parseClock(match[1]);
  const end = parseClock(match[2]);
  if (start === null || end === null || start === end) return null;
  const duration = (end - start + 1440) % 1440;
  return { start, end, duration };
}

function getActivityWindow(timeOfDay: string, slots: FocusTimeSlot[]): TimeWindow | null {
  if (timeOfDay === "morning") return { start: 5 * 60, end: 12 * 60, duration: 7 * 60 };
  if (timeOfDay === "afternoon") return { start: 12 * 60, end: 18 * 60, duration: 6 * 60 };
  if (timeOfDay === "evening") return { start: 18 * 60, end: 23 * 60, duration: 5 * 60 };
  if (timeOfDay === "anytime") return null;
  const slot = slots.find((item) => item.id === timeOfDay);
  return slot ? getCustomWindow(slot.label) : null;
}

function isInsideWindow(minute: number, window: TimeWindow): boolean {
  return window.start < window.end
    ? minute >= window.start && minute < window.end
    : minute >= window.start || minute < window.end;
}

export function getRecommendedFocusActivity<T extends FocusActivity>(
  activities: T[],
  occurrences: FocusOccurrence[],
  customTimeSlots: FocusTimeSlot[],
  currentMinute: number,
): T | null {
  const completedIds = new Set(occurrences.filter((item) => item.status === "completed").map((item) => item.activity_id));
  const pending = activities.filter((activity) => activity.is_active && !completedIds.has(activity.id));

  const timed = pending
    .map((activity, index) => {
      const timeOfDay = activity.time_of_day || "";
      if (!timeOfDay || timeOfDay === "anytime") return null;
      const window = getActivityWindow(timeOfDay, customTimeSlots);
      if (!window || !isInsideWindow(currentMinute, window)) return null;
      return { activity, index, duration: window.duration };
    })
    .filter((item): item is { activity: T; index: number; duration: number } => item !== null)
    .sort((a, b) => a.duration - b.duration || a.index - b.index);

  if (timed.length > 0) return timed[0].activity;
  return pending.find((activity) => activity.time_of_day === "anytime") || null;
}
