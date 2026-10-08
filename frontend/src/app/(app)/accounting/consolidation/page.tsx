"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Company { id: string; name: string }
interface Member { companyId: string; ownershipPct: number; investmentCost: number; acquiredOn: string }
interface Group { id: string; name: string; parentCompanyId: string; members: Member[] }
interface Line { line: string; label: string; amount: number }
interface Result {
  companies: { id: string; name: string; isParent: boolean; ownershipPct: number; netAssets: number; profit: number }[];
  balanceSheet: { assets: Line[]; liabilities: Line[]; equity: Line[]; capitalReserve: number; nonControllingInterest: number; totalAssets: number; totalEquityAndLiabilities: number };
  profitAndLoss: { lines: (Line & { nature: string })[]; income: number; expenses: number; profit: number; attributableToOwners: number; attributableToNci: number };
  subsidiaries: { name: string; ownershipPct: number; goodwill: number; nci: number; nciProfit: number; postAcquisitionShare: number }[];
  unreconciledDifference: number;
}

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fyStart = () => {
  const d = new Date();
  return `${d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1}-04-01`;
};

/** Consolidated financial statements of a group (Ind AS 110, Schedule III Division II layout). */
export default function ConsolidationPage() {
  const { can } = useAuth();
  const groups = useQuery({ queryKey: ["/finance/groups"], queryFn: () => api<Group[]>("/finance/groups") });
  const companies = useQuery({ queryKey: ["/finance/companies"], queryFn: () => api<Company[]>("/finance/companies") });
  const [groupId, setGroupId] = useState("");
  const [period, setPeriod] = useState(() => ({ from: fyStart(), to: new Date().toISOString().slice(0, 10) }));
  const gid = groupId || groups.data?.[0]?.id || "";
  const q = useQuery({ queryKey: ["/finance/groups", gid, period], queryFn: () => api<Result>(`/finance/groups/${gid}/consolidated`, { query: period }), enabled: !!gid });
  const r = q.data;
  const section = (title: string, lines: Line[], total?: number) => (
    <div>
      <p className="bg-surface-muted px-4 py-1.5 text-xs font-medium uppercase text-muted">{title}</p>
      {lines.map((l) => <p key={l.line} className="flex justify-between px-4 py-1 text-sm"><span>{l.label}</span><span className="tabular-nums">{inr(l.amount)}</span></p>)}
      {total !== undefined && <p className="flex justify-between border-t border-border px-4 py-1 text-sm font-medium"><span>Total</span><span className="tabular-nums">{inr(total)}</span></p>}
    </div>
  );
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Consolidation"
        description="Group statements: members' books added line by line after inter-company balances and transactions are removed; the parent's investment replaced by goodwill; non-controlling interest in equity and profit."
        actions={
          <span className="flex flex-wrap gap-2 print:hidden">
            <Select className="h-9 w-48" aria-label="Group" value={gid} onChange={(e) => setGroupId(e.target.value)}>{groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
            <Input className="h-9 w-36" type="date" aria-label="From" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
            <Input className="h-9 w-36" type="date" aria-label="To" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
            <Button variant="secondary" onClick={() => window.print()}>Print</Button>
          </span>
        }
      />
      {r && r.unreconciledDifference !== 0 && <Alert tone="warning">Inter-company balances do not match: ₹{inr(r.unreconciledDifference)} is left after elimination. See Inter-company → Reconciliation.</Alert>}
      {r && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={`Consolidated balance sheet as at ${period.to}`} />
              <div className="border-t border-border">
                {section("Assets", r.balanceSheet.assets, r.balanceSheet.totalAssets)}
                {section("Equity attributable to owners", r.balanceSheet.equity)}
                <p className="flex justify-between px-4 py-1 text-sm"><span>Non-controlling interest</span><span className="tabular-nums">{inr(r.balanceSheet.nonControllingInterest)}</span></p>
                {section("Liabilities", r.balanceSheet.liabilities)}
                <p className="flex justify-between border-t border-border px-4 py-1.5 text-sm font-medium"><span>Total equity and liabilities</span><span className="tabular-nums">{inr(r.balanceSheet.totalEquityAndLiabilities)}</span></p>
                {r.balanceSheet.capitalReserve > 0 && <p className="px-4 pb-2 text-xs text-muted">Includes a capital reserve on acquisition of {inr(r.balanceSheet.capitalReserve)}.</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title={`Consolidated profit and loss, ${period.from} to ${period.to}`} />
              <div className="border-t border-border">
                {section("Income", r.profitAndLoss.lines.filter((l) => l.nature === "income"), r.profitAndLoss.income)}
                {section("Expenses", r.profitAndLoss.lines.filter((l) => l.nature === "expense"), r.profitAndLoss.expenses)}
                <p className="flex justify-between border-t border-border px-4 py-1.5 text-sm font-medium"><span>Profit for the period</span><span className="tabular-nums">{inr(r.profitAndLoss.profit)}</span></p>
                <p className="flex justify-between px-4 py-1 text-sm"><span>attributable to owners of the parent</span><span className="tabular-nums">{inr(r.profitAndLoss.attributableToOwners)}</span></p>
                <p className="flex justify-between px-4 py-1 pb-3 text-sm"><span>attributable to non-controlling interest</span><span className="tabular-nums">{inr(r.profitAndLoss.attributableToNci)}</span></p>
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Subsidiaries" />
            <table className="w-full border-t border-border text-sm">
              <thead className="bg-surface-muted text-xs text-muted"><tr><th className="px-4 py-1.5 text-left">Company</th><th className="px-4 py-1.5 text-right">Held</th><th className="px-4 py-1.5 text-right">Goodwill / (capital reserve)</th><th className="px-4 py-1.5 text-right">Group share since acquisition</th><th className="px-4 py-1.5 text-right">NCI</th><th className="px-4 py-1.5 text-right">NCI in profit</th></tr></thead>
              <tbody className="divide-y divide-border">{r.subsidiaries.map((s) => <tr key={s.name}><td className="px-4 py-1.5">{s.name}</td><td className="px-4 py-1.5 text-right">{s.ownershipPct} %</td><td className="px-4 py-1.5 text-right tabular-nums">{inr(s.goodwill)}</td><td className="px-4 py-1.5 text-right tabular-nums">{inr(s.postAcquisitionShare)}</td><td className="px-4 py-1.5 text-right tabular-nums">{inr(s.nci)}</td><td className="px-4 py-1.5 text-right tabular-nums">{inr(s.nciProfit)}</td></tr>)}</tbody>
            </table>
          </Card>
        </>
      )}
      {groups.data && !groups.data.length && <Card className="p-6 text-center text-sm text-muted">No group yet.</Card>}
      {can("finance.group.manage") && companies.data && <GroupForm key={groups.dataUpdatedAt} companies={companies.data} />}
    </div>
  );
}

