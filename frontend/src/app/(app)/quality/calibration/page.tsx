"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { GaugeDialog } from "@/components/quality/gauge-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { QMS, type Gauge } from "@/lib/qms";

const DUE = { overdue: { label: "Overdue", tone: "danger" }, due_soon: { label: "Due soon", tone: "warning" }, ok: { label: "In date", tone: "success" } } as const;

export default function CalibrationPage() {
  const { can } = useAuth();
  const [due, setDue] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: [QMS, "gauges", due], queryFn: () => api<Gauge[]>(`${QMS}/gauges`, { query: { due: due ? "true" : undefined } }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Calibration" description="Gauges and instruments with their calibration interval and next due date. A failed calibration takes the gauge out of service; gauge R&R studies show whether the measurement system is fit for the tolerance." actions={can("quality.calibration.manage") && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add gauge</Button>} />
      <Checkbox label="Due in the next 15 days or overdue" checked={due} onChange={(e) => setDue(e.target.checked)} />
      {adding && <GaugeDialog onClose={() => setAdding(false)} />}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Gauge</th><th className="px-4 py-2 font-medium">Range · LC</th><th className="px-4 py-2 font-medium">Where</th><th className="px-4 py-2 font-medium">Last calibrated</th><th className="px-4 py-2 font-medium">Next due</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-2"><Link href={`/quality/calibration/${g.id}`} className="font-mono font-medium hover:underline">{g.code}</Link><span className="block text-xs text-muted">{g.name}</span></td>
                  <td className="px-4 py-2">{g.range ?? "–"}{g.leastCount && <span className="text-muted"> · {g.leastCount}</span>}</td>
                  <td className="px-4 py-2">{g.location ?? "–"}</td>
                  <td className="px-4 py-2">{g.lastCalibrated ? formatDate(g.lastCalibrated) : "–"}</td>
                  <td className="px-4 py-2">{g.status !== "in_use" ? <Badge tone="danger">Out of service</Badge> : <>{g.nextDue ? formatDate(g.nextDue) : "Not calibrated"} {g.dueState && <Badge tone={DUE[g.dueState].tone}>{DUE[g.dueState].label}</Badge>}</>}</td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No gauges.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
