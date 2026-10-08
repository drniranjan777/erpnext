"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Permit { id: string; number: string; type: string; location: string; equipment: string | null; description: string; contractor: string | null; workers: number; validFrom: string; validTo: string; status: string; checklist: { key: string; label: string; done: boolean }[]; isolations: { point: string; lockNo: string }[]; gasTests: { at: string; o2Pct: number; lelPct: number; h2sPpm: number; coPpm: number; by: string }[]; approval: { signerName: string; signedAt: string } | null; conflicts: string[]; problems: { approve: string[]; activate: string[] }; closeNote: string | null; testIssues?: string[] }

const LABELS: Record<string, string> = { hot_work: "Hot work", cold_work: "Cold work", confined_space: "Confined space", height: "Work at height", electrical: "Electrical", excavation: "Excavation", line_break: "Line break" };

/** One permit to work. */
export default function PermitPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["/hse/permits", id], queryFn: () => api<Permit>(`/hse/permits/${id}`) });
  if (!q.data) return null;
  return <PermitView key={q.dataUpdatedAt} p={q.data} />;
}

function PermitView({ p }: { p: Permit }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [done, setDone] = useState(p.checklist.filter((c) => c.done).map((c) => c.key));
  const [gas, setGas] = useState({ o2Pct: "20.9", lelPct: "0", h2sPpm: "0", coPpm: "0" });
  const [signing, setSigning] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const open = p.status === "requested" || p.status === "approved";
  async function run(fn: () => Promise<Permit | unknown>, text: string) {
    setMsg(null);
    try {
      const r = (await fn()) as Permit | undefined;
      setMsg(r?.testIssues?.length ? { tone: "warning", text: `Gas test failed: ${r.testIssues.join("; ")}` } : { tone: "success", text });
      qc.invalidateQueries({ queryKey: ["/hse/permits"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const close = (cancel: boolean) => {
    const note = window.prompt(cancel ? "Why is the permit cancelled?" : "Closing note (work done, area cleared)");
    if (note) run(() => api(`/hse/permits/${p.id}/close`, { body: { note, cancel } }), cancel ? "Cancelled." : "Closed.");
  };
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={`${p.number} · ${LABELS[p.type]}`}
        description={`${p.location}${p.equipment ? ` · ${p.equipment}` : ""} · ${formatDateTime(p.validFrom)} → ${formatDateTime(p.validTo)} · ${p.status}`}
        actions={
          can("hse.permits.approve") && (
            <span className="flex gap-2">
              {p.status === "requested" && <Button disabled={p.problems.approve.length > 0 || p.conflicts.length > 0} onClick={() => setSigning(true)}>Approve</Button>}
              {p.status === "approved" && <Button disabled={p.problems.activate.length > 0} onClick={() => run(() => api(`/hse/permits/${p.id}/activate`, { body: {} }), "Work may start.")}>Start work</Button>}
              {p.status === "active" && <Button onClick={() => close(false)}>Close</Button>}
              {["requested", "approved", "active"].includes(p.status) && <Button variant="secondary" onClick={() => close(true)}>Cancel</Button>}
            </span>
          )
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {p.conflicts.length > 0 && <Alert tone="warning">Conflicts with {p.conflicts.join("; ")}</Alert>}
      {p.status === "requested" && p.problems.approve.length > 0 && <Alert tone="warning">Before approval: {p.problems.approve.join("; ")}</Alert>}
      {p.status === "approved" && p.problems.activate.length > 0 && <Alert tone="warning">Before work starts: {p.problems.activate.join("; ")}</Alert>}
      <Card>
        <CardHeader title="Work" description={`${p.workers} worker(s)${p.contractor ? ` · ${p.contractor}` : ""}${p.approval ? ` · approved by ${p.approval.signerName}, ${formatDateTime(p.approval.signedAt)}` : ""}`} />
        <p className="border-t border-border px-4 py-3 text-sm">{p.description}</p>
        {p.isolations.length > 0 && <p className="border-t border-border px-4 py-2 text-sm">Isolations: {p.isolations.map((i) => `${i.point} (lock ${i.lockNo})`).join("; ")}</p>}
        {p.closeNote && <p className="border-t border-border px-4 py-2 text-sm">Closing: {p.closeNote}</p>}
      </Card>
      <Card>
        <CardHeader title="Checklist" />
        <div className="space-y-1 border-t border-border p-4 text-sm">
          {p.checklist.map((c) => (
            <label key={c.key} className="flex items-center gap-2">
              <input type="checkbox" disabled={!open || !can("hse.permits.request")} checked={done.includes(c.key)} onChange={(e) => setDone(e.target.checked ? [...done, c.key] : done.filter((x) => x !== c.key))} />
              {c.label}
            </label>
          ))}
          {open && can("hse.permits.request") && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/hse/permits/${p.id}/checklist`, { body: { done } }), "Checklist saved.")}>Save checklist</Button>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Gas tests" description="Oxygen 19.5–23.5 %, flammables 0 % LEL for hot work (below 10 % otherwise), H2S below 10 ppm, CO below 25 ppm. A failed test on running work stops it." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {p.gasTests.map((t, i) => <li key={i} className="px-4 py-1.5">{formatDateTime(t.at)} · O2 {t.o2Pct} % · LEL {t.lelPct} % · H2S {t.h2sPpm} ppm · CO {t.coPpm} ppm <span className="text-xs text-muted">{t.by}</span></li>)}
        </ul>
        {["requested", "approved", "active"].includes(p.status) && can("hse.permits.request") && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border p-4 text-sm">
            {(["o2Pct", "lelPct", "h2sPpm", "coPpm"] as const).map((k) => <label key={k} className="flex items-center gap-1">{{ o2Pct: "O2 %", lelPct: "LEL %", h2sPpm: "H2S ppm", coPpm: "CO ppm" }[k]}<Input className="h-8 w-20" type="number" step="any" min={0} value={gas[k]} onChange={(e) => setGas({ ...gas, [k]: e.target.value })} /></label>)}
            <Button size="sm" onClick={() => run(() => api(`/hse/permits/${p.id}/gas-tests`, { body: Object.fromEntries(Object.entries(gas).map(([k, v]) => [k, Number(v)])) }), "Gas test recorded.")}>Record test</Button>
          </div>
        )}
      </Card>
      <p className="text-xs"><Badge tone={p.status === "active" ? "danger" : "neutral"}>{p.status}</Badge></p>
      {signing && <ESignDialog meaning={`Permit to work ${p.number} approved`} reasonRequired={false} reasonLabel="Comment" onClose={() => setSigning(false)} onSign={async (password, reason) => { await api(`/hse/permits/${p.id}/approve`, { body: { password, reason: reason || null } }); qc.invalidateQueries({ queryKey: ["/hse/permits"] }); }} />}
    </div>
  );
}
