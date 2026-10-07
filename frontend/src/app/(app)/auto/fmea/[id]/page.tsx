"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id?: string; step: string; failureMode: string; effect: string; severity: number; special?: string | null; cause: string; prevention?: string | null; occurrence: number; detectionControl?: string | null; detection: number; action?: string | null; owner?: string | null; newSeverity?: number | null; newOccurrence?: number | null; newDetection?: number | null; ap?: string; newAp?: string | null }
interface Fmea { id: string; code: string; kind: "design" | "process"; title: string; itemId: string | null; team: string | null; revision: number; rows: Row[] }

const AP: Record<string, "danger" | "warning" | "neutral"> = { H: "danger", M: "warning", L: "neutral" };
const blankRow = (): Row => ({ step: "", failureMode: "", effect: "", severity: 5, cause: "", occurrence: 5, detection: 5 });

/** FMEA editor: one row per failure mode and cause, with action priority. */
export default function FmeaEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const q = useQuery({ queryKey: ["/auto/fmeas", id], queryFn: () => api<Fmea>(`/auto/fmeas/${id}`), enabled: !isNew });
  if (!isNew && !q.data) return null;
  return <Editor key={q.dataUpdatedAt} initial={q.data ?? { id: "", code: "", kind: "process", title: "", itemId: null, team: null, revision: 0, rows: [blankRow()] }} isNew={isNew} />;
}

