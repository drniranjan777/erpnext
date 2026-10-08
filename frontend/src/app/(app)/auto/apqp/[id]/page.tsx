"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader, formatDateTime, ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";

interface Project { id: string; code: string; name: string; sopDate: string | null; customerPartNo: string | null; program: string | null; status: string; deliverables: { code: string; phase: number; name: string; status: string; owner: string | null; due: string | null }[]; gates: Record<string, string>; progress: { phase: number; name: string; total: number; done: number; pct: number; ready: boolean }[]; gateSignatures: { id: string; meaning: string; signedBy: string; signedAt: string }[]; ppaps: { id: string; code: string; level: number; status: string }[] }

const TONE: Record<string, "neutral" | "warning" | "success"> = { open: "neutral", in_progress: "warning", done: "success", na: "neutral" };

/** One APQP project: deliverables by phase and signed gates. */
export default function ApqpProjectPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("auto.apqp.manage");
  const q = useQuery({ queryKey: ["/auto/apqp", id], queryFn: () => api<Project>(`/auto/apqp/${id}`) });
  const [gate, setGate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = q.data;
  if (!p) return q.isError ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  async function set(code: string, status: string) {
    setError(null);
    try {
      await api(`/auto/apqp/${id}/deliverables`, { body: { code, status } });
      qc.invalidateQueries({ queryKey: ["/auto/apqp"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title={`${p.code} · ${p.name}`} description={`${p.program ? `${p.program} · ` : ""}${p.customerPartNo ? `part ${p.customerPartNo} · ` : ""}SOP ${p.sopDate ? formatDate(p.sopDate) : "–"} · ${p.status}`} />
      {error && <Alert>{error}</Alert>}
      {p.progress.map((ph) => {
        const passed = !!p.gates[String(ph.phase)];
        const sig = p.gateSignatures.find((s) => s.meaning === `APQP phase ${ph.phase} gate passed`);
        return (
          <Card key={ph.phase}>
            <CardHeader
              title={`Phase ${ph.phase}: ${ph.name}`}
              description={passed && sig ? `Gate passed — ${sig.signedBy}, ${formatDateTime(sig.signedAt)}` : `${ph.done} of ${ph.total} done`}
              action={passed ? <Badge tone="success">gate passed</Badge> : manage && <Button size="sm" disabled={!ph.ready || (ph.phase > 1 && !p.gates[String(ph.phase - 1)])} onClick={() => setGate(ph.phase)}>Pass the gate</Button>}
            />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {p.deliverables.filter((d) => d.phase === ph.phase).map((d) => (
                <li key={d.code} className="flex flex-wrap items-center gap-3 px-4 py-1.5">
                  <span className="w-14 font-mono text-xs">{d.code}</span>
                  <span className="flex-1">{d.name}{d.owner ? <span className="text-xs text-muted"> · {d.owner}</span> : null}</span>
                  {manage && !passed ? (
                    <Select className="h-8 w-36" aria-label="Status" value={d.status} onChange={(e) => set(d.code, e.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="na">Not applicable</option></Select>
                  ) : (
                    <Badge tone={TONE[d.status]}>{d.status.replace("_", " ")}</Badge>
                  )}
                </li>
              ))}
            </ul>
            {ph.phase === 4 && p.ppaps.length > 0 && <p className="border-t border-border px-4 py-2 text-sm">PPAP: {p.ppaps.map((x) => <Link key={x.id} className="mr-3 text-primary hover:underline" href={`/auto/ppap/${x.id}`}>{x.code} (level {x.level}, {x.status})</Link>)}</p>}
          </Card>
        );
      })}
      {gate && <ESignDialog meaning={`APQP phase ${gate} gate passed`} reasonRequired={false} reasonLabel="Comment" onClose={() => setGate(null)} onSign={async (password, reason) => { await api(`/auto/apqp/${id}/gates`, { body: { phase: gate, password, reason: reason || null } }); qc.invalidateQueries({ queryKey: ["/auto/apqp"] }); }} />}
    </div>
  );
}
