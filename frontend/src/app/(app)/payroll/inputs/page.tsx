"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { inr, PAY, type Component } from "@/lib/payroll";
import { askConfirm } from "@/components/ui/ask";
import { DataTable } from "@/components/ui/data-table";

interface InputRow { id: string; employeeId: string; code: string; amount: string; remarks: string | null; empCode: string; fullName: string; name: string | null; kind: string | null }
interface Loan { id: string; employeeId: string; code: string; fullName: string; kind: string; issuedOn: string; principal: string; emi: string; startMonth: string; recovered: string; outstanding: string; status: string }
type Tab = "inputs" | "loans";

export default function PayrollInputsPage() {
  const { can } = useAuth();
  const manage = can("payroll.salaries.manage");
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("inputs");
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const people = useQuery({ queryKey: ["/hr", "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`/hr/employees/search`) });
  const comps = useQuery({ queryKey: [PAY, "components"], queryFn: () => api<Component[]>(`${PAY}/components`) });
  const inputs = useQuery({ queryKey: [PAY, "inputs", month], queryFn: () => api<InputRow[]>(`${PAY}/inputs`, { query: { month } }), enabled: tab === "inputs" });
  const loans = useQuery({ queryKey: [PAY, "loans"], queryFn: () => api<Loan[]>(`${PAY}/loans`), enabled: tab === "loans" });
  const [fi, setFi] = useState({ employeeId: "", code: "", amount: "", remarks: "" });
  const [fl, setFl] = useState({ employeeId: "", kind: "loan", principal: "", emi: "", startMonth: todayIST().slice(0, 7) });
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [PAY] });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      return false;
    }
  }
  const oneOff = comps.data?.filter((c) => !c.prorate && !c.isSystem && c.isActive) ?? [];
  const person = (k: "fi" | "fl") => (
    <Field label="Employee">{(p) => <Select {...p} value={k === "fi" ? fi.employeeId : fl.employeeId} onChange={(e) => (k === "fi" ? setFi({ ...fi, employeeId: e.target.value }) : setFl({ ...fl, employeeId: e.target.value }))}><option value="">Choose…</option>{people.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Payroll inputs" description="One-off amounts for a month (arrears, bonus, incentive, reimbursement, canteen) and loans or advances recovered in instalments." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "inputs", label: "Monthly inputs" }, { value: "loans", label: "Loans and advances" }]} />
      {error && <Alert>{error}</Alert>}
      {tab === "inputs" && (
        <>
          <Input className="h-9 w-44" type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <Card>
            {inputs.isLoading && <LoadingBlock />}
            {inputs.error && <ErrorBlock error={inputs.error} />}
            <ul className="divide-y divide-border text-sm">
              {inputs.data?.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-2">
                  <span className="font-medium">{i.fullName}</span>
                  <Badge tone={i.kind === "deduction" ? "danger" : "success"}>{i.name ?? i.code}</Badge>
                  <span className="tabular-nums">{inr(i.amount)}</span>
                  <span className="text-xs text-muted">{i.remarks}</span>
                  {manage && <Button className="ml-auto" size="sm" variant="ghost" aria-label="Remove" onClick={() => run(() => api(`${PAY}/inputs/${i.id}`, { method: "DELETE" }))}><Trash2 className="size-3.5" aria-hidden /></Button>}
                </li>
              ))}
              {inputs.data && !inputs.data.length && <li className="px-5 py-6 text-center text-muted">No inputs for this month.</li>}
            </ul>
            {manage && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
                {person("fi")}
                <Field label="What">{(p) => <Select {...p} value={fi.code} onChange={(e) => setFi({ ...fi, code: e.target.value })}><option value="">Choose…</option>{oneOff.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.kind})</option>)}</Select>}</Field>
                <Field label="Amount">{(p) => <Input {...p} className="w-32" inputMode="decimal" value={fi.amount} onChange={(e) => setFi({ ...fi, amount: e.target.value })} />}</Field>
                <Field label="Remarks">{(p) => <Input {...p} value={fi.remarks} onChange={(e) => setFi({ ...fi, remarks: e.target.value })} />}</Field>
                <Button size="sm" disabled={!fi.employeeId || !fi.code || !Number(fi.amount)} onClick={async () => (await run(() => api(`${PAY}/inputs`, { body: { month, employeeId: fi.employeeId, code: fi.code, amount: Number(fi.amount), remarks: fi.remarks || undefined } }))) && setFi({ ...fi, amount: "", remarks: "" })}><Plus className="size-4" aria-hidden /> Add</Button>
              </div>
            )}
          </Card>
        </>
      )}
      {tab === "loans" && (
        <Card>
          {loans.isLoading && <LoadingBlock />}
          <DataTable
            rows={loans.data ?? []}
            rowKey={(l) => String(l.id)}
            exportName="payroll-inputs"
            storageKey="payroll-inputs-0"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No loans or advances.</p>}
            columns={[
              { key: "employee", label: "Employee", locked: true, className: "whitespace-normal", render: (l) => <><span className="font-medium">{l.fullName}</span> <span className="text-xs text-muted">{l.kind}</span></> },
              { key: "given", label: "Given", className: "whitespace-normal", render: (l) => <>{formatDate(l.issuedOn)}<span className="block text-xs text-muted">recovery from {l.startMonth}</span></> },
              { key: "amount", label: "Amount", align: "right", render: (l) => <>{inr(l.principal)}</> },
              { key: "instalment", label: "Instalment", align: "right", render: (l) => <>{inr(l.emi)}</> },
              { key: "outstanding", label: "Outstanding", align: "right", render: (l) => <>{inr(l.outstanding)}</> },
              { key: "status", label: "Status", className: "whitespace-normal", render: (l) => <><Badge tone={l.status === "active" ? "primary" : "neutral"}>{l.status}</Badge></> },
              { key: "col6", label: "", align: "right", noSort: true, render: (l) => <>{manage && l.status === "active" && <Button size="sm" variant="ghost" aria-label="Close loan" onClick={async () => await askConfirm("Stop recovering this loan?") && run(() => api(`${PAY}/loans/${l.id}/close`, { body: {} }))}><X className="size-3.5" aria-hidden /></Button>}</> },
            ]}
          />
          {manage && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
              {person("fl")}
              <Field label="Kind">{(p) => <Select {...p} value={fl.kind} onChange={(e) => setFl({ ...fl, kind: e.target.value })}><option value="loan">Loan</option><option value="advance">Salary advance</option></Select>}</Field>
              <Field label="Amount">{(p) => <Input {...p} className="w-32" inputMode="decimal" value={fl.principal} onChange={(e) => setFl({ ...fl, principal: e.target.value })} />}</Field>
              <Field label="Instalment">{(p) => <Input {...p} className="w-32" inputMode="decimal" value={fl.emi} onChange={(e) => setFl({ ...fl, emi: e.target.value })} />}</Field>
              <Field label="Recover from">{(p) => <Input {...p} type="month" value={fl.startMonth} onChange={(e) => setFl({ ...fl, startMonth: e.target.value })} />}</Field>
              <Button size="sm" disabled={!fl.employeeId || !Number(fl.principal) || !Number(fl.emi)} onClick={async () => (await run(() => api(`${PAY}/loans`, { body: { employeeId: fl.employeeId, kind: fl.kind, issuedOn: todayIST(), principal: Number(fl.principal), emi: Number(fl.emi), startMonth: fl.startMonth } }))) && setFl({ ...fl, principal: "", emi: "" })}><Plus className="size-4" aria-hidden /> Give</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
