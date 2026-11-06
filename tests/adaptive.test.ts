import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHabitProfile, formatMinute, learnFormDefaults, orderByHabit, pickHabitualNow, type HabitEvent, type PlanLike,
} from "../src/lib/adaptive.ts";

const at = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second).getTime();
const tap = (activityId: string, time: number, amount = 1, isStep = true): HabitEvent => ({ activityId, amount, at: time, isStep });

test("nothing is learned from too little evidence", () => {
  const profile = buildHabitProfile([tap("a", at(1, 7)), tap("a", at(2, 7))]);
  assert.deepEqual(profile, { usualMinute: {}, favoriteStep: {}, usualChunk: {} });
});

test("usual time is the median first touch of each day", () => {
  const profile = buildHabitProfile([tap("a", at(1, 7)), tap("a", at(1, 21)), tap("a", at(2, 7, 30)), tap("a", at(3, 8))]);
  assert.equal(profile.usualMinute.a, 7 * 60 + 30);
});

test("favourite step needs repeated use and ignores tick-to-fill", () => {
  const events = [1, 2, 3, 4, 5].map((day) => tap("a", at(day, 9), 5));
  events.push(tap("a", at(6, 9), 33, false));
  assert.equal(buildHabitProfile(events).favoriteStep.a, 5);
});

test("a repeated sitting total becomes a one-tap amount, undo included", () => {
  const events: HabitEvent[] = [];
  for (const day of [1, 2, 3]) {
    for (let second = 0; second < 3; second += 1) events.push(tap("a", at(day, 6, 0, second), 10));
    events.push(tap("a", at(day, 6, 0, 10), 5), tap("a", at(day, 6, 0, 12), -2));
  }
  assert.equal(buildHabitProfile(events).usualChunk.a, 33);
});

test("check tasks learn from locally recorded times", () => {
  assert.equal(buildHabitProfile([], { a: [400, 420, 440] }).usualMinute.a, 420);
});

test("ordering moves only learned plans and is stable for the rest", () => {
  const list = [{ id: "x" }, { id: "late" }, { id: "y" }, { id: "early" }];
  const ordered = orderByHabit(list, { late: 1200, early: 300 });
  assert.deepEqual(ordered.map((item) => item.id), ["x", "early", "y", "late"]);
  assert.equal(orderByHabit(list, { late: 1 }), list);
});

test("habitual pick wraps around midnight and respects the window", () => {
  const list = [{ id: "night" }, { id: "noon" }];
  assert.equal(pickHabitualNow(list, { night: 1430, noon: 720 }, 10)?.id, "night");
  assert.equal(pickHabitualNow(list, { noon: 720 }, 900), null);
});

test("form defaults appear only for a clear pattern", () => {
  const plan = (unit: string, target: number): PlanLike => ({
    measurement_type: "count", unit, target, time_of_day: "morning",
    schedule_rule: { weekdays: [5, 1, 2, 3, 4], duration_preset: "1_month" },
  });
  const defaults = learnFormDefaults([plan("bet", 20), plan("bet", 10), plan("bet", 30)]);
  assert.equal(defaults.kind, "count");
  assert.equal(defaults.unit, "bet");
  assert.equal(defaults.timeOfDay, "morning");
  assert.deepEqual(defaults.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(defaults.durationPreset, "1_month");
  assert.equal(defaults.targetByUnit.bet, 20, "newest target wins");
  assert.equal(learnFormDefaults([plan("bet", 20), plan("bet", 10)]).kind, undefined);
});

test("minutes format as a clock", () => assert.equal(formatMinute(7 * 60 + 5), "07:05"));
