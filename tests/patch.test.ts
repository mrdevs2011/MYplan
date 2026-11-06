import assert from "node:assert/strict";
import { test } from "node:test";
import { changedFields } from "../src/lib/patch.ts";

test("only the edited fields are sent", () => {
  const before = { title: "A", target: 5, ends_on: null, schedule_rule: { weekdays: [1, 2] } };
  const after = { title: "B", target: 5, ends_on: null, schedule_rule: { weekdays: [1, 2] } };
  assert.deepEqual(changedFields(before, after), { title: "B" });
  assert.deepEqual(changedFields(before, { ...after, title: "A", schedule_rule: { weekdays: [1] } }), { schedule_rule: { weekdays: [1] } });
});

test("null and a missing value are the same; nothing changed gives an empty patch", () => {
  assert.deepEqual(changedFields({ ends_on: undefined }, { ends_on: null }), {});
  assert.deepEqual(changedFields({ a: 1 }, { a: 1 }), {});
});
