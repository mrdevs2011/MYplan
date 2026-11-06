import assert from "node:assert/strict";
import { test } from "node:test";
import { overlayPendingActivities, pendingProfilePatch, remapOutboxIds, type OutboxItem } from "../src/lib/progress-sync.ts";

const item = (type: string, payload: Record<string, unknown>): OutboxItem => ({ id: `m_${type}`, type, payload, createdAt: 0 });

test("a local occurrence id is rewritten to the server's id in every queued write", () => {
  const queue = [
    item("progress_event", { id: "e1", user_id: "u", occurrence_id: "local", amount: 1 }),
    item("occurrence_status", { id: "local", user_id: "u", status: "completed" }),
    item("progress_event", { id: "e2", user_id: "u", occurrence_id: "other", amount: 1 }),
  ];
  const out = remapOutboxIds(queue, "local", "real");
  assert.equal(out[0].payload.occurrence_id, "real");
  assert.equal(out[1].payload.id, "real");
  assert.equal(out[2].payload.occurrence_id, "other");
});

test("activities written offline stay visible over a server snapshot", () => {
  const server = [{ id: "a", title: "old" }];
  const queue = [
    item("activity_write", { user_id: "u", id: "b", row: { id: "b", title: "new" } }),
    item("activity_update", { user_id: "u", id: "a", patch: { title: "edited" } }),
    item("activity_write", { user_id: "someone-else", id: "c", row: { id: "c", title: "x" } }),
  ];
  assert.deepEqual(overlayPendingActivities(server, queue, "u").map((a) => `${a.id}:${a.title}`), ["b:new", "a:edited"]);
});

test("profile patches made offline are merged in order and only for this account", () => {
  const queue = [
    item("profile_patch", { user_id: "u", patch: { language: "en", sound_enabled: false } }),
    item("profile_patch", { user_id: "u", patch: { language: "ru" } }),
    item("profile_patch", { user_id: "x", patch: { language: "uz" } }),
  ];
  assert.deepEqual(pendingProfilePatch(queue, "u"), { language: "ru", sound_enabled: false });
});
