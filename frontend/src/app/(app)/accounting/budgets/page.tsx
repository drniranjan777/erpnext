"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC, type AccountRow } from "@/lib/accounting";
import { useAuth } from "@/lib/auth";
import { formatMoney, todayIST } from "@/lib/documents";

interface Budget { id: string; fy: number; name: string; control: "none" | "warn" | "block" }
interface Report extends Budget { rows: { accountId: string; code: string; name: string; budget: string; actual: string; variance: string; usedPct: number | null; months: { budget: string; actual: string }[] }[] }

const fyNow = () => {
  const [y, m] = todayIST().split("-").map(Number);
  return m >= 4 ? y : y - 1;
};
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

export default function BudgetsPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: [ACC, "budgets"], queryFn: () => api<Budget[]>(`${ACC}/budgets`) });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Report | "new" | null>(null);
  const id = selected ?? list.data?.[0]?.id ?? null;
  const report = useQuery({ queryKey: [ACC, "budget", id], queryFn: () => api<Report>(`${ACC}/budgets/${id}`), enabled: !!id });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Budgets" description="Budgets by account and month, compared with actuals. Budget control warns or blocks purchase orders that would go over." actions={can("accounting.budgets.manage") ? <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New budget</Button> : undefined} />
      {list.data && !list.data.length && <Card><EmptyState title="No budgets" description="Set yearly budgets for expense accounts to watch spending." /></Card>}
      {!!list.data?.length && (
        <Card>
          <div className="flex flex-wrap items-end gap-4 px-5 py-4">
            <Field label="Budget">{(f) => <Select {...f} value={id ?? ""} onChange={(e) => setSelected(e.target.value)}>{list.data!.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.fy}-{String((b.fy + 1) % 100).padStart(2, "0")}</option>)}</Select>}</Field>
            {report.data && <Badge className="mb-2">{report.data.control === "block" ? "Blocks orders over budget" : report.data.control === "warn" ? "Warns on orders over budget" : "No control"}</Badge>}
            {report.data && can("accounting.budgets.manage") && <Button className="mb-0.5" variant="secondary" onClick={() => setEditing(report.data!)}>Edit</Button>}
          </div>
          {report.isLoading && <LoadingBlock />}
          {report.data && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-t border-border text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Account</th>{MONTHS.map((m) => <th key={m} className="px-2 py-2 text-right font-medium">{m}</th>)}<th className="px-3 py-2 text-right font-medium">Budget</th><th className="px-3 py-2 text-right font-medium">Actual</th><th className="px-3 py-2 text-right font-medium">Used</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {report.data.rows.map((r) => (
                    <tr key={r.accountId}>
                      <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{r.code}</span> {r.name}</td>
                      {r.months.map((m, i) => <td key={i} className={`px-2 py-2 text-right text-xs tabular-nums ${Number(m.actual) > Number(m.budget) ? "text-danger" : ""}`}>{Number(m.actual).toLocaleString("en-IN", { maximumFractionDigits: 0 })}<span className="block text-muted">{Number(m.budget).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span></td>)}
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.budget)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.actual)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.usedPct !== null && r.usedPct > 100 ? "text-danger" : ""}`}>{r.usedPct === null ? "—" : `${r.usedPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-2 text-xs text-muted">Each month shows actual over budget.</p>
            </div>
          )}
        </Card>
      )}
      {editing && <BudgetDialog existing={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(b) => setSelected(b)} />}
    </div>
  );
}

function BudgetDialog({ existing, onClose, onSaved }: { existing: Report | null; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: [ACC, "accounts"], queryFn: () => api<AccountRow[]>(`${ACC}/accounts`) });
  const [h, setH] = useState({ name: existing?.name ?? "", fy: existing?.fy ?? fyNow(), control: existing?.control ?? "warn" });
  const [lines, setLines] = useState<{ accountId: string; annual: string }[]>(existing ? existing.rows.map((r) => ({ accountId: r.accountId, annual: String(Number(r.budget)) })) : [{ accountId: "", annual: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = (accounts.data ?? []).filter((a) => !a.isGroup && (a.nature === "expense" || a.nature === "income"));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { ...h, lines: lines.filter((l) => l.accountId && l.annual).map((l) => ({ accountId: l.accountId, annual: l.annual })) };
      const r = existing ? await api<Report>(`${ACC}/budgets/${existing.id}`, { method: "PUT", body }) : await api<Report>(`${ACC}/budgets`, { body });
      qc.invalidateQueries({ queryKey: [ACC] });
      onSaved(r.id);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open size="lg" onClose={onClose} title={existing ? `Edit ${existing.name}` : "New budget"} description="Annual amounts are spread evenly over the twelve months." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!h.name} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name">{(p) => <Input {...p} value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />}</Field>
          <Field label="Year starting">{(p) => <Input {...p} type="number" value={h.fy} onChange={(e) => setH({ ...h, fy: Number(e.target.value) })} />}</Field>
          <Field label="Purchase orders over budget">{(p) => <Select {...p} value={h.control} onChange={(e) => setH({ ...h, control: e.target.value as Budget["control"] })}><option value="warn">Warn</option><option value="block">Block</option><option value="none">Allow</option></Select>}</Field>
        </div>
        <CardHeader title="Accounts" action={<Button size="sm" variant="secondary" onClick={() => setLines([...lines, { accountId: "", annual: "" }])}><Plus className="size-4" aria-hidden /> Account</Button>} />
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Select className="h-9 flex-1" aria-label={`Account ${i + 1}`} value={l.accountId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}><option value="">Choose…</option>{choices.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select>
            <Input className="h-9 w-40 text-right" inputMode="decimal" aria-label={`Annual budget ${i + 1}`} placeholder="Annual ₹" value={l.annual} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, annual: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" aria-label={`Remove ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4 text-danger" /></Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
