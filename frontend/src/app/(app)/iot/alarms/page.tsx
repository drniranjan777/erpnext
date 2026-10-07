"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { fmtValue, SEVERITY_TONE, type Alarm } from "@/lib/iot";

/** Machine alarms: open ones first; an alarm leaves the list once it has cleared and been acknowledged. */
export default function AlarmsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "all">("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const alarms = useQuery({ queryKey: ["/iot/alarms", status], queryFn: () => api<Alarm[]>("/iot/alarms", { query: { status } }), refetchInterval: 10000 });
  async function ack(id: string) {
    setError(null);
    try {
      await api(`/iot/alarms/${id}/ack`, { body: { note: notes[id] || null } });
      qc.invalidateQueries({ queryKey: ["/iot/alarms"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Machine alarms"
        description="Raised when a signal stays beyond its limit for the set time. Acknowledge with what was found; cleared and acknowledged alarms leave this list."
        actions={<Select className="h-9 w-40" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value as "open" | "all")}><option value="open">Needing attention</option><option value="all">All alarms</option></Select>}
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {alarms.data?.map((a) => (
            <li key={a.id} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                {a.clearedAt ? <Badge tone="success">cleared {timeAgo(a.clearedAt)}</Badge> : <Badge tone="danger">active</Badge>}
                <span className="font-medium">{a.machineCode ? `${a.machineCode} ${a.machineName}` : a.signalCode}</span>
                <span className="ml-auto text-xs text-muted">raised {formatDateTime(a.raisedAt)}</span>
              </div>
              <p>{a.message}</p>
              <p className="text-xs text-muted">
                Worst value {fmtValue(a.peakValue, a.unit)} · <Link className="text-primary hover:underline" href={`/iot/signals/${a.signalId}`}>signal history</Link>
                {a.maintenanceOrderId && <> · <Link className="text-primary hover:underline" href={`/maintenance/orders/${a.maintenanceOrderId}`}>maintenance request</Link></>}
              </p>
              {a.ackedAt ? (
                <p className="text-xs text-muted">Acknowledged by {a.ackedBy ?? "–"} {timeAgo(a.ackedAt)}{a.note ? `: ${a.note}` : ""}</p>
              ) : (
                <div className="flex gap-2">
                  <Input className="h-8 flex-1 text-xs" placeholder="What was found (optional)" aria-label="Note" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                  <Button size="sm" onClick={() => ack(a.id)}>Acknowledge</Button>
                </div>
              )}
            </li>
          ))}
          {alarms.data && !alarms.data.length && <li className="px-4 py-10 text-center text-muted">No alarms need attention.</li>}
        </ul>
      </Card>
    </div>
  );
}
