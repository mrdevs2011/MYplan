import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMinutesFor, minutesToLog, orderTasksForTimer, smartPresets, type TimeTask } from "../src/lib/time-tasks.ts";

const task = (over: Partial<TimeTask> = {}): TimeTask => ({
  id: "t", title: "Planka", minuteBased: true, remainingMin: 3, usualMin: 2, done: false, ...over,
});

test("only real work is logged, never more than what is left, never twice", () => {
  assert.equal(minutesToLog(5_000, 0, 3), 0); // an accidental tap
  assert.equal(minutesToLog(150_000, 0, 5), 2.5);
  assert.equal(minutesToLog(10 * 60_000, 0, 3), 3); // capped at what is missing
  assert.equal(minutesToLog(150_000, 150_000, 5), 0); // already on the plan
  assert.equal(minutesToLog(210_000, 150_000, null), 1); // only the new part
});

test("presets put the learned length and the remainder first", () => {
  assert.deepEqual(smartPresets(task({ usualMin: 7, remainingMin: 3 })), [1, 3, 5, 7, 10]);
  assert.deepEqual(smartPresets(null), [1, 5, 10, 25]);
  assert.deepEqual(smartPresets(task({ minuteBased: false })), [1, 5, 10, 25]);
});

test("a fresh timer starts with what is left, capped by the usual sitting", () => {
  assert.equal(defaultMinutesFor(task({ remainingMin: 3, usualMin: 2 })), 2);
  assert.equal(defaultMinutesFor(task({ remainingMin: 3, usualMin: null })), 3);
  assert.equal(defaultMinutesFor(task({ remainingMin: 0, usualMin: 5 })), 5);
  assert.equal(defaultMinutesFor(task({ minuteBased: false })), null);
  assert.equal(defaultMinutesFor(null), null);
});

test("picker order: suggested minute plan, other minute plans, other open plans, finished last", () => {
  const list = [
    task({ id: "done", done: true }),
    task({ id: "check", minuteBased: false }),
    task({ id: "min" }),
    task({ id: "pick" }),
  ];
  assert.deepEqual(orderTasksForTimer(list, "pick").map((x) => x.id), ["pick", "min", "check", "done"]);
});

import { confidentPick, freezeOrder, rankTasksForTimer, type RankSignals } from "../src/lib/time-tasks.ts";

const signals = (over: Partial<RankSignals> = {}): RankSignals => ({
  nowMinute: 8 * 60, usualMinute: {}, recentIds: [], suggestedId: null, ...over,
});

test("the plan usually done around now comes first", () => {
  const list = [task({ id: "evening" }), task({ id: "morning" })];
  const ranked = rankTasksForTimer(list, signals({ usualMinute: { morning: 8 * 60 + 10, evening: 20 * 60 } }));
  assert.equal(ranked[0].id, "morning");
});

test("recently used plans are bumped, finished ones sink", () => {
  const list = [task({ id: "a", done: true }), task({ id: "b" }), task({ id: "c" })];
  const ranked = rankTasksForTimer(list, signals({ recentIds: ["c"] }));
  assert.deepEqual(ranked.map((x) => x.id), ["c", "b", "a"]);
});

test("a plan is only chosen on its own when it is clearly the one", () => {
  const habitual = task({ id: "plank", remainingMin: 5 });
  const other = task({ id: "run", remainingMin: 5 });
  const s = signals({ usualMinute: { plank: 8 * 60 } });
  assert.equal(confidentPick([habitual, other], s)?.id, "plank");
  // two equally likely plans: do not guess
  assert.equal(confidentPick([habitual, other], signals({ usualMinute: { plank: 8 * 60, run: 8 * 60 } })), null);
  // nothing learned yet: do not guess
  assert.equal(confidentPick([habitual, other], signals()), null);
  // a plan that is already finished is never chosen
  assert.equal(confidentPick([task({ id: "x", done: true, remainingMin: 0 })], s), null);
});

test("the picker keeps its order once seen, new plans go last", () => {
  const first = freezeOrder([{ id: "a" }, { id: "b" }], []);
  assert.deepEqual(first.items.map((x) => x.id), ["a", "b"]);
  const later = freezeOrder([{ id: "c" }, { id: "b" }, { id: "a" }], first.order);
  assert.deepEqual(later.items.map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(freezeOrder([{ id: "b" }], later.order).items.map((x) => x.id), ["b"]);
});
