import assert from "node:assert/strict";
import { test } from "node:test";
import { MELODY_SECONDS, melodyNotes } from "../src/lib/timer-melody.ts";

const PENTATONIC = [659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

test("every note belongs to one pentatonic scale, so nothing clashes", () => {
  for (const note of melodyNotes()) assert.ok(PENTATONIC.some((f) => Math.abs(f - note.freq) < 0.01), String(note.freq));
});

test("it ends by itself, quietly, and is neither long nor loud", () => {
  const notes = melodyNotes();
  const end = Math.max(...notes.map((n) => n.start + n.length));
  assert.ok(end <= MELODY_SECONDS, "ends within its stated length");
  assert.ok(MELODY_SECONDS <= 20, "stops on its own within 20 seconds");
  assert.ok(Math.max(...notes.map((n) => n.volume)) <= 0.25, "never loud");
  const first = notes.filter((n) => n.start < 7.5), second = notes.filter((n) => n.start >= 7.5);
  assert.equal(first.length, second.length);
  assert.ok(second[0].volume < first[0].volume, "the repeat is softer");
});

test("notes arrive in time order", () => {
  const starts = melodyNotes().map((n) => n.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});
