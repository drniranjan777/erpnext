"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { HR, type OrgRow } from "@/lib/hr";
import { inr } from "@/lib/payroll";
import { REQ_TONE, type Requisition } from "@/lib/talent";

export default function RecruitmentPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: [HR, "requisitions", status], queryFn: () => api<Requisition[]>(`${HR}/recruitment/requisitions`, { query: { status: status || undefined } }) });
  async function decide(id: string, approve: boolean) {
    setError(null);
    try {
      await api(`${HR}/recruitment/requisitions/${id}/decide`, { body: { approve } });
      qc.invalidateQueries({ queryKey: [HR, "requisitions"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Recruitment" description="Manpower requisitions are approved before candidates are added. Offers within the requisition's budget need no second approval." actions={can("hr.recruitment.manage") && <Button onClick={() => setRaising(true)}><Plus className="size-4" aria-hidden /> Raise requisition</Button>} />
      <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="pending">Pending</option><option value="approved">Open</option><option value="closed">Closed</option><option value="rejected">Rejected</option></Select>
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Requisition</th><th className="px-4 py-2 font-medium">Where</th><th className="px-4 py-2 text-right font-medium">Openings</th><th className="px-4 py-2 text-right font-medium">Candidates</th><th className="px-4 py-2 text-right font-medium">Budget (CTC)</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><Link className="font-medium text-primary hover:underline" href={`${HR}/recruitment/${r.id}`}>{r.title}</Link><span className="block font-mono text-xs text-muted">{r.number}{r.neededBy && ` · needed by ${formatDate(r.neededBy)}`}</span></td>
                  <td className="px-4 py-2 text-xs">{[r.designation, r.department, r.location].filter(Boolean).join(" · ") || "–"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.hired}/{r.openings}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.candidates}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr(r.maxCtc)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={REQ_TONE[r.status]}>{r.status === "approved" ? "open" : r.status}</Badge>
                    {r.status === "pending" && can("hr.recruitment.approve") && (
                      <span className="ml-2 inline-flex gap-1">
                        <Button size="sm" variant="ghost" aria-label="Approve" onClick={() => decide(r.id, true)}><Check className="size-3.5" aria-hidden /></Button>
                        <Button size="sm" variant="ghost" aria-label="Reject" onClick={() => decide(r.id, false)}><X className="size-3.5" aria-hidden /></Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No requisitions.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {raising && <RaiseDialog onClose={() => setRaising(false)} />}
    </div>
  );
}

function RaiseDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const opt = (kind: string) => ({ queryKey: [HR, "org", kind], queryFn: () => api<OrgRow[]>(`${HR}/org/${kind}`) });
  const depts = useQuery(opt("departments"));
  const desigs = useQuery(opt("designations"));
  const locs = useQuery(opt("locations"));
  const [f, setF] = useState({ title: "", departmentId: "", designationId: "", locationId: "", openings: "1", reason: "new", maxCtc: "", neededBy: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setError(null);
    try {
      await api(`${HR}/recruitment/requisitions`, { body: { ...f, departmentId: f.departmentId || null, designationId: f.designationId || null, locationId: f.locationId || null, openings: Number(f.openings) || 1, maxCtc: f.maxCtc ? Number(f.maxCtc) : null, neededBy: f.neededBy || null, description: f.description || null } });
      await qc.invalidateQueries({ queryKey: [HR, "requisitions"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const sel = (label: string, k: "departmentId" | "designationId" | "locationId", rows: OrgRow[] | undefined) => <Field label={label}>{(p) => <Select {...p} value={f[k]} onChange={set(k)}><option value="">—</option>{rows?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>;
  return (
    <Dialog open onClose={onClose} title="Manpower requisition" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={f.title.trim().length < 2}>Raise</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Position" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={set("title")} />}</Field>
        {sel("Designation", "designationId", desigs.data)}
        {sel("Department", "departmentId", depts.data)}
        {sel("Location", "locationId", locs.data)}
        <Field label="Openings">{(p) => <Input {...p} type="number" min={1} value={f.openings} onChange={set("openings")} />}</Field>
        <Field label="Why">{(p) => <Select {...p} value={f.reason} onChange={set("reason")}><option value="new">New position</option><option value="replacement">Replacement</option></Select>}</Field>
        <Field label="Budget: CTC a year up to (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.maxCtc} onChange={set("maxCtc")} />}</Field>
        <Field label="Needed by">{(p) => <Input {...p} type="date" value={f.neededBy} onChange={set("neededBy")} />}</Field>
        <Field label="Job description" className="sm:col-span-2">{(p) => <Input {...p} value={f.description} onChange={set("description")} />}</Field>
      </div>
    </Dialog>
  );
}
