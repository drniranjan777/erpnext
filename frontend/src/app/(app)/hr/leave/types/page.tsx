"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarX, Pencil, Plus, SlidersHorizontal } from "lucide-react";
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
import { todayIST } from "@/lib/documents";
import { HR, type LeaveBalance, type LeaveType } from "@/lib/hr";

const ACCRUAL: Record<string, string> = { none: "Not accrued", monthly: "Monthly (a twelfth)", yearly: "Yearly in January", per_days_worked: "One day per N days worked" };
type Tab = "types" | "balances";

export default function LeaveTypesPage() {
  const { can } = useAuth();
  const manage = can("hr.leave.manage");
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("types");
  const [editing, setEditing] = useState<LeaveType | "new" | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const [year, setYear] = useState(() => Number(todayIST().slice(0, 4)));
  const types = useQuery({ queryKey: [HR, "leave", "types"], queryFn: () => api<LeaveType[]>(`${HR}/leave/types`) });
  const balances = useQuery({ queryKey: [HR, "leave", "balances", "all", year], queryFn: () => api<LeaveBalance[]>(`${HR}/leave/balances`, { query: { all: "true", year } }), enabled: tab === "balances" });

  async function run(path: string, body: unknown, done: (r: Record<string, number>) => string) {
    setMsg(null);
    try {
      const r = await api<Record<string, number>>(path, { body });
      setMsg({ tone: "success", text: done(r) });
      qc.invalidateQueries({ queryKey: [HR, "leave"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const typeCodes = [...new Set(balances.data?.map((b) => b.typeCode))];
  const byEmp = new Map<string, { code: string; fullName: string; rows: Record<string, LeaveBalance> }>();
  for (const b of balances.data ?? []) {
    const e = byEmp.get(b.employeeId) ?? { code: b.code, fullName: b.fullName, rows: {} };
    e.rows[b.typeCode] = b;
    byEmp.set(b.employeeId, e);
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Leave setup" description="Leave types, monthly accrual, opening balances and year-end carry forward, encashment and lapse." actions={manage && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New leave type</Button>} />
      {manage && (
        <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
          <Field label="Accrue for month">{(p) => <Input {...p} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>
          <Button variant="secondary" onClick={() => run(`${HR}/leave/accrue`, { month }, (r) => `${r.credited} credits posted${r.alreadyCredited ? `, ${r.alreadyCredited} were already there` : ""}.`)}><CalendarCheck className="size-4" aria-hidden /> Run accrual</Button>
          <Field label="Year">{(p) => <Input {...p} type="number" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} />}</Field>
          <Button variant="secondary" onClick={() => window.confirm(`Close leave for ${year}? Balances above the carry-forward limit are encashed or lapse.`) && run(`${HR}/leave/year-end`, { year }, (r) => `${r.encashedDays} days encashed and ${r.lapsedDays} lapsed across ${r.balances} balances.`)}><CalendarX className="size-4" aria-hidden /> Year end</Button>
          <Button variant="ghost" onClick={() => setAdjusting(true)}><SlidersHorizontal className="size-4" aria-hidden /> Opening / adjustment</Button>
        </Card>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "types", label: "Leave types" }, { value: "balances", label: `Balances ${year}` }]} />
      {tab === "types" && (
        <Card>
          {types.isLoading && <LoadingBlock />}
          {types.error && <ErrorBlock error={types.error} />}
          <ul className="divide-y divide-border text-sm">
            {types.data?.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <span className="w-12 font-mono text-xs text-muted">{t.code}</span>
                <span className="font-medium">{t.name}</span>
                {!t.isPaid && <Badge tone="danger">unpaid</Badge>}
                {t.isCompOff && <Badge tone="primary">comp-off</Badge>}
                {t.gender && <Badge>{t.gender} only</Badge>}
                {!t.isActive && <Badge>inactive</Badge>}
                <span className="text-xs text-muted">
                  {t.isCompOff ? "Earned by working an off day" : `${ACCRUAL[t.accrual]}${t.accrual === "per_days_worked" ? ` (${t.daysWorkedPerLeave})` : t.accrual !== "none" ? `, ${Number(t.annualQuota)} a year` : ""}`}
                  {Number(t.carryForwardMax) > 0 && ` · carry ${Number(t.carryForwardMax)}`}
                  {t.encashable && ` · encash${t.encashMax ? ` up to ${Number(t.encashMax)}` : ""}`}
                  {t.countHolidays && " · sandwich"}
                </span>
                {manage && <Button className="ml-auto" size="sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="size-3.5" aria-hidden /></Button>}
              </li>
            ))}
            {types.data && !types.data.length && <li className="px-5 py-6 text-center text-muted">No leave types yet. Typical: CL 12 monthly, SL 12 monthly, EL one per 20 days worked (Factories Act), LOP unpaid, comp-off.</li>}
          </ul>
        </Card>
      )}
      {tab === "balances" && (
        <Card className="overflow-x-auto">
          {balances.isLoading && <LoadingBlock />}
          {balances.error && <ErrorBlock error={balances.error} />}
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Employee</th>{typeCodes.map((c) => <th key={c} className="px-3 py-2 text-right font-medium">{c}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {[...byEmp.entries()].map(([id, e]) => (
                <tr key={id}>
                  <td className="px-4 py-2"><span className="font-medium">{e.fullName}</span> <span className="font-mono text-xs text-muted">{e.code}</span></td>
                  {typeCodes.map((c) => {
                    const b = e.rows[c];
                    return <td key={c} className="px-3 py-2 text-right tabular-nums" title={b ? `Opening ${b.opening}, credited ${b.credited}, taken ${b.availed}, encashed/lapsed ${b.closedOut}` : ""}>{b ? b.balance : "–"}{b?.pending ? <span className="text-xs text-warning"> ({b.pending})</span> : null}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <TypeDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustDialog types={types.data ?? []} onClose={() => setAdjusting(false)} />}
    </div>
  );
}

function TypeDialog({ row, onClose }: { row: LeaveType | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    isPaid: row?.isPaid ?? true,
    accrual: row?.accrual ?? "monthly",
    annualQuota: row ? String(Number(row.annualQuota)) : "12",
    daysWorkedPerLeave: row?.daysWorkedPerLeave ? String(row.daysWorkedPerLeave) : "20",
    carryForwardMax: row ? String(Number(row.carryForwardMax)) : "0",
    encashable: row?.encashable ?? false,
    encashMax: row?.encashMax ? String(Number(row.encashMax)) : "",
    allowHalfDay: row?.allowHalfDay ?? true,
    allowNegative: row?.allowNegative ?? false,
    countHolidays: row?.countHolidays ?? false,
    isCompOff: row?.isCompOff ?? false,
    gender: row?.gender ?? "",
    isActive: row?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const check = (k: "isPaid" | "encashable" | "allowHalfDay" | "allowNegative" | "countHolidays" | "isCompOff" | "isActive", label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}</label>;
  async function save() {
    setError(null);
    const body = { ...f, annualQuota: Number(f.annualQuota) || 0, carryForwardMax: Number(f.carryForwardMax) || 0, daysWorkedPerLeave: f.accrual === "per_days_worked" ? Number(f.daysWorkedPerLeave) : null, encashMax: f.encashMax ? Number(f.encashMax) : null, gender: f.gender || null };
    try {
      await api(row ? `${HR}/leave/types/${row.id}` : `${HR}/leave/types`, { method: row ? "PUT" : "POST", body });
      await qc.invalidateQueries({ queryKey: [HR, "leave"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={row ? `Edit ${row.name}` : "New leave type"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        {!f.isCompOff && <Field label="Accrual">{(p) => <Select {...p} value={f.accrual} onChange={(e) => setF({ ...f, accrual: e.target.value })}>{Object.entries(ACCRUAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>}
        {!f.isCompOff && (f.accrual === "monthly" || f.accrual === "yearly") && <Field label="Days a year">{(p) => <Input {...p} inputMode="decimal" value={f.annualQuota} onChange={(e) => setF({ ...f, annualQuota: e.target.value })} />}</Field>}
        {!f.isCompOff && f.accrual === "per_days_worked" && <Field label="Days worked per day of leave" hint="Factories Act s.79: 20 for adults">{(p) => <Input {...p} type="number" value={f.daysWorkedPerLeave} onChange={(e) => setF({ ...f, daysWorkedPerLeave: e.target.value })} />}</Field>}
        <Field label="Carry forward up to">{(p) => <Input {...p} inputMode="decimal" value={f.carryForwardMax} onChange={(e) => setF({ ...f, carryForwardMax: e.target.value })} />}</Field>
        {f.encashable && <Field label="Encash up to (days a year)">{(p) => <Input {...p} inputMode="decimal" value={f.encashMax} onChange={(e) => setF({ ...f, encashMax: e.target.value })} />}</Field>}
        <Field label="Only for">{(p) => <Select {...p} value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">Everyone</option><option value="female">Women</option><option value="male">Men</option></Select>}</Field>
        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
          {check("isPaid", "Paid")}
          {check("isCompOff", "Comp-off (earned for work on off days)")}
          {check("encashable", "Encash the excess at year end")}
          {check("allowHalfDay", "Half days allowed")}
          {check("countHolidays", "Count offs and holidays inside the leave")}
          {check("allowNegative", "Allow a negative balance")}
          {check("isActive", "Active")}
        </div>
      </div>
    </Dialog>
  );
}

function AdjustDialog({ types, onClose }: { types: LeaveType[]; onClose: () => void }) {
  const qc = useQueryClient();
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`) });
  const [f, setF] = useState({ employeeId: "", leaveTypeId: "", days: "", kind: "opening", remarks: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/leave/adjust`, { body: { ...f, days: Number(f.days) } });
      await qc.invalidateQueries({ queryKey: [HR, "leave"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Opening balance or adjustment" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.employeeId || !f.leaveTypeId || !Number(f.days)}>Post</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Employee" className="sm:col-span-2">{(p) => <Select {...p} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Choose…</option>{people.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>
        <Field label="Leave type">{(p) => <Select {...p} value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}><option value="">Choose…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="opening">Opening balance</option><option value="adjustment">Adjustment</option></Select>}</Field>
        <Field label="Days" hint="Negative to reduce">{(p) => <Input {...p} inputMode="decimal" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />}</Field>
        <Field label="Remarks">{(p) => <Input {...p} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
