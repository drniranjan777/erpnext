"use client";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { useOfflineQueue } from "@/lib/offline-queue";

/** Shows scans waiting to be sent from this handheld, and any that the server refused on replay. */
export function OfflineBanner() {
  const q = useOfflineQueue();
  if (!q.count && !q.failed.length) return null;
  return (
    <>
      {q.count > 0 && (
        <Alert tone="warning">
          <span className="flex items-center justify-between gap-3">
            {q.count} scan(s) waiting for the network; they are sent automatically when it is back.
            <Button size="sm" variant="secondary" loading={q.flushing} onClick={q.flush}>Send now</Button>
          </span>
        </Alert>
      )}
      {q.failed.length > 0 && <Alert>Refused when sent: {q.failed.join("; ")}</Alert>}
    </>
  );
}
