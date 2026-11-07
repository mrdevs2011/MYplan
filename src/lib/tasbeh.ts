export const TASBEH_TARGETS = [33, 66, 99, 0] as const; // 0 = endless

export interface TasbehState {
  count: number; // taps in the current round
  rounds: number; // completed rounds
  target: number;
  total: number; // all taps counted since the last reset
  activityId: string | null; // today's plan the taps are booked on
}

export const EMPTY_TASBEH: TasbehState = { count: 0, rounds: 0, target: 0, total: 0, activityId: null };

const whole = (value: unknown) => Math.max(0, Math.floor(Number(value)) || 0);

export function normalizeTasbeh(raw: unknown): TasbehState {
  if (!raw || typeof raw !== "object") return EMPTY_TASBEH;
  const r = raw as Partial<Record<keyof TasbehState, unknown>>;
  const target = (TASBEH_TARGETS as readonly number[]).includes(Number(r.target)) ? Number(r.target) : EMPTY_TASBEH.target;
  const count = whole(r.count);
  const rounds = whole(r.rounds);
  const total = r.total === undefined ? rounds * target + count : whole(r.total);
  const activityId = typeof r.activityId === "string" && r.activityId ? r.activityId : null;
  return { count, rounds, target, total, activityId };
}

/** One tap. Reaching the target starts a new round. */
export function tapTasbeh(s: TasbehState): TasbehState {
  const count = s.count + 1;
  if (s.target > 0 && count >= s.target) return { ...s, count: 0, rounds: s.rounds + 1, total: s.total + 1 };
  return { ...s, count, total: s.total + 1 };
}

export function undoTasbeh(s: TasbehState): TasbehState {
  if (s.count > 0) return { ...s, count: s.count - 1, total: Math.max(0, s.total - 1) };
  if (s.rounds > 0 && s.target > 0) return { ...s, count: s.target - 1, rounds: s.rounds - 1, total: Math.max(0, s.total - 1) };
  return s;
}

export function resetTasbeh(s: TasbehState): TasbehState {
  if (s.count === 0 && s.rounds === 0 && s.total === 0) return s;
  return { ...s, count: 0, rounds: 0, total: 0 };
}

export function setTasbehTarget(s: TasbehState, target: number): TasbehState {
  if (target === s.target || !(TASBEH_TARGETS as readonly number[]).includes(target)) return s;
  return { ...s, target, count: 0 };
}

export function setTasbehActivity(s: TasbehState, activityId: string | null): TasbehState {
  return s.activityId === activityId ? s : { ...s, activityId };
}
