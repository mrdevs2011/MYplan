import assert from "node:assert/strict";
import { test } from "node:test";
import { isTasbehUnit, rankTasbehPlans, suggestTarget } from "../src/lib/tasbeh-plans.ts";
import { EMPTY_TASBEH, normalizeTasbeh, setTasbehActivity } from "../src/lib/tasbeh.ts";

test("zikr units are recognised, others are not", () => {
  assert.equal(isTasbehUnit(" Tasbeh "), true);
  assert.equal(isTasbehUnit("зикр"), true);
  assert.equal(isTasbehUnit("daqiqa"), false);
  assert.equal(isTasbehUnit(null), false);
});

test("the round length makes the plan end on a finished round", () => {
  assert.equal(suggestTarget(33, 99), 33);
  assert.equal(suggestTarget(100, 33), 100);
  assert.equal(suggestTarget(300, 33), 100);
  assert.equal(suggestTarget(66, 100), 33);
  assert.equal(suggestTarget(40, 99), 99); // nothing fits: keep the current one
  assert.equal(suggestTarget(0, 33), 33);
});

test("open plans rank first and a plan usually done now is picked without asking", () => {
  const plans = [
    { id: "done", title: "Done", remaining: 0, done: true },
    { id: "evening", title: "Evening", remaining: 100, done: false },
    { id: "morning", title: "Morning", remaining: 100, done: false },
  ];
  const signals = { nowMinute: 8 * 60, usualMinute: { morning: 8 * 60, evening: 20 * 60 }, recentIds: [], suggestedId: null };
  const ranked = rankTasbehPlans(plans, signals);
  assert.deepEqual(ranked.plans.map((plan) => plan.id), ["morning", "evening", "done"]);
  assert.equal(ranked.autoId, "morning");
  assert.equal(rankTasbehPlans(plans, { ...signals, usualMinute: {} }).autoId, null);
});

test("the linked plan is part of the saved counter", () => {
  assert.equal(normalizeTasbeh({ target: 33, count: 2 }).activityId, null);
  assert.equal(normalizeTasbeh({ activityId: "a1" }).activityId, "a1");
  assert.equal(setTasbehActivity(EMPTY_TASBEH, "a1").activityId, "a1");
  assert.equal(setTasbehActivity(EMPTY_TASBEH, null), EMPTY_TASBEH);
});
