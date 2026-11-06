import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACK_PROGRESS_TTL_MS, ACK_STATUS_TTL_MS, isPermanentWriteError, localProgressEvents, localStatuses, newEventId, nextBatch,
  reconcileCount, type OutboxItem,
} from "../src/lib/progress-sync.ts";

const progress = (id: string, amount = 1, occurrence_id = "occ"): OutboxItem => ({
  id: `m-${id}`, type: "progress_event", createdAt: 0, payload: { id, occurrence_id, amount },
});
const status = (id: string, value: string): OutboxItem => ({
  id: `s-${id}-${value}`, type: "occurrence_status", createdAt: 0, payload: { id, status: value },
});

test("a late snapshot cannot move rapid taps backwards", () => {
  // 5 taps made, the server has only seen the first 2.
  const local = localProgressEvents([1, 2, 3, 4, 5].map((n) => progress(`e${n}`)), [], 0);
  const server = [{ id: "e1", amount: 1 }, { id: "e2", amount: "1.00" }];
  assert.equal(reconcileCount(server, local, "occ", Infinity), 5);
});

test("an event acknowledged after the snapshot was requested is still counted, exactly once", () => {
  const acked = [{ at: 1000, progress: { id: "e1", occurrenceId: "occ", amount: 1 } }];
  const local = localProgressEvents([], acked, 1500);
  assert.equal(reconcileCount([], local, "occ", Infinity), 1);
  assert.equal(reconcileCount([{ id: "e1", amount: 1 }], local, "occ", Infinity), 1);
});

test("acknowledged events expire so other devices stay authoritative", () => {
  const acked = [{ at: 0, progress: { id: "e1", occurrenceId: "occ", amount: 1 } }];
  assert.equal(localProgressEvents([], acked, ACK_PROGRESS_TTL_MS).length, 0);
});

test("counts stay inside 0..target and ignore other occurrences", () => {
  const local = [{ id: "x", occurrenceId: "other", amount: 50 }, { id: "y", occurrenceId: "occ", amount: -9 }];
  assert.equal(reconcileCount([{ id: "a", amount: 3 }], local, "occ", 10), 0);
  assert.equal(reconcileCount([{ id: "a", amount: 30 }], [], "occ", 10), 10);
});

test("the newest local status wins over an old echo", () => {
  const acked = [{ at: 100, status: { occurrenceId: "occ", status: "completed" } }];
  assert.equal(localStatuses([status("occ", "pending")], acked, 200).get("occ"), "pending");
  assert.equal(localStatuses([], acked, 200).get("occ"), "completed");
  assert.equal(localStatuses([], acked, 100 + ACK_STATUS_TTL_MS).has("occ"), false);
});

test("batches keep order: progress runs together, status alone", () => {
  const queue = [progress("a"), progress("b"), status("occ", "completed"), progress("c")];
  assert.deepEqual(nextBatch(queue, 50).map((item) => item.id), ["m-a", "m-b"]);
  assert.deepEqual(nextBatch(queue.slice(2), 50).map((item) => item.id), ["s-occ-completed"]);
  assert.equal(nextBatch(queue, 1).length, 1);
  assert.deepEqual(nextBatch([], 50), []);
});

test("only unrecoverable errors may leave the queue", () => {
  assert.equal(isPermanentWriteError("23503"), true);
  assert.equal(isPermanentWriteError(undefined), false);
  assert.equal(isPermanentWriteError("57014"), false);
});

test("event ids are valid uuids even without crypto.randomUUID", () => {
  const original = crypto.randomUUID;
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    assert.match(newEventId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
  }
});
