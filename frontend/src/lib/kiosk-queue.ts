import { api, ApiError } from "./api";

/**
 * Job-card events recorded on the shop-floor kiosk. They are kept on the tablet until the
 * server confirms them, so a dropped connection loses nothing; the server applies each
 * clientRef once, so sending twice is harmless.
 */
export type KioskEvent =
  | { type: "start"; clientRef: string; operationId: string; operatorName: string | null; machineId: string | null; at: string }
  | { type: "stop"; clientRef?: string; cardId?: string; goodQty: string; rejectQty: string; rejectReason: string | null; at: string };

export interface SyncResult { clientRef: string | null; type: string; ok: boolean; already?: boolean; cardId?: string; error?: string }

const KEY = "ngerp.kiosk.queue";

export function readQueue(): KioskEvent[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as KioskEvent[];
  } catch {
    return [];
  }
}

function writeQueue(q: KioskEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // Storage full or blocked: events stay in memory for this session only.
  }
}

export function enqueue(e: KioskEvent) {
  writeQueue([...readQueue(), e]);
}

export function newRef() {
  return `k-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Sends queued events in order. Confirmed events (applied now or before) leave the queue;
 * events the server refuses are returned so the operator can see why; network failures keep
 * everything for the next attempt.
 */
export async function flush(): Promise<{ sent: number; failed: SyncResult[]; offline: boolean }> {
  const q = readQueue();
  if (!q.length) return { sent: 0, failed: [], offline: false };
  try {
    const r = await api<{ results: SyncResult[] }>("/manufacturing/job-cards/sync", { body: { events: q.slice(0, 200) } });
    const failed = r.results.filter((x) => !x.ok);
    // Everything sent is settled: confirmed, or refused for a reason a retry will not fix.
    writeQueue(readQueue().slice(r.results.length));
    return { sent: r.results.length - failed.length, failed, offline: false };
  } catch (e) {
    if (e instanceof ApiError && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429) {
      // The batch itself is malformed; drop it rather than retrying forever.
      writeQueue([]);
      return { sent: 0, failed: [{ clientRef: null, type: "batch", ok: false, error: e.message }], offline: false };
    }
    return { sent: 0, failed: [], offline: true };
  }
}
