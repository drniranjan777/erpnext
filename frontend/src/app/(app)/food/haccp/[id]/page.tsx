"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Signal } from "@/lib/iot";

interface Hazard { id?: string; step: number; type: string; description: string; severity: number; likelihood: number; controls?: string | null; q1?: boolean | null; q2?: boolean | null; q3?: boolean | null; q4?: boolean | null }
interface Ccp { id?: string; hazardId: string; name: string; limitMin?: number | null; limitMax?: number | null; unit?: string | null; monitoring: string; frequency: string; responsibility: string; correctiveAction: string; verification: string; signalId?: string | null }
interface Plan { id: string; code: string; title: string; version: number; status: string; steps: { no: number; name: string }[]; hazards: Hazard[]; ccps: Ccp[]; analysis: (Hazard & { id: string; significant: boolean; ccp: boolean | null; reason: string; hasCcp: boolean })[]; problems: string[]; approval: { meaning: string; signedBy: string; signedAt: string }[] }
interface Monitoring { records: { id: string; ccpId: string; value: number; recordedAt: string; ok: boolean; batchNo: string | null; correctiveAction: string | null; productHeld: boolean; recordedBy: string | null }[]; sensors: { ccpId: string; name: string; readings: number; min: number | null; max: number | null; minutesOutside: number; excursions: number }[] }

const QUESTIONS = ["Q1 Control measures exist?", "Q2 Step designed to eliminate / reduce?", "Q3 Could contamination reach unacceptable levels?", "Q4 Will a later step eliminate / reduce?"] as const;

/** A HACCP plan: steps, hazard analysis, CCPs, approval and monitoring. */
export default function HaccpPlanPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["/food/haccp", id], queryFn: () => api<Plan>(`/food/haccp/${id}`) });
  if (!q.data) return null;
  return <PlanEditor key={q.dataUpdatedAt} plan={q.data} />;
}

