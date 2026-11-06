// Run with: node --experimental-strip-types --test src/lib/stats.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { addDays, buildDays, buildStatusMap, computeStats, heatLevel, heatmapGrid, isScheduled, perfectStreak, prayerStats, statusKey, taskStats, weekdayOf, type StatActivity, type StatOccurrenceWithId } from "./stats.ts";

const act = (over: Partial<StatActivity> = {}): StatActivity => ({
  id: "a1", title: "Task", schedule_type: "daily", time_of_day: "morning", schedule_rule: { weekdays: [1, 2, 3, 4, 5, 6, 7] },
  measurement_type: "check", target: null, unit: "", is_active: true, starts_on: "2026-10-01", ends_on: null, ...over,
});
const occ = (activity_id: string, period_start: string, status: "completed" | "pending" | "skipped" = "completed", id = `${activity_id}-${period_start}`): StatOccurrenceWithId => ({ id, activity_id, period_start, status });

test("date helpers: weekday is Monday=1..Sunday=7 and addDays crosses months", () => {
  assert.equal(weekdayOf("2026-11-02"), 1); // Monday
  assert.equal(weekdayOf("2026-11-08"), 7); // Sunday
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("isScheduled honours start, end, weekdays, inactive and once", () => {
  assert.equal(isScheduled(act(), "2026-11-05"), true);
  assert.equal(isScheduled(act({ starts_on: "2026-11-06" }), "2026-11-05"), false);
  assert.equal(isScheduled(act({ ends_on: "2026-11-04" }), "2026-11-05"), false);
  assert.equal(isScheduled(act({ schedule_rule: { weekdays: [1] } }), "2026-11-05"), false); // Thursday
  assert.equal(isScheduled(act({ is_active: false }), "2026-11-05"), false);
  assert.equal(isScheduled(act({ schedule_type: "once", starts_on: "2026-11-05" }), "2026-11-05"), true);
  assert.equal(isScheduled(act({ schedule_type: "once", starts_on: "2026-11-05" }), "2026-11-06"), false);
});

test("days the app was never opened count as expected-but-not-done", () => {
  const status = buildStatusMap([occ("a1", "2026-11-04")]);
  const days = buildDays([act()], status, "2026-11-05", 3);
  assert.deepEqual(days.map((d) => [d.date, d.expected, d.done, d.pct]), [
    ["2026-11-03", 1, 0, 0],
    ["2026-11-04", 1, 1, 100],
    ["2026-11-05", 1, 0, 0],
  ]);
});

test("live (in-memory) status overrides the database for today", () => {
  const status = buildStatusMap([occ("a1", "2026-11-05", "pending")], [{ activity_id: "a1", status: "completed" }], "2026-11-05");
  assert.equal(status.get(statusKey("a1", "2026-11-05")), "completed");
});

test("a day with nothing scheduled has pct null and does not break a streak", () => {
  const a = act({ schedule_rule: { weekdays: [1, 2] } }); // Mon, Tue only
  const status = buildStatusMap([occ("a1", "2026-11-02"), occ("a1", "2026-11-03")]);
  const days = buildDays([a], status, "2026-11-04", 3); // Mon, Tue, Wed(nothing)
  assert.equal(days[2].pct, null);
  assert.deepEqual(perfectStreak(days), { current: 2, best: 2 });
});

test("perfect streak: an unfinished today does not break it, a missed past day does", () => {
  const days = buildDays([act()], buildStatusMap([occ("a1", "2026-11-03"), occ("a1", "2026-11-04")]), "2026-11-05", 5);
  assert.equal(perfectStreak(days).current, 2); // today open
  const broken = buildDays([act()], buildStatusMap([occ("a1", "2026-11-03"), occ("a1", "2026-11-05")]), "2026-11-05", 5);
  assert.equal(perfectStreak(broken).current, 1); // 11-04 missed
});

test("task stats: percentage, streak and last done", () => {
  const status = buildStatusMap([occ("a1", "2026-11-02"), occ("a1", "2026-11-03"), occ("a1", "2026-11-04")]);
  const [t] = taskStats([act({ starts_on: "2026-11-01" })], status, "2026-11-05", 30);
  assert.equal(t.expected, 5); // 11-01 .. 11-05
  assert.equal(t.done, 3);
  assert.equal(t.pct, 60);
  assert.equal(t.streak, 3); // today open, 11-04..11-02 done, 11-01 missed
  assert.equal(t.lastDone, "2026-11-04");
});

test("heat levels and heatmap shape", () => {
  assert.deepEqual([null, 0, 10, 50, 90, 100].map(heatLevel), [0, 0, 1, 2, 3, 4]);
  const days = buildDays([act()], buildStatusMap([]), "2026-11-05", 90);
  const grid = heatmapGrid(days, "2026-11-05", 12);
  assert.equal(grid.length, 12);
  assert.ok(grid.every((col) => col.length === 7));
  assert.equal(grid[11][3]?.date, "2026-11-05"); // Thursday = index 3 (Mon=0) in the last column
  assert.equal(grid[11][4], null); // the future stays empty
});

test("computeStats ties it together: averages, prayers and counters", () => {
  const prayers = ["Bomdod", "Peshin", "Asr"].map((title, i) => act({ id: `p${i}`, title }));
  const water = act({ id: "w", title: "Suv ichish", measurement_type: "count", target: 8, unit: "stakan", time_of_day: "anytime" });
  const occurrences: StatOccurrenceWithId[] = [
    ...["2026-11-03", "2026-11-04"].flatMap((d) => [...prayers.map((p) => occ(p.id, d)), occ("w", d, "completed", `w-${d}`)]),
  ];
  const events = [{ occurrence_id: "w-2026-11-04", amount: 5 }, { occurrence_id: "w-2026-11-04", amount: 3 }];
  const s = computeStats({ activities: [...prayers, water], occurrences, events, todayKey: "2026-11-05" });
  assert.equal(s.today.expected, 4);
  assert.equal(s.today.done, 0);
  assert.equal(s.streak.current, 2);
  assert.equal(s.prayers?.count, 3);
  assert.equal(s.prayers?.current, 2);
  const counter = s.counters[0];
  assert.equal(counter.week[5], 8); // yesterday
  assert.equal(counter.weekTotal, 8);
  assert.equal(counter.weekGoal, 56);
  assert.ok(s.tasks.length === 4 && s.tasks[0].pct !== null);
});

test("no activities: everything is empty but safe", () => {
  const s = computeStats({ activities: [], occurrences: [], events: [], todayKey: "2026-11-05" });
  assert.equal(s.avg7, null);
  assert.equal(s.prayers, null);
  assert.deepEqual(s.tasks, []);
  assert.equal(s.streak.current, 0);
});

test("prayer ring and its 'x / y days' line describe the same finished days", () => {
  const prayer = (id: string, title: string) => ({
    id, title, schedule_type: "daily" as const, measurement_type: "check" as const, target: null, unit: null,
    is_active: true, starts_on: "2026-11-01", ends_on: null, schedule_rule: null,
  });
  const acts = [prayer("a", "Bomdod"), prayer("b", "Peshin")];
  const status = new Map<string, "pending" | "completed" | "skipped">([
    ["a|2026-11-05", "completed"], ["b|2026-11-05", "completed"], // yesterday: everything done
    ["a|2026-11-06", "completed"],                                 // today: half done so far
  ]);
  const r = prayerStats(acts, status, "2026-11-06", 30)!;
  assert.equal(r.trackedDays, 5);
  assert.equal(r.perfectDays, 1);
  // Only finished days feed the ring, so a half-done today cannot pull it below what the text says.
  assert.equal(r.avg, 20); // 1 perfect day out of 5 finished days (4 days with nothing done)
});
