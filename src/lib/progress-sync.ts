/**
 * Local-first write path. Every tap is written to a durable outbox first and uploaded afterwards, and every
 * server snapshot is merged with what this device has not seen acknowledged yet. A late response can therefore
 * never move a number or a checkbox backwards.
 */

const OUTBOX_KEY = "myplan_offline_sync_queue";

export interface OutboxItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
  /** Sent once the write is acknowledged, so a quick tick/untick never announces a completion. */
  notify?: Record<string, unknown>;
}

export interface LocalProgress {
  id: string;
  occurrenceId: string;
  amount: number;
}

export interface AckedWrite {
  at: number;
  progress?: LocalProgress;
  status?: { occurrenceId: string; status: string };
}

/** Acknowledged events stay visible this long: a snapshot requested before the ack may not contain them. */
export const ACK_PROGRESS_TTL_MS = 60_000;
/** Status has no event id to de-duplicate on, so it only shields against echoes of this device's own writes. */
export const ACK_STATUS_TTL_MS = 8_000;

/** RFC 4122 v4 id. `crypto.randomUUID` is missing on older browsers and plain-HTTP pages; a tap must never throw. */
export function newEventId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Used when localStorage is blocked or full, so a tap still reaches the server while the page is open.
let memoryOutbox: OutboxItem[] = [];

export function readOutbox(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (raw === null) return memoryOutbox;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : memoryOutbox;
  } catch {
    return memoryOutbox;
  }
}

export function writeOutbox(items: OutboxItem[]) {
  memoryOutbox = items;
  try {
    if (items.length > 0) localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // The in-memory copy above keeps working until the page closes.
  }
}

export function toLocalProgress(item: OutboxItem): LocalProgress | null {
  if (item.type !== "progress_event") return null;
  const { id, occurrence_id: occurrenceId, amount } = item.payload;
  if (typeof id !== "string" || typeof occurrenceId !== "string") return null;
  return { id, occurrenceId, amount: Number(amount) || 0 };
}

export function localProgressEvents(queue: OutboxItem[], acked: AckedWrite[], now: number): LocalProgress[] {
  const events = new Map<string, LocalProgress>();
  for (const write of acked) {
    if (write.progress && now - write.at < ACK_PROGRESS_TTL_MS) events.set(write.progress.id, write.progress);
  }
  for (const item of queue) {
    const event = toLocalProgress(item);
    if (event) events.set(event.id, event);
  }
  return [...events.values()];
}

/** The status this device last chose per occurrence, newest write winning. */
export function localStatuses(queue: OutboxItem[], acked: AckedWrite[], now: number): Map<string, string> {
  const statuses = new Map<string, string>();
  for (const write of acked) {
    if (write.status && now - write.at < ACK_STATUS_TTL_MS) statuses.set(write.status.occurrenceId, write.status.status);
  }
  for (const item of queue) {
    if (item.type === "occurrence_status" && typeof item.payload.id === "string") {
      statuses.set(item.payload.id, String(item.payload.status));
    }
  }
  return statuses;
}

/** Server rows plus every local event the server has not returned yet. Ids make the merge exact, never double. */
export function reconcileCount(
  serverRows: { id: string; amount: number | string }[],
  localEvents: LocalProgress[],
  occurrenceId: string,
  cap: number,
): number {
  const seen = new Set(serverRows.map((row) => row.id));
  let total = serverRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  for (const event of localEvents) {
    if (event.occurrenceId === occurrenceId && !seen.has(event.id)) total += event.amount;
  }
  // Minute plans hold fractions; the database keeps two decimals, so the sum must too.
  return Math.min(Math.max(0, Math.round(total * 100) / 100), cap);
}

/** The next upload: a run of consecutive progress events travels as one request, anything else alone. */
export function nextBatch(items: OutboxItem[], maxBatch: number): OutboxItem[] {
  if (items.length === 0) return [];
  if (items[0].type !== "progress_event") return [items[0]];
  const batch: OutboxItem[] = [];
  for (const item of items) {
    if (item.type !== "progress_event" || batch.length >= maxBatch) break;
    batch.push(item);
  }
  return batch;
}

/** Postgres/PostgREST errors that can never succeed on retry; keeping them would block the queue forever. */
export function isPermanentWriteError(code: string | undefined): boolean {
  if (!code) return false;
  return ["23503", "23514", "22P02", "42501", "PGRST116", "PGRST204"].includes(code);
}

/**
 * A row created offline carries a locally made id. If the server already has that row under another id,
 * every queued write that points at the local id is rewritten to the real one.
 */
export function remapOutboxIds(queue: OutboxItem[], fromId: string, toId: string): OutboxItem[] {
  return queue.map((item) => {
    const payload = item.payload;
    if (payload?.occurrence_id !== fromId && payload?.id !== fromId) return item;
    return {
      ...item,
      payload: {
        ...payload,
        ...(payload.occurrence_id === fromId ? { occurrence_id: toId } : {}),
        ...(item.type === "occurrence_status" && payload.id === fromId ? { id: toId } : {}),
      },
    };
  });
}

/** Activities written offline, laid over a server snapshot so a refresh never hides them before they upload. */
export function overlayPendingActivities<A extends { id: string }>(acts: A[], queue: OutboxItem[], userId: string): A[] {
  let result = acts;
  for (const item of queue) {
    if (item.payload?.user_id !== userId) continue;
    if (item.type === "activity_write") {
      const row = item.payload.row as A;
      result = result.some((a) => a.id === row.id)
        ? result.map((a) => (a.id === row.id ? { ...a, ...row } : a))
        : [row, ...result];
    } else if (item.type === "activity_update") {
      const id = String(item.payload.id);
      const patch = item.payload.patch as Partial<A>;
      result = result.map((a) => (a.id === id ? { ...a, ...patch } : a));
    }
  }
  return result;
}

/** Profile settings changed offline, merged in order. */
export function pendingProfilePatch(queue: OutboxItem[], userId: string): Record<string, unknown> {
  let patch: Record<string, unknown> = {};
  for (const item of queue) {
    if (item.type === "profile_patch" && item.payload?.user_id === userId) {
      patch = { ...patch, ...(item.payload.patch as Record<string, unknown>) };
    }
  }
  return patch;
}
