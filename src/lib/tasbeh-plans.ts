/**
 * Tasbeh knows about the day's counting plans (zikr, salawat, ...). Taps are booked on the chosen plan, the plan is
 * chosen from what the person already does (same scoring as the timer), and the round length follows what is left.
 */
import { confidentPick, rankTasksForTimer, type RankSignals, type TimeTask } from "./time-tasks.ts";
import { TASBEH_TARGETS } from "./tasbeh.ts";
import { isMinuteUnit } from "./counter-steps.ts";

export interface TasbehPlan {
  id: string;
  title: string;
  /** Taps still missing today. */
  remaining: number;
  done: boolean;
  /** A zikr plan: the counter's own kind of plan, offered before the other counting plans. */
  zikr: boolean;
}

/** Hours belong to the timer, like minutes. */
const TIME_UNITS = new Set(["soat", "hour", "hours", "час", "часа", "часов"]);

/** Any plan that counts things (ta, dona, bet, rakat, zikr, ...): time plans belong to the timer and stopwatch. */
export function isCountingUnit(unit: string | null | undefined): boolean {
  return !isMinuteUnit(unit) && !TIME_UNITS.has((unit ?? "").trim().toLowerCase());
}

const TASBEH_UNITS = new Set(["tasbeh", "tasbih", "tasbeeh", "zikr", "dhikr", "тасбих", "зикр"]);

export function isTasbehUnit(unit: string | null | undefined): boolean {
  return TASBEH_UNITS.has((unit ?? "").trim().toLowerCase());
}

/** The round length that makes the plan end exactly on a finished round; the current one when nothing fits. */
export function suggestTarget(remaining: number, current: number): number {
  if (!Number.isInteger(remaining) || remaining <= 0) return current;
  if (remaining <= 100 && (TASBEH_TARGETS as readonly number[]).includes(remaining)) return remaining;
  return [100, 33, 99].find((round) => remaining % round === 0) ?? current;
}

const asTimeTask = (plan: TasbehPlan): TimeTask => ({
  id: plan.id,
  title: plan.title,
  minuteBased: true, // every plan here is counted by the tool, which is what that flag means for the scoring
  remainingMin: plan.remaining,
  usualMin: null,
  done: plan.done,
});

/** Best plan first (finished ones last) and the one worth choosing without asking, if any. */
export function rankTasbehPlans(plans: TasbehPlan[], signals: RankSignals): { plans: TasbehPlan[]; autoId: string | null } {
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const tasks = plans.map(asTimeTask);
  const scored = rankTasksForTimer(tasks, signals).map((task) => byId.get(task.id)!);
  // Zikr plans first among the open ones (a stable split keeps the scoring order inside each group).
  const open = scored.filter((plan) => !plan.done);
  const ranked = [...open.filter((plan) => plan.zikr), ...open.filter((plan) => !plan.zikr), ...scored.filter((plan) => plan.done)];
  const pickable = open.some((plan) => plan.zikr) ? tasks.filter((task) => byId.get(task.id)!.zikr) : tasks;
  return { plans: ranked, autoId: confidentPick(pickable, signals)?.id ?? null };
}
