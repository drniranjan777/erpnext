"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { PAY, type Component, type SalaryTemplate, type TemplateLine } from "@/lib/payroll";

type Tab = "components" | "templates" | "settings" | "piece";
interface Settings { companyId: string | null; pfRestrictToCeiling: boolean; pfEstablishmentCode: string | null; esiEmployerCode: string | null; otMultiplier: string; otDivisorDays: number; otHoursPerDay: number }
const CALC: Record<TemplateLine["calc"], string> = { percent_ctc: "% of CTC", percent_basic: "% of basic", fixed: "₹ a month", balance: "Balance of CTC" };

export default function PayrollSetupPage() {
  const { can } = useAuth();
  const manage = can("payroll.setup.manage");
  const [tab, setTab] = useState<Tab>("components");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Payroll setup" description="Salary components, CTC templates, statutory settings and piece rates." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "components", label: "Components" }, { value: "templates", label: "Templates" }, { value: "settings", label: "Settings" }, { value: "piece", label: "Piece rates" }]} />
      {tab === "components" && <Components manage={manage} />}
      {tab === "templates" && <Templates manage={manage} />}
      {tab === "settings" && <SettingsForm manage={manage} />}
      {tab === "piece" && <PieceRates manage={manage} />}
    </div>
  );
}

function useSave(key: unknown[]) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  async function save(path: string, method: "POST" | "PUT", body: unknown) {
    setError(null);
    try {
      await api(path, { method, body });
      await qc.invalidateQueries({ queryKey: key });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      return false;
    }
  }
  return { error, save };
}

