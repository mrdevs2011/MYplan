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
