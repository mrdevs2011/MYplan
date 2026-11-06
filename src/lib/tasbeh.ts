export const TASBEH_TARGETS = [33, 99, 100, 0] as const; // 0 = endless

export interface TasbehState {
  count: number; // taps in the current round
  rounds: number; // completed rounds
  target: number;
  total: number; // all taps counted since the last reset
  updatedAt: number; // epoch ms of the last change; decides which copy wins when syncing
}

export const EMPTY_TASBEH: TasbehState = { count: 0, rounds: 0, target: 33, total: 0, updatedAt: 0 };

const whole = (value: unknown) => Math.max(0, Math.floor(Number(value)) || 0);

export function normalizeTasbeh(raw: unknown): TasbehState {
  if (!raw || typeof raw !== "object") return EMPTY_TASBEH;
  const r = raw as Partial<Record<keyof TasbehState, unknown>>;
  const target = (TASBEH_TARGETS as readonly number[]).includes(Number(r.target)) ? Number(r.target) : EMPTY_TASBEH.target;
  const count = whole(r.count);
  const rounds = whole(r.rounds);
  const total = r.total === undefined ? rounds * target + count : whole(r.total);
  return { count, rounds, target, total, updatedAt: whole(r.updatedAt) };
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
