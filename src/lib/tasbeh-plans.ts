/**
 * Tasbeh knows about the day's counting plans (zikr, salawat, ...). Taps are booked on the chosen plan, the plan is
 * chosen from what the person already does (same scoring as the timer), and the round length follows what is left.
 */
import { confidentPick, rankTasksForTimer, type RankSignals, type TimeTask } from "./time-tasks.ts";
import { TASBEH_TARGETS } from "./tasbeh.ts";

export interface TasbehPlan {
  id: string;
  title: string;
  /** Taps still missing today. */
  remaining: number;
  done: boolean;
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
  const ranked = rankTasksForTimer(tasks, signals).map((task) => byId.get(task.id)!);
  return { plans: ranked, autoId: confidentPick(tasks, signals)?.id ?? null };
}
