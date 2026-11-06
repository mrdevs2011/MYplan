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
