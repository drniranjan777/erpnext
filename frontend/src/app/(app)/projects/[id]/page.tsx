"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";

type Costs = { material: number; labour: number; subcontract: number; other: number };
interface Wbs { id: string; code: string; name: string; parentId: string | null; plannedStart: string; plannedEnd: string; budget: Costs; actual: Costs; progressPct: number; totals: { budget: number; actual: number; committed: number; overBudget: boolean }; evm: { pv: number; ev: number; cpi: number | null; spi: number | null } | null }
interface Project {
  id: string; code: string; name: string; customer: string | null; contractValue: number; startDate: string; endDate: string; status: string;
  wbs: Wbs[];
  evm: { bac: number; pv: number; ev: number; ac: number; cv: number; sv: number; cpi: number | null; spi: number | null; eac: number; etc: number; vac: number; percentComplete: number };
  milestones: { id: string; name: string; dueDate: string; pct: number; amount: number; status: string; invoice: { number: string | null; status: string } | null }[];
  costs: { documentId: string; docType: string; number: string | null; status: string; wbsId: string; costType: string; actual: number; committed: number }[];
  resources: { id: string; employee: string; fromDate: string; toDate: string; hoursPerWeek: number; costRate: number }[];
  timesheets: { id: string; wbs: string; employee: string; workDate: string; hours: number; note: string | null; status: string }[];
  billing: { billed: number; revenueEarned: number; unbilled: number; margin: number };
}
interface Doc { id: string; docType: string; number: string; status: string; docDate: string; amount: string | null }
interface Emp { id: string; fullName: string; code?: string }

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const DOC: Record<string, string> = { purchase_order: "PO", purchase_invoice: "Purchase invoice", stock_entry: "Stock issue", journal_entry: "Journal" };