function PlanEditor({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("food.haccp.manage");
  const signals = useQuery({ queryKey: ["/iot/signals"], queryFn: () => api<Signal[]>("/iot/signals"), enabled: manage });
  const mon = useQuery({ queryKey: ["/food/haccp", plan.id, "monitoring"], queryFn: () => api<Monitoring>(`/food/haccp/${plan.id}/monitoring`, { query: { days: 7 } }), enabled: plan.status === "approved" });
  const [steps, setSteps] = useState(plan.steps);
  const [hazards, setHazards] = useState<Hazard[]>(plan.hazards);
  const [ccps, setCcps] = useState<Ccp[]>(plan.ccps);
  const [approving, setApproving] = useState(false);
  const [rec, setRec] = useState({ ccpId: "", value: "", batchNo: "", correctiveAction: "", productHeld: false });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["/food/haccp"] });
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const save = () => run(() => api(`/food/haccp/${plan.id}/analysis`, { method: "PUT", body: { steps, hazards, ccps } }), plan.status === "approved" ? "Saved as a new draft version." : "Saved.");
  const setH = (i: number, p: Partial<Hazard>) => setHazards(hazards.map((h, j) => (j === i ? { ...h, ...p } : h)));
  const setC = (i: number, p: Partial<Ccp>) => setCcps(ccps.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const tri = (v: boolean | null | undefined, on: (x: boolean | null) => void, label: string) => (
    <Select className="h-8 w-16 px-1" aria-label={label} value={v === true ? "y" : v === false ? "n" : ""} onChange={(e) => on(e.target.value === "y" ? true : e.target.value === "n" ? false : null)}><option value="">–</option><option value="y">Yes</option><option value="n">No</option></Select>
  );
  const a = (h: Hazard) => plan.analysis.find((x) => x.id === h.id);
  const chosen = plan.ccps.find((c) => c.id === rec.ccpId);
  return (
    <div className="space-y-4">
      <PageHeader title={`${plan.code} · ${plan.title}`} description={`Version ${plan.version} · ${plan.status}${plan.approval.length ? ` · approved by ${plan.approval[plan.approval.length - 1].signedBy}, ${formatDateTime(plan.approval[plan.approval.length - 1].signedAt)}` : ""}`} actions={manage && <span className="flex gap-2"><Button variant="secondary" onClick={save}>Save</Button>{plan.status !== "approved" && <Button disabled={plan.problems.length > 0} onClick={() => setApproving(true)}>Approve</Button>}</span>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {plan.problems.length > 0 && <Alert tone="warning">Before approval: {plan.problems.join("; ")}</Alert>}
      <Card>
        <CardHeader title="Process steps" />
        <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
          {steps.map((s, i) => <span key={i} className="flex items-center gap-1"><span className="text-muted">{s.no}.</span><Input className="h-8 w-40" aria-label={`Step ${s.no}`} value={s.name} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></span>)}
          {manage && <Button size="sm" variant="secondary" onClick={() => setSteps([...steps, { no: (steps.at(-1)?.no ?? 0) + 1, name: "" }])}>Add step</Button>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Hazard analysis" description="Severity and likelihood 1–3; significant hazards go through the Codex decision tree." />
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="bg-surface-muted text-left text-muted"><tr><th className="p-1">Step</th><th className="p-1">Type</th><th className="p-1">Hazard</th><th className="p-1">S</th><th className="p-1">L</th><th className="p-1">Controls</th>{QUESTIONS.map((x) => <th key={x} className="p-1" title={x}>{x.slice(0, 2)}</th>)}<th className="p-1">Decision</th></tr></thead>
            <tbody className="divide-y divide-border">
              {hazards.map((h, i) => {
                const r = a(h);
                return (
                  <tr key={i} className="align-top">
                    <td className="p-1"><Select className="h-8 w-28 px-1" aria-label="Step" value={h.step} onChange={(e) => setH(i, { step: Number(e.target.value) })}>{steps.map((s) => <option key={s.no} value={s.no}>{s.no}. {s.name}</option>)}</Select></td>
                    <td className="p-1"><Select className="h-8 w-28 px-1" aria-label="Type" value={h.type} onChange={(e) => setH(i, { type: e.target.value })}>{["biological", "chemical", "physical", "allergen"].map((t) => <option key={t}>{t}</option>)}</Select></td>
                    <td className="p-1"><Input className="h-8 w-56" aria-label="Hazard" value={h.description} onChange={(e) => setH(i, { description: e.target.value })} /></td>
                    <td className="p-1"><Select className="h-8 w-12 px-1" aria-label="Severity" value={h.severity} onChange={(e) => setH(i, { severity: Number(e.target.value) })}>{[1, 2, 3].map((x) => <option key={x}>{x}</option>)}</Select></td>
                    <td className="p-1"><Select className="h-8 w-12 px-1" aria-label="Likelihood" value={h.likelihood} onChange={(e) => setH(i, { likelihood: Number(e.target.value) })}>{[1, 2, 3].map((x) => <option key={x}>{x}</option>)}</Select></td>
                    <td className="p-1"><Input className="h-8 w-40" aria-label="Controls" value={h.controls ?? ""} onChange={(e) => setH(i, { controls: e.target.value || null })} /></td>
                    <td className="p-1">{tri(h.q1, (x) => setH(i, { q1: x }), QUESTIONS[0])}</td>
                    <td className="p-1">{tri(h.q2, (x) => setH(i, { q2: x }), QUESTIONS[1])}</td>
                    <td className="p-1">{tri(h.q3, (x) => setH(i, { q3: x }), QUESTIONS[2])}</td>
                    <td className="p-1">{tri(h.q4, (x) => setH(i, { q4: x }), QUESTIONS[3])}</td>
                    <td className="p-1">{r ? <span title={r.reason}>{r.ccp ? <Badge tone="danger">CCP</Badge> : r.ccp === false ? <Badge>{r.significant ? "not a CCP" : "PRP"}</Badge> : <Badge tone="warning">open</Badge>}</span> : <span className="text-muted">save to decide</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {manage && <div className="border-t border-border p-3"><Button size="sm" variant="secondary" onClick={() => setHazards([...hazards, { id: crypto.randomUUID(), step: steps[0]?.no ?? 1, type: "biological", description: "", severity: 2, likelihood: 2 }])}>Add hazard</Button></div>}
      </Card>
      <Card>
        <CardHeader title="Critical control points" />
        <div className="space-y-2 border-t border-border p-4 text-sm">
          {ccps.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-4">
              <Select aria-label="Hazard" value={c.hazardId} onChange={(e) => setC(i, { hazardId: e.target.value })}>{hazards.map((h) => <option key={h.id} value={h.id}>Step {h.step}: {h.description}</option>)}</Select>
              <Input aria-label="CCP" placeholder="What is controlled" value={c.name} onChange={(e) => setC(i, { name: e.target.value })} />
              <div className="flex gap-1"><Input type="number" step="any" aria-label="Lower limit" placeholder="Min" value={c.limitMin ?? ""} onChange={(e) => setC(i, { limitMin: e.target.value === "" ? null : Number(e.target.value) })} /><Input type="number" step="any" aria-label="Upper limit" placeholder="Max" value={c.limitMax ?? ""} onChange={(e) => setC(i, { limitMax: e.target.value === "" ? null : Number(e.target.value) })} /><Input aria-label="Unit" placeholder="Unit" value={c.unit ?? ""} onChange={(e) => setC(i, { unit: e.target.value || null })} /></div>
              <Select aria-label="Sensor" value={c.signalId ?? ""} onChange={(e) => setC(i, { signalId: e.target.value || null })}><option value="">No sensor</option>{signals.data?.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</Select>
              <Input aria-label="Monitoring" placeholder="Monitoring" value={c.monitoring} onChange={(e) => setC(i, { monitoring: e.target.value })} />
              <Input aria-label="Frequency" placeholder="Frequency" value={c.frequency} onChange={(e) => setC(i, { frequency: e.target.value })} />
              <Input aria-label="Responsibility" placeholder="Who" value={c.responsibility} onChange={(e) => setC(i, { responsibility: e.target.value })} />
              <Input aria-label="Verification" placeholder="Verification" value={c.verification} onChange={(e) => setC(i, { verification: e.target.value })} />
              <Input className="sm:col-span-4" aria-label="Corrective action" placeholder="Corrective action" value={c.correctiveAction} onChange={(e) => setC(i, { correctiveAction: e.target.value })} />
            </div>
          ))}
          {manage && <Button size="sm" variant="secondary" onClick={() => setCcps([...ccps, { hazardId: plan.analysis.find((h) => h.ccp)?.id ?? hazards[0]?.id ?? "", name: "", monitoring: "", frequency: "", responsibility: "", correctiveAction: "", verification: "" }])}>Add CCP</Button>}
        </div>
      </Card>
      {plan.status === "approved" && (
        <Card>
          <CardHeader title="Monitoring (7 days)" />
          {can("food.ccp.record") && (
            <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
              <Select className="h-9 w-64" aria-label="CCP" value={rec.ccpId} onChange={(e) => setRec({ ...rec, ccpId: e.target.value })}><option value="">CCP…</option>{plan.ccps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              <Input className="h-9 w-28" type="number" step="any" aria-label="Value" placeholder={chosen ? `${chosen.limitMin ?? "–"}–${chosen.limitMax ?? "–"} ${chosen.unit ?? ""}` : "Value"} value={rec.value} onChange={(e) => setRec({ ...rec, value: e.target.value })} />
              <Input className="h-9 w-28" aria-label="Batch" placeholder="Batch" value={rec.batchNo} onChange={(e) => setRec({ ...rec, batchNo: e.target.value })} />
              <Input className="h-9 flex-1" aria-label="Corrective action" placeholder="Corrective action (if outside the limit)" value={rec.correctiveAction} onChange={(e) => setRec({ ...rec, correctiveAction: e.target.value })} />
              <label className="flex items-center gap-1"><input type="checkbox" checked={rec.productHeld} onChange={(e) => setRec({ ...rec, productHeld: e.target.checked })} /> product held</label>
              <Button disabled={!rec.ccpId || rec.value === ""} onClick={() => run(() => api(`/food/haccp/${plan.id}/records`, { body: { ccpId: rec.ccpId, value: Number(rec.value), batchNo: rec.batchNo || null, correctiveAction: rec.correctiveAction || null, productHeld: rec.productHeld } }), "Recorded.").then(() => setRec({ ...rec, value: "", correctiveAction: "", productHeld: false }))}>Record</Button>
            </div>
          )}
          {mon.data?.sensors.map((s) => <p key={s.ccpId} className="border-t border-border px-4 py-2 text-sm">{s.name} (sensor): {s.readings} readings, {s.min ?? "–"} to {s.max ?? "–"}{s.excursions ? <span className="text-danger"> · {s.excursions} excursion(s), {s.minutesOutside} min outside</span> : " · within limits"}</p>)}
          <ul className="divide-y divide-border border-t border-border text-sm">
            {mon.data?.records.map((r) => <li key={r.id} className="flex flex-wrap gap-2 px-4 py-1.5"><Badge tone={r.ok ? "success" : "danger"}>{r.ok ? "ok" : "outside"}</Badge><span>{plan.ccps.find((c) => c.id === r.ccpId)?.name}: {r.value}</span><span className="text-xs text-muted">{formatDateTime(r.recordedAt)} · {r.recordedBy}{r.batchNo ? ` · ${r.batchNo}` : ""}</span>{r.correctiveAction && <span className="text-xs">→ {r.correctiveAction}{r.productHeld ? " (held)" : ""}</span>}</li>)}
          </ul>
        </Card>
      )}
      {approving && <ESignDialog meaning={`HACCP plan version ${plan.version} approved`} reasonRequired={false} reasonLabel="Comment" onClose={() => setApproving(false)} onSign={async (password, reason) => { await api(`/food/haccp/${plan.id}/approve`, { body: { password, reason: reason || null } }); refresh(); }} />}
    </div>
  );
}
