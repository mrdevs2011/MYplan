import { DAILY_NUDGE_LIMIT, dueStageIds, dueSummaryTime, learnUsualMinutes, planReminderMinutes, reminderSlot, shouldRemind } from "./reminders.ts";

const eq = <T>(actual: T, expected: T) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
};

Deno.test("explicit reminder_time wins over the slot", () => {
  const plan = planReminderMinutes([{ id: "a", time_of_day: "evening", created_at: "1", reminder_time: "05:30:00" }]);
  eq(plan.get("a"), 330);
});

Deno.test("20 untimed tasks are spread, never in the same minute, inside the window", () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: `t${String(i).padStart(2, "0")}`, time_of_day: "anytime", created_at: String(i) }));
  const minutes = [...planReminderMinutes(tasks).values()];
  eq(new Set(minutes).size, 20);
  if (Math.min(...minutes) < 540 || Math.max(...minutes) >= 1200) throw new Error("outside 09:00-20:00");
});

Deno.test("slots map to their own windows", () => {
  const plan = planReminderMinutes([
    { id: "m", time_of_day: "morning", created_at: "1" },
    { id: "e", time_of_day: "evening", created_at: "1" },
  ]);
  if (plan.get("m")! < 480 || plan.get("m")! >= 690) throw new Error("morning window");
  if (plan.get("e")! < 1050 || plan.get("e")! >= 1230) throw new Error("evening window");
});

Deno.test("the ladder has one reminder at the moment and one follow-up", () => {
  const base = 600, seen: string[] = [];
  for (let minute = 0; minute < 1440; minute++) for (const id of dueStageIds(base, minute)) if (!seen.includes(id)) seen.push(id);
  eq(seen, ["pre", "due", "late1"]);
  eq(dueStageIds(base, 589), []);
  eq(dueStageIds(base, 590), ["pre"]);
  eq(dueStageIds(base, 600), ["due"]);
  eq(dueStageIds(base, 625), []);
  eq(dueStageIds(base, 645), ["late1"]);
});

Deno.test("a missed cron tick still catches up inside the window", () => {
  eq(dueStageIds(600, 612), ["due"]);
});

Deno.test("one summary a day, at 18:00", () => {
  eq(dueSummaryTime(1080), 1080);
  eq(dueSummaryTime(1095), 1080);
  eq(dueSummaryTime(1101), undefined);
  eq(dueSummaryTime(720), undefined);
});

Deno.test("reminders follow when the person really starts", () => {
  const points = ["2026-11-01", "2026-11-02", "2026-11-03"].flatMap((date, i) => [
    { activityId: "a", date, minute: 400 + i * 10 },
    { activityId: "a", date, minute: 1200 },
  ]);
  const usual = learnUsualMinutes(points);
  eq(usual.get("a"), 410);
  eq(learnUsualMinutes(points.slice(0, 4)).has("a"), false);
  eq(planReminderMinutes([{ id: "a", time_of_day: "evening", created_at: "1" }], usual).get("a"), 410);
  eq(planReminderMinutes([{ id: "a", time_of_day: "evening", created_at: "1", reminder_time: "05:30:00" }], usual).get("a"), 330);
});

Deno.test("a chosen time always fires, even at night or mid-work", () => {
  const context = { hasChosenTime: true, isQuiet: true, isActiveNow: true, nudgesToday: 99 };
  eq(shouldRemind({ ...context, stage: "due" }), true);
  eq(shouldRemind({ ...context, stage: "pre" }), true);
  eq(shouldRemind({ ...context, stage: "late1" }), false);
});

Deno.test("unchosen reminders respect quiet hours, active work and the daily limit", () => {
  const calm = { stage: "due" as const, hasChosenTime: false, isQuiet: false, isActiveNow: false, nudgesToday: 0 };
  eq(shouldRemind(calm), true);
  eq(shouldRemind({ ...calm, stage: "pre" }), false);
  eq(shouldRemind({ ...calm, isQuiet: true }), false);
  eq(shouldRemind({ ...calm, isActiveNow: true }), false);
  eq(shouldRemind({ ...calm, nudgesToday: DAILY_NUDGE_LIMIT }), false);
});

Deno.test("plans in the same half hour share a slot", () => {
  eq(reminderSlot(600), reminderSlot(629));
  eq(reminderSlot(600) === reminderSlot(630), false);
});