/** One project: WBS, earned value, milestones, costs, people and time. */
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("projects.plan.manage");
  const q = useQuery({ queryKey: ["/projects", id], queryFn: () => api<Project>(`/projects/${id}`) });
  const emps = useQuery({ queryKey: ["/hr/employees", "picker"], queryFn: () => api<{ items: Emp[] } | Emp[]>("/hr/employees", { query: { limit: 200 } }), enabled: manage || can("projects.time.book") });
  const [w, setW] = useState({ parentId: "", code: "", name: "", plannedStart: "", plannedEnd: "", budgetMaterial: "", budgetLabour: "", budgetSubcontract: "", budgetOther: "" });
  const [m, setM] = useState({ name: "", dueDate: "", pct: "" });
  const [search, setSearch] = useState("");
  const [link, setLink] = useState({ wbsId: "", costType: "material" });
  const [r, setR] = useState({ employeeId: "", fromDate: "", toDate: "", hoursPerWeek: "40", costRate: "" });
  const [t, setT] = useState(() => ({ wbsId: "", employeeId: "", workDate: new Date().toISOString().slice(0, 10), hours: "8", note: "" }));
  const docs = useQuery({ queryKey: ["/projects/documents", search], queryFn: () => api<Doc[]>("/projects/documents", { query: { q: search } }), enabled: search.length >= 2 });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/projects"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const p = q.data;
  if (!p) return q.isError ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  const people = Array.isArray(emps.data) ? emps.data : (emps.data?.items ?? []);
  const leaves = p.wbs.filter((x) => !p.wbs.some((y) => y.parentId === x.id));
  const depth = (x: Wbs) => x.code.split(".").length - 1;
  return (
    <div className="space-y-4">
      <PageHeader title={`${p.code} · ${p.name}`} description={`${p.customer ?? "No customer"} · contract ${inr(p.contractValue)} · ${formatDate(p.startDate)} → ${formatDate(p.endDate)}`} actions={manage && <Select className="h-9 w-36" aria-label="Status" value={p.status} onChange={(e) => run(() => api(`/projects/${p.id}/status`, { body: { status: e.target.value } }), "Status changed.")}><option value="planning">Planning</option><option value="active">Active</option><option value="closed">Closed</option></Select>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {[["Budget (BAC)", inr(p.evm.bac)], ["Planned value", inr(p.evm.pv)], ["Earned value", inr(p.evm.ev)], ["Actual cost", inr(p.evm.ac)], ["CPI", p.evm.cpi ?? "–"], ["SPI", p.evm.spi ?? "–"], ["Estimate at completion", inr(p.evm.eac)], ["Complete", `${p.evm.percentComplete} %`]].map(([l, v]) => <Card key={l} className="p-3"><p className="text-xs text-muted">{l}</p><p className="text-lg font-semibold tabular-nums">{v}</p></Card>)}
      </div>
      <Card className="overflow-x-auto">
        <CardHeader title="Work breakdown" />
        <table className="w-full min-w-[900px] border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs text-muted"><tr><th className="px-3 py-1.5">WBS</th><th className="px-3 py-1.5">Planned</th><th className="px-3 py-1.5 text-right">Budget</th><th className="px-3 py-1.5 text-right">Actual</th><th className="px-3 py-1.5 text-right">Committed</th><th className="px-3 py-1.5 text-right">Progress</th><th className="px-3 py-1.5">CPI / SPI</th></tr></thead>
          <tbody className="divide-y divide-border">
            {p.wbs.map((x) => (
              <tr key={x.id}>
                <td className="px-3 py-1.5" style={{ paddingLeft: `${0.75 + depth(x) * 1.25}rem` }}><span className="font-medium">{x.code}</span> {x.name}</td>
                <td className="px-3 py-1.5 text-xs">{formatDate(x.plannedStart)} → {formatDate(x.plannedEnd)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{inr(x.totals.budget)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{inr(x.totals.actual)} {x.totals.overBudget && <Badge tone="danger">over</Badge>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{inr(x.totals.committed)}</td>
                <td className="px-3 py-1.5 text-right">{x.evm ? (manage ? <Input className="ml-auto h-8 w-20" type="number" min={0} max={100} aria-label={`Progress of ${x.code}`} defaultValue={x.progressPct} onBlur={(e) => Number(e.target.value) !== x.progressPct && run(() => api(`/projects/wbs/${x.id}/progress`, { body: { progressPct: Number(e.target.value) } }), "Progress saved.")} /> : `${x.progressPct} %`) : ""}</td>
                <td className="px-3 py-1.5 text-xs">{x.evm ? `${x.evm.cpi ?? "–"} / ${x.evm.spi ?? "–"}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {manage && (
          <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-5">
            <Select aria-label="Parent" value={w.parentId} onChange={(e) => setW({ ...w, parentId: e.target.value })}><option value="">Top level</option>{p.wbs.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</Select>
            <Input aria-label="Code" placeholder="Code (1.2)" value={w.code} onChange={(e) => setW({ ...w, code: e.target.value })} />
            <Input className="sm:col-span-3" aria-label="Name" placeholder="Name" value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} />
            <label className="text-xs text-muted">Start<Input type="date" value={w.plannedStart} onChange={(e) => setW({ ...w, plannedStart: e.target.value })} /></label>
            <label className="text-xs text-muted">End<Input type="date" value={w.plannedEnd} onChange={(e) => setW({ ...w, plannedEnd: e.target.value })} /></label>
            {(["budgetMaterial", "budgetLabour", "budgetSubcontract", "budgetOther"] as const).map((k) => <Input key={k} aria-label={k} type="number" min={0} placeholder={k.slice(6) + " ₹"} value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} />)}
            <Button disabled={!w.code || w.name.length < 2 || !w.plannedStart || !w.plannedEnd} onClick={() => run(() => api(`/projects/${p.id}/wbs`, { body: { parentId: w.parentId || null, code: w.code, name: w.name, plannedStart: w.plannedStart, plannedEnd: w.plannedEnd, budgetMaterial: Number(w.budgetMaterial || 0), budgetLabour: Number(w.budgetLabour || 0), budgetSubcontract: Number(w.budgetSubcontract || 0), budgetOther: Number(w.budgetOther || 0) } }), "Element added.").then(() => setW({ ...w, code: "", name: "" }))}>Add element</Button>
          </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Milestones and billing" description={`Billed ${inr(p.billing.billed)} · earned ${inr(p.billing.revenueEarned)} · unbilled ${inr(p.billing.unbilled)} · margin on billing ${inr(p.billing.margin)}`} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {p.milestones.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <Badge tone={x.status === "billed" ? "success" : x.status === "achieved" ? "primary" : "neutral"}>{x.status}</Badge>
                <span className="font-medium">{x.name}</span>
                <span className="text-xs text-muted">{formatDate(x.dueDate)} · {x.pct} % · {inr(x.amount)}{x.invoice ? ` · invoice ${x.invoice.number ?? "draft"}` : ""}</span>
                {manage && x.status === "pending" && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => run(() => api(`/projects/milestones/${x.id}/achieved`, { body: {} }), "Marked achieved.")}>Achieved</Button>}
                {manage && x.status === "achieved" && <Button size="sm" className="ml-auto" onClick={() => run(() => api(`/projects/milestones/${x.id}/bill`, { body: {} }), "Draft invoice raised.")}>Raise invoice</Button>}
              </li>
            ))}
          </ul>
          {manage && (
            <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
              <Input className="h-9 flex-1" aria-label="Milestone" placeholder="Milestone" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />
              <Input className="h-9 w-36" type="date" aria-label="Due" value={m.dueDate} onChange={(e) => setM({ ...m, dueDate: e.target.value })} />
              <Input className="h-9 w-20" type="number" aria-label="Percent" placeholder="%" value={m.pct} onChange={(e) => setM({ ...m, pct: e.target.value })} />
              <Button size="sm" disabled={m.name.length < 2 || !m.dueDate || !Number(m.pct)} onClick={() => run(() => api(`/projects/${p.id}/milestones`, { body: { name: m.name, dueDate: m.dueDate, pct: Number(m.pct) } }), "Milestone added.").then(() => setM({ name: "", dueDate: "", pct: "" }))}>Add</Button>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Costs charged" />
          <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border text-sm">
            {p.costs.map((c) => <li key={c.documentId} className="flex flex-wrap gap-2 px-4 py-1.5"><Badge>{DOC[c.docType]}</Badge><span>{c.number ?? "draft"}</span><span className="text-xs text-muted">{p.wbs.find((x) => x.id === c.wbsId)?.code} · {c.costType} · {c.status}</span><span className="ml-auto tabular-nums">{c.actual ? inr(c.actual) : c.committed ? `${inr(c.committed)} committed` : ""}</span></li>)}
            {!p.costs.length && <li className="px-4 py-4 text-center text-muted">Nothing charged yet.</li>}
          </ul>
          {manage && (
            <div className="space-y-2 border-t border-border p-4 text-sm">
              <div className="flex gap-2">
                <Input className="h-9 flex-1" aria-label="Find document" placeholder="Find a PO, purchase invoice, stock issue or journal by number" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select className="h-9 w-32" aria-label="WBS" value={link.wbsId} onChange={(e) => setLink({ ...link, wbsId: e.target.value })}><option value="">WBS…</option>{leaves.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</Select>
                <Select className="h-9 w-32" aria-label="Cost type" value={link.costType} onChange={(e) => setLink({ ...link, costType: e.target.value })}>{["material", "labour", "subcontract", "other"].map((c) => <option key={c}>{c}</option>)}</Select>
              </div>
              {docs.data?.map((d) => <p key={d.id} className="flex items-center gap-2"><Badge>{DOC[d.docType]}</Badge>{d.number} <span className="text-xs text-muted">{formatDate(d.docDate)} · {d.status}</span><Button size="sm" variant="secondary" className="ml-auto" disabled={!link.wbsId} onClick={() => run(() => api(`/projects/${p.id}/costs`, { body: { wbsId: link.wbsId, documentId: d.id, costType: link.costType } }), "Charged to the project.").then(() => setSearch(""))}>Charge</Button></p>)}
            </div>
          )}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="People" />
          <ul className="divide-y divide-border border-t border-border text-sm">{p.resources.map((x) => <li key={x.id} className="px-4 py-1.5">{x.employee} · {x.hoursPerWeek} h/week · {formatDate(x.fromDate)} → {formatDate(x.toDate)} · {inr(x.costRate)}/h</li>)}</ul>
          {manage && (
            <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
              <Select className="h-9 flex-1" aria-label="Employee" value={r.employeeId} onChange={(e) => setR({ ...r, employeeId: e.target.value })}><option value="">Employee…</option>{people.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</Select>
              <Input className="h-9 w-36" type="date" aria-label="From" value={r.fromDate} onChange={(e) => setR({ ...r, fromDate: e.target.value })} />
              <Input className="h-9 w-36" type="date" aria-label="To" value={r.toDate} onChange={(e) => setR({ ...r, toDate: e.target.value })} />
              <Input className="h-9 w-20" type="number" aria-label="Hours a week" value={r.hoursPerWeek} onChange={(e) => setR({ ...r, hoursPerWeek: e.target.value })} />
              <Input className="h-9 w-24" type="number" aria-label="Cost rate" placeholder="₹/hour" value={r.costRate} onChange={(e) => setR({ ...r, costRate: e.target.value })} />
              <Button size="sm" disabled={!r.employeeId || !r.fromDate || !r.toDate} onClick={() => run(() => api(`/projects/${p.id}/resources`, { body: { employeeId: r.employeeId, fromDate: r.fromDate, toDate: r.toDate, hoursPerWeek: Number(r.hoursPerWeek), costRate: Number(r.costRate || 0) } }), "Planned.")}>Plan</Button>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Time booked" action={can("projects.time.approve") && p.timesheets.some((x) => x.status === "submitted") && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/projects/${p.id}/time/approve`, { body: { ids: p.timesheets.filter((x) => x.status === "submitted").map((x) => x.id) } }), "Approved.")}>Approve all</Button>} />
          <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border text-sm">{p.timesheets.map((x) => <li key={x.id} className="flex gap-2 px-4 py-1.5"><Badge tone={x.status === "approved" ? "success" : x.status === "rejected" ? "danger" : "warning"}>{x.status}</Badge>{formatDate(x.workDate)} · {x.employee} · {x.wbs} · {x.hours} h<span className="text-xs text-muted">{x.note}</span></li>)}</ul>
          {can("projects.time.book") && (
            <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
              <Select className="h-9 w-40" aria-label="Employee" value={t.employeeId} onChange={(e) => setT({ ...t, employeeId: e.target.value })}><option value="">Employee…</option>{people.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</Select>
              <Select className="h-9 w-24" aria-label="WBS" value={t.wbsId} onChange={(e) => setT({ ...t, wbsId: e.target.value })}><option value="">WBS…</option>{leaves.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</Select>
              <Input className="h-9 w-36" type="date" aria-label="Date" value={t.workDate} onChange={(e) => setT({ ...t, workDate: e.target.value })} />
              <Input className="h-9 w-16" type="number" aria-label="Hours" value={t.hours} onChange={(e) => setT({ ...t, hours: e.target.value })} />
              <Input className="h-9 flex-1" aria-label="Note" placeholder="Note" value={t.note} onChange={(e) => setT({ ...t, note: e.target.value })} />
              <Button size="sm" disabled={!t.employeeId || !t.wbsId || !Number(t.hours)} onClick={() => run(() => api(`/projects/${p.id}/time`, { body: { wbsId: t.wbsId, employeeId: t.employeeId, workDate: t.workDate, hours: Number(t.hours), note: t.note || null } }), "Booked.")}>Book</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
