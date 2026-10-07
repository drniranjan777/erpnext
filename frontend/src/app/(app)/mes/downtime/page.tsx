"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Alert, Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { duration, LOSS_LABEL, STATE_LABEL, type Reason } from "@/lib/mes";

interface Stop { id: string; state: string; startedAt: string; endedAt: string | null; seconds: number; source: string; note: string | null; machineCode: string; machineName: string; reasonId: string | null; reasonName: string | null; loss: string | null }

/** Downtime: every stop long enough to count, to be given a reason. */
export default function DowntimePage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const use = can("mes.shopfloor.use");
  const [days, setDays] = useState("1");
  const [only, setOnly] = useState("unexplained");
  const [error, setError] = useState<string | null>(null);
  const reasons = useQuery({ queryKey: ["/mes/setup"], queryFn: () => api<{ reasons: Reason[] }>("/mes/setup"), select: (d) => d.reasons.filter((r) => r.isActive) });
  const stops = useQuery({
    queryKey: ["/mes/downtime", days, only],
    queryFn: () => api<Stop[]>("/mes/downtime", { query: { from: new Date(Date.now() - Number(days) * 86_400_000).toISOString(), unexplained: only === "unexplained" ? "true" : "false" } }),
    refetchInterval: 30000,
  });
  async function explain(id: string, reasonId: string) {
    setError(null);
    try {
      await api(`/mes/states/${id}/reason`, { body: { reasonId } });
      qc.invalidateQueries({ queryKey: ["/mes/downtime"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const byLoss = new Map<string, Reason[]>();
  for (const r of reasons.data ?? []) byLoss.set(r.loss, [...(byLoss.get(r.loss) ?? []), r]);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Downtime"
        description="Stops longer than each machine's minor-stop limit, and setups. A stop without a reason counts against availability as unexplained; give each one a reason so the losses are right."
        actions={
          <span className="flex gap-2">
            <Select className="h-9 w-36" aria-label="Show" value={only} onChange={(e) => setOnly(e.target.value)}><option value="unexplained">Without a reason</option><option value="all">All stops</option></Select>
            <Select className="h-9 w-32" aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)}><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option></Select>
          </span>
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {stops.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-48 flex-1">
                <p className="font-medium">{s.machineCode} · {s.machineName}</p>
                <p className="text-xs text-muted">{formatDateTime(s.startedAt)} · {duration(s.seconds)}{s.endedAt ? "" : " (still stopped)"} · {STATE_LABEL[s.state] ?? s.state}{s.source === "manual" ? " (set by hand)" : ""}</p>
              </div>
              {s.reasonName && <Badge tone={s.loss === "planned" ? "neutral" : "warning"}>{s.reasonName}</Badge>}
              {use && (
                <Select className="h-8 w-56 text-xs" aria-label="Reason" value={s.reasonId ?? ""} onChange={(e) => e.target.value && explain(s.id, e.target.value)}>
                  <option value="">{s.reasonId ? "Change reason" : "Give a reason…"}</option>
                  {[...byLoss.entries()].map(([loss, rs]) => (
                    <optgroup key={loss} label={LOSS_LABEL[loss] ?? loss}>{rs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>
                  ))}
                </Select>
              )}
            </li>
          ))}
          {stops.data && !stops.data.length && <li className="px-4 py-10 text-center text-muted">{only === "unexplained" ? "Every stop has a reason." : "No stops in this period."}</li>}
        </ul>
      </Card>
    </div>
  );
}