function GroupForm({ companies }: { companies: Company[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", parentCompanyId: "" });
  const [members, setMembers] = useState<{ companyId: string; ownershipPct: string; investmentCost: string; acquiredOn: string }[]>([]);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      await api("/finance/groups", { body: { name: f.name, parentCompanyId: f.parentCompanyId, members: members.map((m) => ({ companyId: m.companyId, ownershipPct: Number(m.ownershipPct), investmentCost: Number(m.investmentCost), acquiredOn: m.acquiredOn })) } });
      setMsg({ tone: "success", text: "Group saved." });
      qc.invalidateQueries({ queryKey: ["/finance/groups"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <Card className="print:hidden">
      <CardHeader title="New group" />
      <div className="space-y-2 border-t border-border p-4 text-sm">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Name" placeholder="Group name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select aria-label="Parent" value={f.parentCompanyId} onChange={(e) => setF({ ...f, parentCompanyId: e.target.value })}><option value="">Parent company…</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </div>
        {members.map((m, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-4">
            <Select aria-label="Subsidiary" value={m.companyId} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, companyId: e.target.value } : x)))}><option value="">Subsidiary…</option>{companies.filter((c) => c.id !== f.parentCompanyId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Input aria-label="Held %" type="number" placeholder="% held" value={m.ownershipPct} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, ownershipPct: e.target.value } : x)))} />
            <Input aria-label="Investment cost" type="number" placeholder="Cost of investment ₹" value={m.investmentCost} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, investmentCost: e.target.value } : x)))} />
            <Input aria-label="Acquired on" type="date" value={m.acquiredOn} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, acquiredOn: e.target.value } : x)))} />
          </div>
        ))}
        <span className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMembers([...members, { companyId: "", ownershipPct: "100", investmentCost: "", acquiredOn: "" }])}>Add subsidiary</Button>
          <Button size="sm" disabled={f.name.length < 2 || !f.parentCompanyId || members.some((m) => !m.companyId || !m.acquiredOn)} onClick={save}>Save group</Button>
        </span>
        <p className="text-xs text-muted"><Badge>Note</Badge> Members keep their own books with the standard chart, so lines add up by account.</p>
      </div>
    </Card>
  );
}
