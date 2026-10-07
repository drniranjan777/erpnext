"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id: string; workOrderId: string; workOrderNumber: string; itemName: string; machineCode: string | null; area: string | null; previousItem: string | null; previousBatch: string | null; checklist: { item: string; ok: boolean; note: string | null }[]; status: string; createdAt: string; clearedAt: string | null; productionBy: string | null; productionAt: string | null; qaBy: string | null; qaAt: string | null; qaReason: string | null }
interface WorkOrder { id: string; number: string | null; item: { name: string }; stage: string }
interface Machine { id: string; code: string; name: string }

const TONE: Record<string, "warning" | "success" | "danger"> = { pending: "warning", cleared: "success", failed: "danger" };

/** Line clearance: production ticks the checklist and signs; a second person in QA verifies and signs. */
export default function LineClearancePage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const sign = can("gmp.lineclearance.sign");
  const list = useQuery({ queryKey: ["/gmp/line-clearances"], queryFn: () => api<Row[]>("/gmp/line-clearances") });
  const settings = useQuery({ queryKey: ["/gmp/settings"], queryFn: () => api<{ lineClearanceChecklist: string[] }>("/gmp/settings") });
  const wos = useQuery({ queryKey: ["/manufacturing/work-orders", "open"], queryFn: () => api<{ items: WorkOrder[] }>("/manufacturing/work-orders", { query: { limit: 100 } }), enabled: sign });
  const machines = useQuery({ queryKey: ["/manufacturing/machines"], queryFn: () => api<Machine[]>("/manufacturing/machines"), enabled: sign });
  const [form, setForm] = useState<{ workOrderId: string; machineId: string; area: string; previousBatch: string; ticks: boolean[] } | null>(null);
  const [verify, setVerify] = useState<{ row: Row; approved: boolean } | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ["/gmp/line-clearances"] });
  const checklist = settings.data?.lineClearanceChecklist ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Line clearance" description="Before a batch starts: the line is free of the previous product, its documents and labels. Production signs the checklist; QA verifies it with a second signature." actions={sign && <Button onClick={() => setForm({ workOrderId: "", machineId: "", area: "", previousBatch: "", ticks: checklist.map(() => false) })}><Plus className="size-4" aria-hidden /> New clearance</Button>} />
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.id} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[r.status]}>{r.status}</Badge>
                <span className="font-medium">{r.workOrderNumber} · {r.itemName}</span>
                <span className="text-muted">{r.machineCode ?? ""} {r.area ?? ""}</span>
                {r.status === "pending" && sign && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" onClick={() => setVerify({ row: r, approved: true })}>Verify</Button>
                    <Button size="sm" variant="ghost" onClick={() => setVerify({ row: r, approved: false })}>Fail</Button>
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">Done by {r.productionBy} {formatDateTime(r.productionAt)}{r.qaBy ? ` · ${r.status === "cleared" ? "verified" : "failed"} by ${r.qaBy} ${formatDateTime(r.qaAt)}${r.qaReason ? `: ${r.qaReason}` : ""}` : ""}{r.previousBatch ? ` · previous batch ${r.previousBatch}` : ""}</p>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">No line clearances yet.</li>}
        </ul>
      </Card>
      {form && (
        <ESignDialog meaning="Line clearance done" onClose={() => setForm(null)} onSign={async (password) => { await api("/gmp/line-clearances", { body: { workOrderId: form.workOrderId, machineId: form.machineId || null, area: form.area || null, previousBatch: form.previousBatch || null, checklist: checklist.map((item, i) => ({ item, ok: form.ticks[i] })), password } }); done(); }}>
          <Field label="Work order" required>{(p) => <Select {...p} value={form.workOrderId} onChange={(e) => setForm({ ...form, workOrderId: e.target.value })}><option value="">Choose…</option>{wos.data?.items.filter((w) => ["released", "in_progress"].includes(w.stage)).map((w) => <option key={w.id} value={w.id}>{w.number} · {w.item.name}</option>)}</Select>}</Field>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Machine">{(p) => <Select {...p} value={form.machineId} onChange={(e) => setForm({ ...form, machineId: e.target.value })}><option value="">—</option>{machines.data?.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}</Select>}</Field>
            <Field label="Area">{(p) => <Input {...p} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />}</Field>
            <Field label="Previous batch">{(p) => <Input {...p} value={form.previousBatch} onChange={(e) => setForm({ ...form, previousBatch: e.target.value })} />}</Field>
          </div>
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">Checklist</legend>
            {checklist.map((c, i) => <label key={c} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={form.ticks[i]} onChange={(e) => setForm({ ...form, ticks: form.ticks.map((t, j) => (j === i ? e.target.checked : t)) })} /> {c}</label>)}
          </fieldset>
        </ESignDialog>
      )}
      {verify && <ESignDialog meaning={verify.approved ? "Line clearance verified (QA)" : "Line clearance failed (QA)"} reasonRequired={!verify.approved} reasonLabel={verify.approved ? "Comment" : "Why it failed"} onClose={() => setVerify(null)} onSign={async (password, reason) => { await api(`/gmp/line-clearances/${verify.row.id}/verify`, { body: { approved: verify.approved, reason: reason || null, password } }); done(); }} />}
    </div>
  );
}
