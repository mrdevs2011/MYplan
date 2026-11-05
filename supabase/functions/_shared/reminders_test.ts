import { dueStageIds, dueSummaryTime, planReminderMinutes } from "./reminders.ts";

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

Deno.test("the ladder fires pre, due, late1, late2 exactly once each over a day", () => {
  const base = 600, seen: string[] = [];
  for (let minute = 0; minute < 1440; minute++) for (const id of dueStageIds(base, minute)) if (!seen.includes(id)) seen.push(id);
  eq(seen, ["pre", "due", "late1", "late2"]);
  eq(dueStageIds(base, 589), []);
  eq(dueStageIds(base, 590), ["pre"]);
  eq(dueStageIds(base, 600), ["due"]);
  eq(dueStageIds(base, 620), ["late1"]);
  eq(dueStageIds(base, 660), ["late2"]);
});

Deno.test("a missed cron tick still catches up inside the window", () => {
  eq(dueStageIds(600, 612), ["due"]);
});

Deno.test("summary nags at 12:00, 15:00, 18:00 and 20:30 only", () => {
  eq(dueSummaryTime(720), 720);
  eq(dueSummaryTime(735), 720);
  eq(dueSummaryTime(745), undefined);
  eq(dueSummaryTime(1230), 1230);
});
