import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_TASBEH, normalizeTasbeh, resetTasbeh, setTasbehTarget, tapTasbeh, undoTasbeh } from "../src/lib/tasbeh.ts";

test("reaching the target starts a new round and keeps counting the total", () => {
  let s = { ...EMPTY_TASBEH, target: 3 };
  for (let i = 0; i < 7; i++) s = tapTasbeh(s);
  assert.deepEqual([s.count, s.rounds, s.total], [1, 2, 7]);
});

test("undo steps back across a round boundary", () => {
  let s = { ...EMPTY_TASBEH, target: 3 };
  for (let i = 0; i < 3; i++) s = tapTasbeh(s);
  assert.deepEqual([s.count, s.rounds], [0, 1]);
  s = undoTasbeh(s);
  assert.deepEqual([s.count, s.rounds, s.total], [2, 0, 2]);
  assert.equal(undoTasbeh(EMPTY_TASBEH), EMPTY_TASBEH);
});

test("endless mode never rolls over", () => {
  let s = { ...EMPTY_TASBEH, target: 0 };
  for (let i = 0; i < 150; i++) s = tapTasbeh(s);
  assert.deepEqual([s.count, s.rounds, s.total], [150, 0, 150]);
});

test("reset and target change", () => {
  const s = tapTasbeh(EMPTY_TASBEH);
  assert.deepEqual([resetTasbeh(s).count, resetTasbeh(s).total], [0, 0]);
  assert.equal(resetTasbeh(EMPTY_TASBEH), EMPTY_TASBEH);
  assert.equal(setTasbehTarget(s, 7), s);
  assert.deepEqual([setTasbehTarget(s, 99).count, setTasbehTarget(s, 99).total], [0, 1]);
});

test("old saved state without a total is upgraded; junk is ignored", () => {
  assert.equal(normalizeTasbeh({ count: 5, rounds: 2, target: 33 }).total, 71);
  assert.deepEqual(normalizeTasbeh("x"), EMPTY_TASBEH);
  assert.equal(normalizeTasbeh({ count: -4, target: 12 }).target, 0);
});
