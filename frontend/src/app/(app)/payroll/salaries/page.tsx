"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { inr, PAY, type Component, type SalaryTemplate } from "@/lib/payroll";
import { DataTable } from "@/components/ui/data-table";

interface Row { employeeId: string; code: string; fullName: string; id: string | null; effectiveFrom: string | null; ctcAnnual: string | null; lines: { code: string; monthly: string }[] | null; monthlyGross: string }

export default function SalariesPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Row | null>(null);
  const q = useQuery({ queryKey: [PAY, "salaries"], queryFn: () => api<Row[]>(`${PAY}/salaries`) });
  const comps = useQuery({ queryKey: [PAY, "components"], queryFn: () => api<Component[]>(`${PAY}/components`) });
  const name = (code: string) => comps.data?.find((c) => c.code === code)?.name ?? code;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Salaries" description="Current salary of every employee. A revision takes effect from its date; pay any difference for months already approved as arrears." />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            rows={q.data}
            rowKey={(r) => String(r.employeeId)}
            exportName="payroll-salaries"
            storageKey="payroll-salaries-0"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No employees.</p>}
            columns={[
              { key: "employee", label: "Employee", locked: true, className: "whitespace-normal", render: (r) => <><span className="font-medium">{r.fullName}</span> <span className="font-mono text-xs text-muted">{r.code}</span></> },
              { key: "from", label: "From", className: "whitespace-normal", render: (r) => <>{r.effectiveFrom ? formatDate(r.effectiveFrom) : <span className="text-warning">Not set</span>}</> },
              { key: "components-monthly", label: "Components (monthly)", className: "text-xs text-muted whitespace-normal", render: (r) => <>{r.lines?.map((l) => `${name(l.code)} ${inr(l.monthly)}`).join(" · ")}</> },
              { key: "monthly-gross", label: "Monthly gross", align: "right", render: (r) => <>{r.lines ? inr(r.monthlyGross) : "–"}</> },
              { key: "ctc-a-year", label: "CTC a year", align: "right", render: (r) => <>{inr(r.ctcAnnual)}</> },
              { key: "col5", label: "", align: "right", noSort: true, render: (r) => <>{can("payroll.salaries.manage") && <Button size="sm" variant="ghost" aria-label={`Set salary of ${r.fullName}`} onClick={() => setEditing(r)}><Pencil className="size-3.5" aria-hidden /></Button>}</> },
            ]}
          />
        </Card>
      )}
      {editing && <SalaryDialog row={editing} comps={comps.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SalaryDialog({ row, comps, onClose }: { row: Row; comps: Component[]; onClose: () => void }) {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: [PAY, "templates"], queryFn: () => api<SalaryTemplate[]>(`${PAY}/templates`) });
  const earnings = comps.filter((c) => c.kind === "earning" && c.prorate && !c.isSystem && c.isActive);
  const [mode, setMode] = useState<"template" | "manual">("template");
  const [f, setF] = useState({ effectiveFrom: todayIST(), templateId: "", ctcAnnual: row.ctcAnnual ? String(Number(row.ctcAnnual)) : "", remarks: "" });
  const [lines, setLines] = useState<{ code: string; monthly: string }[]>(row.lines?.map((l) => ({ code: l.code, monthly: String(Number(l.monthly)) })) ?? [{ code: "BASIC", monthly: "" }]);
  const [preview, setPreview] = useState<{ lines: { code: string; monthly: string }[]; employerPf: number; monthlyCtc: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function doPreview() {
    setError(null);
    try {
      setPreview(await api(`${PAY}/templates/${f.templateId}/preview`, { query: { ctc: Number(f.ctcAnnual) } }));
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  async function save() {
    setError(null);
    const body = mode === "template" ? { employeeId: row.employeeId, effectiveFrom: f.effectiveFrom, templateId: f.templateId, ctcAnnual: Number(f.ctcAnnual), remarks: f.remarks || undefined } : { employeeId: row.employeeId, effectiveFrom: f.effectiveFrom, lines: lines.filter((l) => l.code && Number(l.monthly) > 0).map((l) => ({ code: l.code, monthly: Number(l.monthly) })), remarks: f.remarks || undefined };
    try {
      await api(`${PAY}/salaries`, { body });
      await qc.invalidateQueries({ queryKey: [PAY, "salaries"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Salary: ${row.fullName}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Effective from">{(p) => <Input {...p} type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />}</Field>
        <Field label="How">{(p) => <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as "template" | "manual")}><option value="template">From CTC and a template</option><option value="manual">Enter monthly amounts</option></Select>}</Field>
        {mode === "template" ? (
          <>
            <Field label="Template">{(p) => <Select {...p} value={f.templateId} onChange={(e) => { setF({ ...f, templateId: e.target.value }); setPreview(null); }}><option value="">Choose…</option>{templates.data?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
            <Field label="CTC a year (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.ctcAnnual} onChange={(e) => { setF({ ...f, ctcAnnual: e.target.value }); setPreview(null); }} />}</Field>
            <div className="sm:col-span-2">
              <Button size="sm" variant="secondary" disabled={!f.templateId || !Number(f.ctcAnnual)} onClick={doPreview}>Show the split</Button>
              {preview && (
                <ul className="mt-2 space-y-1 rounded border border-border p-3 text-sm">
                  {preview.lines.map((l) => <li key={l.code} className="flex justify-between"><span>{comps.find((c) => c.code === l.code)?.name ?? l.code}</span><span className="tabular-nums">{inr(l.monthly)}</span></li>)}
                  {preview.employerPf > 0 && <li className="flex justify-between text-muted"><span>Employer PF (in CTC)</span><span className="tabular-nums">{inr(preview.employerPf)}</span></li>}
                  <li className="flex justify-between border-t border-border pt-1 font-medium"><span>Monthly CTC</span><span className="tabular-nums">{inr(preview.monthlyCtc)}</span></li>
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2 sm:col-span-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Select aria-label="Component" className="flex-1" value={l.code} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}><option value="">Choose…</option>{earnings.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
                <Input aria-label="Monthly amount" className="w-36" inputMode="decimal" value={l.monthly} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, monthly: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" aria-hidden /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { code: "", monthly: "" }])}><Plus className="size-4" aria-hidden /> Add component</Button>
            <p className="text-sm">Monthly gross <span className="font-medium tabular-nums">{inr(lines.reduce((s, l) => s + (Number(l.monthly) || 0), 0))}</span></p>
          </div>
        )}
        <Field label="Remarks" className="sm:col-span-2">{(p) => <Input {...p} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
