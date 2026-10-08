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

interface Rule { id: string; companyId: string; name: string; basis: string; source: string; targets: { costCenterId: string; weight: number }[]; runs: Record<string, string>; sequence: number }
interface Cc { id: string; code: string; name: string }
interface Company { id: string; name: string }

/** Allocation of service cost centres. */
export default function AllocationsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("finance.group.manage");
  const rules = useQuery({ queryKey: ["/finance/allocations"], queryFn: () => api<Rule[]>("/finance/allocations") });
  const companies = useQuery({ queryKey: ["/finance/companies"], queryFn: () => api<Company[]>("/finance/companies") });
  const [companyId, setCompanyId] = useState("");
  const cid = companyId || companies.data?.[0]?.id || "";
  const ccs = useQuery({ queryKey: ["/accounting/cost-centers", cid], queryFn: () => api<Cc[]>("/accounting/cost-centers", { query: { companyId: cid } }), enabled: !!cid });
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [f, setF] = useState({ name: "", source: "", basis: "percent" });
  const [targets, setTargets] = useState<{ costCenterId: string; weight: string }[]>([{ costCenterId: "", weight: "" }]);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run<T>(fn: () => Promise<T>, done: (r: T) => string) {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: "success", text: done(r) });
      qc.invalidateQueries({ queryKey: ["/finance/allocations"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const ccName = (id: string) => ccs.data?.find((c) => c.id === id)?.code ?? "…";
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Cost allocation" description="Expenses booked to a service cost centre (administration, utilities, maintenance) are moved each month to the cost centres it serves, account by account, by a driver: percentage, floor area, head count or machine hours." actions={<span className="flex gap-2"><Select className="h-9 w-48" aria-label="Company" value={cid} onChange={(e) => setCompanyId(e.target.value)}>{companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select><Input className="h-9 w-36" type="month" aria-label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} /></span>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {rules.data?.filter((r) => r.companyId === cid).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="font-medium">{r.sequence}. {r.name}</span>
              <span>{r.source} → {r.targets.map((t) => `${ccName(t.costCenterId)} (${t.weight})`).join(", ")}</span>
              <Badge>{r.basis}</Badge>
              <span className="text-xs text-muted">{Object.keys(r.runs).length ? `run for ${Object.keys(r.runs).sort().join(", ")}` : "not run yet"}</span>
              {manage && <Button size="sm" variant="secondary" className="ml-auto" disabled={!!r.runs[period]} onClick={() => run(() => api<{ journal: string; allocated: number }>(`/finance/allocations/${r.id}/run`, { body: { period } }), (x) => `Allocated ₹${x.allocated.toLocaleString("en-IN")} in journal ${x.journal}.`)}>{r.runs[period] ? `Done for ${period}` : `Run for ${period}`}</Button>}
            </li>
          ))}
          {rules.data && !rules.data.filter((r) => r.companyId === cid).length && <li className="px-4 py-6 text-center text-muted">No allocation rules.</li>}
        </ul>
      </Card>
      {manage && (
        <Card>
          <CardHeader title="New rule" />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <Select aria-label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">Service cost centre…</option>{ccs.data?.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>
              <Input aria-label="Driver" placeholder="Driver (percent, floor area…)" value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value })} />
            </div>
            {targets.map((t, i) => (
              <div key={i} className="flex gap-2">
                <Select className="h-9 flex-1" aria-label="Target" value={t.costCenterId} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, costCenterId: e.target.value } : x)))}><option value="">Receiving cost centre…</option>{ccs.data?.filter((c) => c.id !== f.source).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>
                <Input className="h-9 w-32" type="number" min={0} step="any" aria-label="Weight" placeholder="Weight" value={t.weight} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} />
              </div>
            ))}
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setTargets([...targets, { costCenterId: "", weight: "" }])}>Add target</Button>
              <Button size="sm" disabled={f.name.length < 2 || !f.source || targets.some((t) => !t.costCenterId || !Number(t.weight))} onClick={() => run(() => api("/finance/allocations", { body: { companyId: cid, name: f.name, sourceCostCenterId: f.source, basis: f.basis || "percent", targets: targets.map((t) => ({ costCenterId: t.costCenterId, weight: Number(t.weight) })) } }), () => "Rule saved.")}>Save rule</Button>
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
