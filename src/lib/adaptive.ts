/**
 * The app learns the user; the user never has to learn the app. Everything here is derived from what the person
 * already did (progress history and their own plans), so nothing needs configuring or explaining. With too little
 * evidence each function returns nothing and the app behaves exactly as it does for a new account.
 */

export interface HabitEvent {
  activityId: string;
  amount: number;
  /** Epoch milliseconds. */
  at: number;
  /** True for a deliberate +N tap, false for tick-to-fill corrections. */
  isStep: boolean;
}

export interface HabitProfile {
  /** Usual start of the activity, in minutes after local midnight. */
  usualMinute: Record<string, number>;
  /** The +N this person actually reaches for on this activity. */
  favoriteStep: Record<string, number>;
  /** The total they usually log in one sitting, offered as a single tap. */
  usualChunk: Record<string, number>;
}

export const EMPTY_PROFILE: HabitProfile = { usualMinute: {}, favoriteStep: {}, usualChunk: {} };

const MIN_DAYS = 3;
const MIN_STEP_USES = 5;
const SITTING_GAP_MS = 90_000;

const dayKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
const minuteOf = (at: number) => {
  const date = new Date(at);
  return date.getHours() * 60 + date.getMinutes();
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function mostCommon<T>(values: T[]): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  let best: { value: T; count: number } | null = null;
  for (const value of values) {
    const count = (counts.get(value) || 0) + 1;
    counts.set(value, count);
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

export function buildHabitProfile(events: HabitEvent[], checkMinutes: Record<string, number[]> = {}): HabitProfile {
  const profile: HabitProfile = { usualMinute: {}, favoriteStep: {}, usualChunk: {} };
  const byActivity = new Map<string, HabitEvent[]>();
  for (const event of events) {
    const list = byActivity.get(event.activityId);
    if (list) list.push(event);
    else byActivity.set(event.activityId, [event]);
  }

  for (const [activityId, list] of byActivity) {
    const ordered = [...list].sort((a, b) => a.at - b.at);

    const firstOfDay = new Map<string, number>();
    for (const event of ordered) {
      if (event.amount > 0 && !firstOfDay.has(dayKey(event.at))) firstOfDay.set(dayKey(event.at), minuteOf(event.at));
    }
    if (firstOfDay.size >= MIN_DAYS) profile.usualMinute[activityId] = median([...firstOfDay.values()]);

    const step = mostCommon(ordered.filter((event) => event.isStep && event.amount > 0).map((event) => event.amount));
    if (step && step.count >= MIN_STEP_USES) profile.favoriteStep[activityId] = step.value;

    // A sitting is a burst of taps; undo inside it counts, so the total is what the person really meant to log.
    const sittings: { total: number; day: string }[] = [];
    let lastAt = -Infinity;
    for (const event of ordered) {
      if (!event.isStep) continue;
      if (event.at - lastAt > SITTING_GAP_MS) sittings.push({ total: 0, day: dayKey(event.at) });
      const sitting = sittings[sittings.length - 1];
      sitting.total = Math.round((sitting.total + event.amount) * 100) / 100;
      lastAt = event.at;
    }
    const daysPerTotal = new Map<number, Set<string>>();
    for (const sitting of sittings) {
      if (sitting.total <= 0) continue;
      const days = daysPerTotal.get(sitting.total) ?? new Set<string>();
      days.add(sitting.day);
      daysPerTotal.set(sitting.total, days);
    }
    let bestDays = 0;
    for (const [total, days] of daysPerTotal) {
      if (days.size >= MIN_DAYS && days.size > bestDays) {
        bestDays = days.size;
        profile.usualChunk[activityId] = total;
      }
    }
  }

  for (const [activityId, minutes] of Object.entries(checkMinutes)) {
    if (profile.usualMinute[activityId] === undefined && minutes.length >= MIN_DAYS) {
      profile.usualMinute[activityId] = median(minutes);
    }
  }
  return profile;
}

/** Puts plans in the order this person really does them. Plans without enough history keep their exact position. */
export function orderByHabit<T extends { id: string }>(activities: T[], usualMinute: Record<string, number>): T[] {
  const learned = activities.filter((activity) => usualMinute[activity.id] !== undefined);
  if (learned.length < 2) return activities;
  const sorted = [...learned].sort((a, b) => usualMinute[a.id] - usualMinute[b.id]);
  let next = 0;
  return activities.map((activity) => (usualMinute[activity.id] !== undefined ? sorted[next++] : activity));
}

/** The pending plan this person usually does around now, if there is one. */
export function pickHabitualNow<T extends { id: string }>(
  pending: T[],
  usualMinute: Record<string, number>,
  minute: number,
  windowMinutes = 60,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const activity of pending) {
    const usual = usualMinute[activity.id];
    if (usual === undefined) continue;
    const raw = Math.abs(usual - minute);
    const distance = Math.min(raw, 1440 - raw);
    if (distance <= windowMinutes && distance < bestDistance) {
      best = activity;
      bestDistance = distance;
    }
  }
  return best;
}

export interface PlanLike {
  measurement_type: "check" | "count";
  unit?: string | null;
  target?: number | null;
  time_of_day?: string | null;
  schedule_rule?: { weekdays?: number[]; duration_preset?: string } | null;
}

export interface FormDefaults {
  kind?: "check" | "count";
  unit?: string;
  timeOfDay?: string;
  weekdays?: number[];
  durationPreset?: string;
  targetByUnit: Record<string, number>;
}

const RECENT_PLANS = 12;
const MIN_PLANS = 3;

function dominant<T>(values: T[]): T | undefined {
  const best = mostCommon(values);
  return best && best.count >= MIN_PLANS && best.count / values.length >= 0.5 ? best.value : undefined;
}

/** How this person usually sets up a plan. `plans` is newest first. */
export function learnFormDefaults(plans: PlanLike[]): FormDefaults {
  const recent = plans.slice(0, RECENT_PLANS);
  const counted = recent.filter((plan) => plan.measurement_type === "count");
  const targetByUnit: Record<string, number> = {};
  for (const plan of counted) {
    if (plan.unit && plan.target && targetByUnit[plan.unit] === undefined) targetByUnit[plan.unit] = plan.target;
  }
  const weekdays = dominant(
    recent
      .map((plan) => plan.schedule_rule?.weekdays)
      .filter((days): days is number[] => Array.isArray(days) && days.length > 0)
      .map((days) => [...days].sort((a, b) => a - b).join(",")),
  );
  return {
    kind: dominant(recent.map((plan) => plan.measurement_type)),
    unit: dominant(counted.map((plan) => plan.unit).filter((unit): unit is string => Boolean(unit))),
    timeOfDay: dominant(recent.map((plan) => plan.time_of_day).filter((time): time is string => Boolean(time))),
    weekdays: weekdays ? weekdays.split(",").map(Number) : undefined,
    durationPreset: dominant(
      recent.map((plan) => plan.schedule_rule?.duration_preset).filter((preset): preset is string => Boolean(preset)),
    ),
    targetByUnit,
  };
}

export function formatMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
