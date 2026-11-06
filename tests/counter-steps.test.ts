import assert from "node:assert/strict";
import { test } from "node:test";
import { MINUTE_STEPS, formatCount, formatStep, formatTimeLeft, isMinuteUnit, roundAmount, stepsFor } from "../src/lib/counter-steps.ts";

const labels = { sec: "s", min: "d" };

test("only minute plans get time steps; other units keep Settings", () => {
  assert.deepEqual(stepsFor("daqiqa", [10, 5, 1]), MINUTE_STEPS);
  assert.deepEqual(stepsFor("marta", [7, 2]), [7, 2]);
  assert.deepEqual(stepsFor("soat", [7, 2]), [7, 2]);
  assert.deepEqual(stepsFor(null, [7, 2]), [7, 2]);
  assert.equal(isMinuteUnit(" Daqiqa "), true);
});

test("steps read as time", () => {
  assert.deepEqual(MINUTE_STEPS.map((step) => formatStep(step, "daqiqa", labels)), ["+10d", "+5d", "+1d", "+30s", "+12s"]);
  assert.equal(formatStep(1.5, "daqiqa", labels), "+1d 30s");
  assert.equal(formatStep(5, "marta", labels), "+5");
});

test("totals read as time without repeating whole minutes", () => {
  assert.equal(formatCount(12.5, "daqiqa", labels), "12d 30s");
  assert.equal(formatCount(0.2, "daqiqa", labels), "12s");
  assert.equal(formatCount(12, "daqiqa", labels), "12");
  assert.equal(formatCount(12, "marta", labels), "12");
  assert.equal(formatCount(0.99, "daqiqa", labels), "59s");
  assert.equal(formatCount(1.999, "daqiqa", labels), "2d");
});

test("time left always carries its unit", () => {
  assert.equal(formatTimeLeft(3, labels), "3d");
  assert.equal(formatTimeLeft(2.5, labels), "2d 30s");
  assert.equal(formatTimeLeft(0.1, labels), "6s");
});

test("repeated fractions land exactly on the target", () => {
  let total = 0;
  for (let i = 0; i < 15; i += 1) total = roundAmount(total + 0.2);
  assert.equal(total, 3);
  assert.equal(roundAmount(0.1 + 0.2), 0.3);
});