function Editor({ initial, isNew }: { initial: Fmea; isNew: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useAuth();
  const manage = can("auto.apqp.manage");
  const [f, setF] = useState(initial);
  const [itemLabel, setItemLabel] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const setRow = (i: number, p: Partial<Row>) => setF({ ...f, rows: f.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  async function save() {
    setMsg(null);
    try {
      const body = { code: f.code, kind: f.kind, title: f.title, itemId: f.itemId, team: f.team, rows: f.rows.map(({ ap: _a, newAp: _n, ...r }) => r) };
      const r = await api<Fmea>(isNew ? "/auto/fmeas" : `/auto/fmeas/${f.id}`, { method: isNew ? "POST" : "PUT", body });
      qc.invalidateQueries({ queryKey: ["/auto/fmeas"] });
      if (isNew) router.replace(`/auto/fmea/${r.id}`);
      else setMsg({ tone: "success", text: `Saved as revision ${r.revision}.` });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  async function draftPlan() {
    setMsg(null);
    try {
      const d = await api<{ fmea: { itemId: string | null }; rows: unknown[] }>(`/auto/fmeas/${f.id}/control-plan-draft`);
      if (!d.fmea.itemId) {
        setMsg({ tone: "danger", text: "Link the FMEA to a part first" });
        return;
      }
      await api("/auto/control-plans", { body: { code: `CP-${f.code}`, itemId: d.fmea.itemId, fmeaId: f.id, phase: "pre_launch", rows: (d.rows as Record<string, unknown>[]).map((r) => ({ ...r, specification: "", sampleSize: "", frequency: "" })) } });
      setMsg({ tone: "success", text: `Control plan CP-${f.code} drafted with ${d.rows.length} characteristic(s); complete the specification, sample size and frequency.` });
      qc.invalidateQueries({ queryKey: ["/auto/control-plans"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const n = (v: string) => (v === "" ? null : Number(v));
  const rating = (v: number | null | undefined, on: (x: number | null) => void, label: string, optional = false) => (
    <Select className="h-8 w-14 px-1" aria-label={label} disabled={!manage} value={v ?? ""} onChange={(e) => on(n(e.target.value))}>{optional && <option value="">–</option>}{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => <option key={x} value={x}>{x}</option>)}</Select>
  );
  return (
    <div className="space-y-4">
      <PageHeader title={isNew ? "New FMEA" : `${f.code} · rev ${f.revision}`} actions={manage && <span className="flex gap-2">{!isNew && f.kind === "process" && <Button variant="secondary" onClick={draftPlan}>Draft control plan</Button>}<Button onClick={save}>Save</Button></span>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card className="grid gap-2 p-4 text-sm sm:grid-cols-4">
        <Input aria-label="Code" placeholder="Code" disabled={!isNew} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        <Select aria-label="Kind" value={f.kind} disabled={!isNew} onChange={(e) => setF({ ...f, kind: e.target.value as Fmea["kind"] })}><option value="process">Process FMEA</option><option value="design">Design FMEA</option></Select>
        <Input className="sm:col-span-2" aria-label="Title" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="sm:col-span-2">{f.itemId ? <p className="flex h-9 items-center text-muted">{itemLabel || "Part linked"}</p> : <ItemPicker placeholder="Part" onPick={(i) => { setF({ ...f, itemId: i.id }); setItemLabel(`${i.code} · ${i.name}`); }} />}</div>
        <Input className="sm:col-span-2" aria-label="Team" placeholder="Team" value={f.team ?? ""} onChange={(e) => setF({ ...f, team: e.target.value || null })} />
      </Card>
      <Card>
        <CardHeader title="Failure modes" description="S severity, O occurrence, D detection (1–10). AP: action priority before and after the actions." />
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[1200px] text-xs">
            <thead className="bg-surface-muted text-left text-muted"><tr>{[f.kind === "process" ? "Step" : "Function", "Failure mode", "Effect", "S", "Cl.", "Cause", "Prevention", "O", "Detection", "D", "AP", "Action", "Owner", "S′", "O′", "D′", "AP′", ""].map((h) => <th key={h} className="px-1 py-1 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {f.rows.map((r, i) => (
                <tr key={i} className="align-top">
                  <td className="p-1"><Input className="h-8 w-32" aria-label="Step" value={r.step} onChange={(e) => setRow(i, { step: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8 w-36" aria-label="Failure mode" value={r.failureMode} onChange={(e) => setRow(i, { failureMode: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8 w-36" aria-label="Effect" value={r.effect} onChange={(e) => setRow(i, { effect: e.target.value })} /></td>
                  <td className="p-1">{rating(r.severity, (x) => setRow(i, { severity: x ?? 1 }), "Severity")}</td>
                  <td className="p-1"><Select className="h-8 w-16 px-1" aria-label="Special characteristic" value={r.special ?? ""} onChange={(e) => setRow(i, { special: e.target.value || null })}><option value="">–</option><option value="CC">CC</option><option value="SC">SC</option></Select></td>
                  <td className="p-1"><Input className="h-8 w-36" aria-label="Cause" value={r.cause} onChange={(e) => setRow(i, { cause: e.target.value })} /></td>
                  <td className="p-1"><Input className="h-8 w-32" aria-label="Prevention" value={r.prevention ?? ""} onChange={(e) => setRow(i, { prevention: e.target.value || null })} /></td>
                  <td className="p-1">{rating(r.occurrence, (x) => setRow(i, { occurrence: x ?? 1 }), "Occurrence")}</td>
                  <td className="p-1"><Input className="h-8 w-32" aria-label="Detection control" value={r.detectionControl ?? ""} onChange={(e) => setRow(i, { detectionControl: e.target.value || null })} /></td>
                  <td className="p-1">{rating(r.detection, (x) => setRow(i, { detection: x ?? 1 }), "Detection")}</td>
                  <td className="p-1">{r.ap && <Badge tone={AP[r.ap]}>{r.ap}</Badge>}</td>
                  <td className="p-1"><Input className="h-8 w-36" aria-label="Action" value={r.action ?? ""} onChange={(e) => setRow(i, { action: e.target.value || null })} /></td>
                  <td className="p-1"><Input className="h-8 w-20" aria-label="Owner" value={r.owner ?? ""} onChange={(e) => setRow(i, { owner: e.target.value || null })} /></td>
                  <td className="p-1">{rating(r.newSeverity, (x) => setRow(i, { newSeverity: x }), "New severity", true)}</td>
                  <td className="p-1">{rating(r.newOccurrence, (x) => setRow(i, { newOccurrence: x }), "New occurrence", true)}</td>
                  <td className="p-1">{rating(r.newDetection, (x) => setRow(i, { newDetection: x }), "New detection", true)}</td>
                  <td className="p-1">{r.newAp && <Badge tone={AP[r.newAp]}>{r.newAp}</Badge>}</td>
                  <td className="p-1">{manage && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, rows: f.rows.filter((_, j) => j !== i) })}>×</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {manage && <div className="border-t border-border p-3"><Button size="sm" variant="secondary" onClick={() => setF({ ...f, rows: [...f.rows, blankRow()] })}>Add row</Button></div>}
      </Card>
    </div>
  );
}