function Components({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: [PAY, "components"], queryFn: () => api<Component[]>(`${PAY}/components`) });
  const [editing, setEditing] = useState<Component | "new" | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <>
      {manage && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New component</Button>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data!.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-5 py-2">
              <span className="w-20 font-mono text-xs text-muted">{c.code}</span>
              <span className="font-medium">{c.name}</span>
              <Badge tone={c.kind === "earning" ? "success" : "danger"}>{c.kind}</Badge>
              {c.isPfWage && <Badge>PF wage</Badge>}
              {c.kind === "earning" && !c.isEsiWage && <Badge>not ESI wage</Badge>}
              {c.kind === "earning" && !c.isTaxable && <Badge>not taxable</Badge>}
              <span className="text-xs text-muted">{c.isSystem ? "computed" : c.prorate ? "monthly, by paid days" : "one-off input"}</span>
              {!c.isActive && <Badge>inactive</Badge>}
              {manage && <Button className="ml-auto" size="sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil className="size-3.5" aria-hidden /></Button>}
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-5 py-2 text-xs text-muted">PF, ESI, PT, LWF, TDS and loan recovery are computed by payroll.</p>
      </Card>
      {editing && <ComponentDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ComponentDialog({ row, onClose }: { row: Component | null; onClose: () => void }) {
  const { error, save } = useSave([PAY, "components"]);
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", kind: row?.kind ?? "earning", isPfWage: row?.isPfWage ?? false, isEsiWage: row?.isEsiWage ?? true, isTaxable: row?.isTaxable ?? true, prorate: row?.prorate ?? true, sequence: String(row?.sequence ?? 100), isActive: row?.isActive ?? true });
  const check = (k: "isPfWage" | "isEsiWage" | "isTaxable" | "prorate" | "isActive", label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}</label>;
  return (
    <Dialog open onClose={onClose} title={row ? `Edit ${row.name}` : "New component"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => (await save(row ? `${PAY}/components/${row.id}` : `${PAY}/components`, row ? "PUT" : "POST", { ...f, sequence: Number(f.sequence) })) && onClose()}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} disabled={row?.isSystem} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Kind">{(p) => <Select {...p} disabled={row?.isSystem} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "earning" | "deduction" })}><option value="earning">Earning</option><option value="deduction">Deduction</option></Select>}</Field>
        <Field label="Order on the payslip">{(p) => <Input {...p} type="number" value={f.sequence} onChange={(e) => setF({ ...f, sequence: e.target.value })} />}</Field>
        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
          {check("prorate", "Monthly salary, paid by days (off = one-off input)")}
          {f.kind === "earning" && check("isPfWage", "Part of PF wages")}
          {f.kind === "earning" && check("isEsiWage", "Part of ESI wages")}
          {f.kind === "earning" && check("isTaxable", "Taxable")}
          {check("isActive", "Active")}
        </div>
      </div>
    </Dialog>
  );
}

function Templates({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: [PAY, "templates"], queryFn: () => api<SalaryTemplate[]>(`${PAY}/templates`) });
  const [editing, setEditing] = useState<SalaryTemplate | "new" | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  return (
    <>
      {manage && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New template</Button>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="w-20 font-mono text-xs text-muted">{t.code}</span>
              <span className="font-medium">{t.name}</span>
              <span className="text-xs text-muted">{t.lines.map((l) => `${l.code} ${l.calc === "balance" ? "balance" : `${l.value}${l.calc === "fixed" ? " ₹" : "%"}${l.calc === "percent_basic" ? " of basic" : ""}`}`).join(" · ")}{t.employerPfInCtc ? " · employer PF in CTC" : ""}</span>
              {manage && <Button className="ml-auto" size="sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="size-3.5" aria-hidden /></Button>}
            </li>
          ))}
          {q.data && !q.data.length && <li className="px-5 py-6 text-center text-muted">No templates. A common one: basic 40 % of CTC, HRA 50 % of basic, conveyance ₹1,600, special allowance the balance.</li>}
        </ul>
      </Card>
      {editing && <TemplateDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateDialog({ row, onClose }: { row: SalaryTemplate | null; onClose: () => void }) {
  const { error, save } = useSave([PAY, "templates"]);
  const comps = useQuery({ queryKey: [PAY, "components"], queryFn: () => api<Component[]>(`${PAY}/components`) });
  const [f, setF] = useState({ code: row?.code ?? "", name: row?.name ?? "", employerPfInCtc: row?.employerPfInCtc ?? true, isActive: row?.isActive ?? true });
  const [lines, setLines] = useState<{ code: string; calc: TemplateLine["calc"]; value: string }[]>(row?.lines.map((l) => ({ ...l, value: String(l.value) })) ?? [{ code: "BASIC", calc: "percent_ctc", value: "40" }, { code: "HRA", calc: "percent_basic", value: "50" }, { code: "SPL", calc: "balance", value: "0" }]);
  const earnings = comps.data?.filter((c) => c.kind === "earning" && c.prorate && !c.isSystem) ?? [];
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Dialog open onClose={onClose} title={row ? `Edit ${row.name}` : "New salary template"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => (await save(row ? `${PAY}/templates/${row.id}` : `${PAY}/templates`, row ? "PUT" : "POST", { ...f, lines: lines.map((l) => ({ ...l, value: Number(l.value) || 0 })) })) && onClose()}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <div className="space-y-2 sm:col-span-2">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Select aria-label="Component" className="flex-1" value={l.code} onChange={(e) => set(i, { code: e.target.value })}>{earnings.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
              <Select aria-label="Calculation" className="w-40" value={l.calc} onChange={(e) => set(i, { calc: e.target.value as TemplateLine["calc"] })}>{Object.entries(CALC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              {l.calc !== "balance" && <Input aria-label="Value" className="w-24" inputMode="decimal" value={l.value} onChange={(e) => set(i, { value: e.target.value })} />}
              <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" aria-hidden /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { code: earnings[0]?.code ?? "BASIC", calc: "fixed", value: "0" }])}><Plus className="size-4" aria-hidden /> Add line</Button>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.employerPfInCtc} onChange={(e) => setF({ ...f, employerPfInCtc: e.target.checked })} /> The employer’s PF is part of the CTC</label>
      </div>
    </Dialog>
  );
}

function SettingsForm({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: [PAY, "settings"], queryFn: () => api<Settings>(`${PAY}/settings`) });
  const companies = useQuery({ queryKey: ["/org/companies"], queryFn: () => api<{ id: string; name: string }[]>(`/org/companies`), retry: false });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return <SettingsBody s={q.data!} companies={companies.data ?? []} manage={manage} />;
}

function SettingsBody({ s, companies, manage }: { s: Settings; companies: { id: string; name: string }[]; manage: boolean }) {
  const { error, save } = useSave([PAY, "settings"]);
  const [f, setF] = useState({ companyId: s.companyId ?? "", pfRestrictToCeiling: s.pfRestrictToCeiling, pfEstablishmentCode: s.pfEstablishmentCode ?? "", esiEmployerCode: s.esiEmployerCode ?? "", otMultiplier: String(Number(s.otMultiplier)), otDivisorDays: String(s.otDivisorDays), otHoursPerDay: String(s.otHoursPerDay) });
  const [saved, setSaved] = useState(false);
  return (
    <Card className="space-y-4 px-5 py-4">
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">Saved.</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {companies.length > 0 && <Field label="Post salaries to company">{(p) => <Select {...p} value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}><option value="">The first company</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>}
        <Field label="PF establishment code">{(p) => <Input {...p} value={f.pfEstablishmentCode} onChange={(e) => setF({ ...f, pfEstablishmentCode: e.target.value })} />}</Field>
        <Field label="ESI employer code">{(p) => <Input {...p} value={f.esiEmployerCode} onChange={(e) => setF({ ...f, esiEmployerCode: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pfRestrictToCeiling} onChange={(e) => setF({ ...f, pfRestrictToCeiling: e.target.checked })} /> Restrict PF to wages of ₹15,000</label>
        <Field label="Overtime rate (× ordinary)" hint="Factories Act s.59: 2">{(p) => <Input {...p} inputMode="decimal" value={f.otMultiplier} onChange={(e) => setF({ ...f, otMultiplier: e.target.value })} />}</Field>
        <Field label="Ordinary hourly rate: days a month">{(p) => <Input {...p} type="number" value={f.otDivisorDays} onChange={(e) => setF({ ...f, otDivisorDays: e.target.value })} />}</Field>
        <Field label="… and hours a day">{(p) => <Input {...p} type="number" value={f.otHoursPerDay} onChange={(e) => setF({ ...f, otHoursPerDay: e.target.value })} />}</Field>
      </div>
      {manage && <Button onClick={async () => setSaved(await save(`${PAY}/settings`, "PUT", { ...f, companyId: f.companyId || null, otMultiplier: Number(f.otMultiplier), otDivisorDays: Number(f.otDivisorDays), otHoursPerDay: Number(f.otHoursPerDay) }))}>Save settings</Button>}
    </Card>
  );
}

function PieceRates({ manage }: { manage: boolean }) {
  const { error, save } = useSave([PAY, "piece"]);
  const q = useQuery({ queryKey: [PAY, "piece"], queryFn: () => api<{ id: string; workCenter: string; workCenterCode: string; ratePerUnit: string; effectiveFrom: string }[]>(`${PAY}/piece-rates`) });
  const wcs = useQuery({ queryKey: ["/manufacturing/work-centers"], queryFn: () => api<{ id: string; code: string; name: string }[]>(`/manufacturing/work-centers`), retry: false });
  const [f, setF] = useState({ workCenterId: "", ratePerUnit: "", effectiveFrom: todayIST() });
  return (
    <Card>
      <p className="px-5 py-3 text-sm text-muted">Operators are paid this much per good unit on job cards they complete at the work centre (their login must be linked to their employee record).</p>
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-border border-t border-border text-sm">
        {q.data?.map((r) => <li key={r.id} className="flex gap-3 px-5 py-2"><span className="font-mono text-xs text-muted">{r.workCenterCode}</span><span className="font-medium">{r.workCenter}</span><span className="tabular-nums">₹{Number(r.ratePerUnit)} a unit</span><span className="text-xs text-muted">from {formatDate(r.effectiveFrom)}</span></li>)}
        {q.data && !q.data.length && <li className="px-5 py-4 text-muted">No piece rates.</li>}
      </ul>
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          <Field label="Work centre">{(p) => <Select {...p} value={f.workCenterId} onChange={(e) => setF({ ...f, workCenterId: e.target.value })}><option value="">Choose…</option>{(Array.isArray(wcs.data) ? wcs.data : []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>
          <Field label="₹ a good unit">{(p) => <Input {...p} className="w-28" inputMode="decimal" value={f.ratePerUnit} onChange={(e) => setF({ ...f, ratePerUnit: e.target.value })} />}</Field>
          <Field label="From">{(p) => <Input {...p} type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />}</Field>
          <Button size="sm" disabled={!f.workCenterId || !f.ratePerUnit} onClick={async () => (await save(`${PAY}/piece-rates`, "POST", { ...f, ratePerUnit: Number(f.ratePerUnit) })) && setF({ ...f, ratePerUnit: "" })}><Plus className="size-4" aria-hidden /> Add</Button>
        </div>
      )}
    </Card>
  );
}
