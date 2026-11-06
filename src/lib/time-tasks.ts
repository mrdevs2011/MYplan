/**
 * Timer and stopwatch know about the day's plans. Everything is derived from what the person already has (their
 * plans, today's progress and the amounts they usually log), so there is nothing to configure: the right task and
 * the right length are simply offered first.
 */

export interface TimeTask {
  id: string;
  title: string;
  /** A counting plan measured in minutes: the time spent is logged on it, and it completes by itself. */
  minuteBased: boolean;
  /** Minutes still missing today (minute plans only). */
  remainingMin: number | null;
  /** The length this person usually spends on it in one sitting, learned from their history. */
  usualMin: number | null;
  done: boolean;
}

/** Sessions shorter than this are taps by accident, not work. */
export const MIN_LOGGED_SECONDS = 10;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Minutes worth logging for `elapsedMs` of work of which `alreadyLoggedMs` is already on the plan. */
export function minutesToLog(elapsedMs: number, alreadyLoggedMs: number, remainingMin: number | null): number {
  const freshMs = Math.max(0, elapsedMs - alreadyLoggedMs);
  if (freshMs < MIN_LOGGED_SECONDS * 1000) return 0;
  const minutes = round2(freshMs / 60000);
  return remainingMin === null ? minutes : Math.min(minutes, remainingMin);
}

/** Timer lengths (minutes) to offer: the learned usual length and what is left come first, then the classics. */
export function smartPresets(task: TimeTask | null, classics: number[] = [1, 5, 10, 25], limit = 5): number[] {
  const out: number[] = [];
  const add = (minutes: number | null | undefined) => {
    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return;
    const whole = Math.round(minutes);
    if (whole >= 1 && whole <= 99 && !out.includes(whole)) out.push(whole);
  };
  if (task?.minuteBased) {
    add(task.usualMin);
    add(task.remainingMin);
  }
  for (const minutes of classics) add(minutes);
  return out.slice(0, limit).sort((a, b) => a - b);
}

/** The length a fresh timer starts with once a task is chosen: what is left, but never more than they usually do. */
export function defaultMinutesFor(task: TimeTask | null): number | null {
  if (!task?.minuteBased) return null;
  const { usualMin, remainingMin } = task;
  if (remainingMin !== null && remainingMin > 0) {
    const cap = usualMin && usualMin >= 1 ? usualMin : remainingMin;
    return Math.min(99, Math.max(1, Math.round(Math.min(remainingMin, Math.max(cap, 1)))));
  }
  return usualMin && usualMin >= 1 ? Math.min(99, Math.round(usualMin)) : null;
}

/** Picker order: minute plans still to do (the suggested one first), other open plans, finished plans last. */
export function orderTasksForTimer(tasks: TimeTask[], suggestedId: string | null): TimeTask[] {
  const rank = (task: TimeTask) => {
    if (task.done) return 3;
    if (task.id === suggestedId) return 0;
    return task.minuteBased ? 1 : 2;
  };
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => rank(a.task) - rank(b.task) || a.index - b.index)
    .map(({ task }) => task);
}

// ---------------------------------------------------------------------------------------------------------------
// Which plan is this session for? Scored from what the person already does: when they usually do it, what they
// used the timer for lately, how much is still missing. Nothing to set up; it just gets better with use.
// ---------------------------------------------------------------------------------------------------------------

export interface RankSignals {
  /** Minutes after local midnight. */
  nowMinute: number;
  /** When each plan is usually started (learned), minutes after midnight. */
  usualMinute: Record<string, number>;
  /** Plans the timer or stopwatch was used for most recently, newest first. */
  recentIds: string[];
  /** The plan the app itself would put in front right now (time-of-day window). */
  suggestedId: string | null;
}

const circularGap = (a: number, b: number) => {
  const diff = Math.abs(a - b) % 1440;
  return Math.min(diff, 1440 - diff);
};

export function scoreTask(task: TimeTask, signals: RankSignals): number {
  if (task.done) return -100;
  let score = 0;
  if (task.minuteBased) score += 40; // time is exactly what these plans are measured in
  if (task.id === signals.suggestedId) score += 12;
  const usual = signals.usualMinute[task.id];
  if (usual !== undefined) {
    const gap = circularGap(usual, signals.nowMinute);
    if (gap <= 90) score += 36 - gap / 3; // right now is when they usually do it: up to +36
  }
  const recent = signals.recentIds.indexOf(task.id);
  if (recent >= 0) score += Math.max(0, 12 - recent * 3);
  if (task.minuteBased && task.remainingMin) score += Math.min(task.remainingMin, 30) / 3; // more left, more pressing
  return score;
}

/** Best first. Equal scores keep the order they came in. */
export function rankTasksForTimer(tasks: TimeTask[], signals: RankSignals): TimeTask[] {
  return tasks
    .map((task, index) => ({ task, index, score: scoreTask(task, signals) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ task }) => task);
}

/** A plan worth choosing without asking: clearly ahead of the rest and a minute plan that is still open. */
export function confidentPick(tasks: TimeTask[], signals: RankSignals): TimeTask | null {
  const scored = tasks
    .map((task) => ({ task, score: scoreTask(task, signals) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || !best.task.minuteBased || best.task.done || (best.task.remainingMin ?? 0) <= 0) return null;
  if (best.score < 66) return null; // roughly: a minute plan they usually start within half an hour of now
  const second = scored[1];
  return !second || best.score - second.score >= 12 ? best.task : null;
}

/** Keeps a list in the order it was first seen, so a picker never reshuffles under a finger. New items go last. */
export function freezeOrder<T extends { id: string }>(items: T[], seenOrder: string[]): { items: T[]; order: string[] } {
  const known = new Set(items.map((item) => item.id));
  const order = seenOrder.filter((id) => known.has(id));
  for (const item of items) if (!order.includes(item.id)) order.push(item.id);
  const byId = new Map(items.map((item) => [item.id, item]));
  return { items: order.map((id) => byId.get(id)!).filter(Boolean), order };
}
