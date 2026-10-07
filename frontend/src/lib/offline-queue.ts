"use client";

/**
 * Offline queue for handhelds: a scan that cannot reach the server is kept in this browser and
 * sent again when the connection is back. Moves carry a client reference so a replay is applied
 * once; a confirmation that was already done comes back 409 and is dropped.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

const KEY = "wms_offline_queue";

interface Queued {
  path: string;
  body: unknown;
  at: string;
  label: string;
}

function read(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Queued[];
  } catch {
    return [];
  }
}

function write(q: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // Storage blocked or full: the scan is lost and the user is told to retry.
  }
  window.dispatchEvent(new Event("wms-queue"));
}

/** Sends now, or keeps it for later when the network is down. Server-side refusals are thrown as usual. */
export async function sendOrQueue<T>(path: string, body: unknown, label: string): Promise<{ queued: true } | { queued: false; result: T }> {
  try {
    return { queued: false, result: await api<T>(path, { body }) };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    write([...read(), { path, body, at: new Date().toISOString(), label }]);
    return { queued: true };
  }
}

/** A fresh reference for a scan, so the server can tell a replay from a new move. */
export function clientRef() {
  try {
    return `hh-${crypto.randomUUID()}`;
  } catch {
    return `hh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useOfflineQueue() {
  const [items, setItems] = useState<Queued[]>([]);
  const [flushing, setFlushing] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const flush = useCallback(async () => {
    const queue = read();
    if (!queue.length || flushing) return;
    setFlushing(true);
    const left: Queued[] = [];
    const errors: string[] = [];
    for (const q of queue) {
      try {
        await api(q.path, { body: q.body });
      } catch (err) {
        if (err instanceof ApiError) {
          // Already applied (409) is fine; anything else is reported and dropped so the queue does not jam.
          if (err.status !== 409) errors.push(`${q.label}: ${err.message}`);
        } else left.push(q);
      }
    }
    write(left);
    setFailed(errors);
    setFlushing(false);
  }, [flushing]);
  useEffect(() => {
    const sync = () => setItems(read());
    sync();
    window.addEventListener("wms-queue", sync);
    window.addEventListener("online", flush);
    return () => {
      window.removeEventListener("wms-queue", sync);
      window.removeEventListener("online", flush);
    };
  }, [flush]);
  return { count: items.length, flushing, failed, flush };
}
