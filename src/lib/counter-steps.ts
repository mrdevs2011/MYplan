/**
 * Minute plans count in time, not in repetitions: their steps are fixed and read as +30s or +1d, and progress can
 * hold fractions of a minute. Every other unit keeps the whole-number steps from Settings.
 */

export const MINUTE_STEPS = [10, 1, 0.5];

const MINUTE_UNITS = new Set(["daqiqa", "minut", "min", "minute", "minutes", "минут", "мин", "минута", "минуты"]);

export interface TimeLabels {
  sec: string;
  min: string;
}

export function isMinuteUnit(unit: string | null | undefined): boolean {
  return MINUTE_UNITS.has((unit ?? "").trim().toLowerCase());
}

export function stepsFor(unit: string | null | undefined, userSteps: number[]): number[] {
  return isMinuteUnit(unit) ? MINUTE_STEPS : userSteps;
}

/** Progress is stored with two decimals. Rounding here keeps 0.1 + 0.2 from missing a target by a hair. */
export function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 12.5 reads as "12d 30s", 0.5 as "30s", 12 as "12d". */
function formatTime(minutes: number, labels: TimeLabels): string {
  const totalSeconds = Math.round(minutes * 60);
  const wholeMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (wholeMinutes === 0) return `${seconds}${labels.sec}`;
  return seconds === 0 ? `${wholeMinutes}${labels.min}` : `${wholeMinutes}${labels.min} ${seconds}${labels.sec}`;
}

export function formatStep(step: number, unit: string | null | undefined, labels: TimeLabels): string {
  return `+${isMinuteUnit(unit) ? formatTime(step, labels) : step}`;
}

/** Time still to go, always with its unit: "2d 30s". */
export function formatTimeLeft(minutes: number, labels: TimeLabels): string {
  return formatTime(minutes, labels);
}

/** The running total. Whole minutes stay plain, so "12 / 30 daqiqa" does not repeat itself. */
export function formatCount(value: number, unit: string | null | undefined, labels: TimeLabels): string {
  return isMinuteUnit(unit) && !Number.isInteger(value) ? formatTime(value, labels) : String(value);
}
