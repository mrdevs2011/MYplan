import assert from "node:assert/strict";
import { test } from "node:test";
import { isCountingUnit, isTasbehUnit, rankTasbehPlans, suggestTarget } from "../src/lib/tasbeh-plans.ts";
import { EMPTY_TASBEH, normalizeTasbeh, setTasbehActivity } from "../src/lib/tasbeh.ts";

test("zikr units are recognised, others are not", () => {
  assert.equal(isTasbehUnit(" Tasbeh "), true);
  assert.equal(isTasbehUnit("зикр"), true);
  assert.equal(isTasbehUnit("daqiqa"), false);
  assert.equal(isTasbehUnit(null), false);
});

test("every counting unit works with the counter, time units do not", () => {
  for (const unit of ["ta", "dona", "bet", "rakat", "tasbeh", "marta"]) assert.equal(isCountingUnit(unit), true);
  for (const unit of ["daqiqa", "min", "soat", "минут"]) assert.equal(isCountingUnit(unit), false);
});

test("a round length only when the plan is exactly 33, 66 or 99; otherwise endless", () => {
  assert.equal(suggestTarget(33), 33);
  assert.equal(suggestTarget(66), 66);
  assert.equal(suggestTarget(99), 99);
  assert.equal(suggestTarget(100), 0);
  assert.equal(suggestTarget(8), 0);
  assert.equal(suggestTarget(300), 0);
});

test("open plans rank first and a plan usually done now is picked without asking", () => {
  const plans = [
    { id: "done", title: "Done", remaining: 0, done: true, zikr: false },
    { id: "evening", title: "Evening", remaining: 100, done: false, zikr: true },
    { id: "morning", title: "Morning", remaining: 100, done: false, zikr: true },
  ];
  const signals = { nowMinute: 8 * 60, usualMinute: { morning: 8 * 60, evening: 20 * 60 }, recentIds: [], suggestedId: null };
  const ranked = rankTasbehPlans(plans, signals);
  assert.deepEqual(ranked.plans.map((plan) => plan.id), ["morning", "evening", "done"]);
  assert.equal(ranked.autoId, "morning");
  assert.equal(rankTasbehPlans(plans, { ...signals, usualMinute: {} }).autoId, null);
});

test("zikr plans come before other counting plans", () => {
  const plans = [
    { id: "pages", title: "Pages", remaining: 50, done: false, zikr: false },
    { id: "zikr", title: "Zikr", remaining: 33, done: false, zikr: true },
  ];
  const signals = { nowMinute: 600, usualMinute: { pages: 600 }, recentIds: [], suggestedId: null };
  assert.deepEqual(rankTasbehPlans(plans, signals).plans.map((plan) => plan.id), ["zikr", "pages"]);
});

test("the linked plan is part of the saved counter", () => {
  assert.equal(normalizeTasbeh({ target: 33, count: 2 }).activityId, null);
  assert.equal(normalizeTasbeh({ activityId: "a1" }).activityId, "a1");
  assert.equal(setTasbehActivity(EMPTY_TASBEH, "a1").activityId, "a1");
  assert.equal(setTasbehActivity(EMPTY_TASBEH, null), EMPTY_TASBEH);
});
