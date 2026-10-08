"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { ItemPicker } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { QA } from "@/lib/quality";

interface Score { vendor: { id: string; name: string }; lots: number; acceptancePct: number | null; ppm: number | null; ncrs: number; copq: string; deliveries: number; onTimePct: number | null; openScars: number; lastAudit: { date: string; score: string | null; result: string } | null; score: number | null; grade: string | null }
interface Audit { id: string; vendor: string; auditDate: string; kind: string; auditor: string; score: string | null; result: string; findings: string | null; nextDue: string | null; overdue: boolean }
interface Aml { id: string; code: string; name: string; manufacturer: string; mpn: string; supplier: string | null; status: string; approvedOn: string | null }
type Tab = "scorecard" | "audits" | "aml";
const GRADE = { A: "success", B: "primary", C: "warning", D: "danger" } as const;
const pct = (v: number | null) => (v === null ? "–" : `${v}%`);

export default function SuppliersPage() {
  const [tab, setTab] = useState<Tab>("scorecard");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Supplier quality" description="Scorecards from incoming inspection, NCRs and on-time delivery; supplier audits; and the approved manufacturer list." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "scorecard", label: "Scorecard" }, { value: "audits", label: "Audits" }, { value: "aml", label: "Approved manufacturers" }]} />
      {tab === "scorecard" && <Scorecard />}
      {tab === "audits" && <Audits />}
      {tab === "aml" && <AmlList />}
    </div>
  );
}

function Scorecard() {
  const q = useQuery({ queryKey: [QA, "scorecard"], queryFn: () => api<Score[]>(`${QA}/suppliers/scorecard`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <Card>
      <CardHeader title="This financial year" description="Score = 50% lot acceptance + 30% on-time delivery + 20% last audit (over the parts known). A ≥ 90, B ≥ 75, C ≥ 60." />
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Vendor</th><th className="px-4 py-2 text-right font-medium">Lots</th><th className="px-4 py-2 text-right font-medium">Accepted</th><th className="px-4 py-2 text-right font-medium">PPM</th><th className="px-4 py-2 text-right font-medium">On time</th><th className="px-4 py-2 text-right font-medium">NCRs · COPQ</th><th className="px-4 py-2 font-medium">Audit</th><th className="px-4 py-2 text-right font-medium">Score</th></tr></thead>
          <tbody className="divide-y divide-border">
            {q.data!.map((r) => (
              <tr key={r.vendor.id}>
                <td className="px-4 py-2">{r.vendor.name}{r.openScars > 0 && <Badge tone="warning" className="ml-2">{r.openScars} open SCAR</Badge>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.lots}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pct(r.acceptancePct)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.ppm ?? "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pct(r.onTimePct)}<span className="block text-xs text-muted">{r.deliveries} receipts</span></td>
                <td className="px-4 py-2 text-right tabular-nums">{r.ncrs} · {formatMoney(r.copq)}</td>
                <td className="px-4 py-2">{r.lastAudit ? <>{r.lastAudit.score ?? "–"} <span className="text-xs text-muted">{r.lastAudit.result} {formatDate(r.lastAudit.date)}</span></> : "–"}</td>
                <td className="px-4 py-2 text-right">{r.score ?? "–"} {r.grade && <Badge tone={GRADE[r.grade as keyof typeof GRADE]}>{r.grade}</Badge>}</td>
              </tr>
            ))}
            {!q.data!.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">No supplier activity this year.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Audits() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: [QA, "audits"], queryFn: () => api<Audit[]>(`${QA}/suppliers/audits`) });
  const [vendor, setVendor] = useState<PickedParty | null>(null);
  const [f, setF] = useState({ auditDate: todayIST(), kind: "system", auditor: "", score: "", result: "approved", findings: "", nextDue: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${QA}/suppliers/audits`, { body: { ...f, partyId: vendor?.id, score: f.score || null, findings: f.findings || null, nextDue: f.nextDue || null } });
      setVendor(null);
      setF({ ...f, auditor: "", score: "", findings: "", nextDue: "" });
      qc.invalidateQueries({ queryKey: [QA] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="space-y-4">
      {can("quality.suppliers.manage") && (
        <Card>
          <CardHeader title="Record an audit" />
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
            {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
            <Field label="Vendor" className="sm:col-span-2">{(p) => <PartyPicker id={p.id} role="vendor" value={vendor} onChange={setVendor} />}</Field>
            <Field label="Date">{(p) => <Input {...p} type="date" value={f.auditDate} onChange={(e) => setF({ ...f, auditDate: e.target.value })} />}</Field>
            <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="system">System</option><option value="process">Process</option><option value="product">Product</option></Select>}</Field>
            <Field label="Auditor">{(p) => <Input {...p} value={f.auditor} onChange={(e) => setF({ ...f, auditor: e.target.value })} />}</Field>
            <Field label="Score (0–100)">{(p) => <Input {...p} inputMode="decimal" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />}</Field>
            <Field label="Result">{(p) => <Select {...p} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="approved">Approved</option><option value="conditional">Conditional</option><option value="disapproved">Disapproved</option></Select>}</Field>
            <Field label="Next audit due">{(p) => <Input {...p} type="date" value={f.nextDue} onChange={(e) => setF({ ...f, nextDue: e.target.value })} />}</Field>
            <Field label="Findings" className="sm:col-span-3">{(p) => <Input {...p} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} />}</Field>
            <div className="flex items-end justify-end"><Button onClick={save} disabled={!vendor || f.auditor.trim().length < 2}><Plus className="size-4" aria-hidden /> Save audit</Button></div>
          </div>
        </Card>
      )}
      {q.isLoading && <LoadingBlock />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Vendor</th><th className="px-4 py-2 font-medium">Audit</th><th className="px-4 py-2 font-medium">Result</th><th className="px-4 py-2 font-medium">Findings</th><th className="px-4 py-2 font-medium">Next due</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2">{a.vendor}</td>
                  <td className="px-4 py-2">{formatDate(a.auditDate)} · {a.kind}<span className="block text-xs text-muted">{a.auditor}</span></td>
                  <td className="px-4 py-2"><Badge tone={a.result === "approved" ? "success" : a.result === "conditional" ? "warning" : "danger"}>{a.result}</Badge> {a.score && <span className="tabular-nums">{a.score}</span>}</td>
                  <td className="px-4 py-2 text-muted">{a.findings ?? ""}</td>
                  <td className="px-4 py-2">{a.nextDue ? formatDate(a.nextDue) : "–"}{a.overdue && <Badge tone="danger" className="ml-2">Overdue</Badge>}</td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No audits recorded.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}

function AmlList() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("quality.suppliers.manage");
  const q = useQuery({ queryKey: [QA, "aml"], queryFn: () => api<Aml[]>(`${QA}/suppliers/aml`) });
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [supplier, setSupplier] = useState<PickedParty | null>(null);
  const [f, setF] = useState({ manufacturer: "", mpn: "", status: "approved" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${QA}/suppliers/aml`, { body: { ...f, itemId: item?.id, partyId: supplier?.id ?? null, approvedOn: todayIST() } });
      setF({ manufacturer: "", mpn: "", status: "approved" });
      qc.invalidateQueries({ queryKey: [QA, "aml"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="space-y-4">
      {manage && (
        <Card>
          <CardHeader title="Approve a manufacturer part" />
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
            {error && <div className="sm:col-span-4"><Alert>{error}</Alert></div>}
            <Field label="Item" className="sm:col-span-2">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />)}</Field>
            <Field label="Manufacturer">{(p) => <Input {...p} value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} />}</Field>
            <Field label="Part number (MPN)">{(p) => <Input {...p} value={f.mpn} onChange={(e) => setF({ ...f, mpn: e.target.value })} />}</Field>
            <Field label="Bought through" className="sm:col-span-2">{(p) => <PartyPicker id={p.id} role="vendor" value={supplier} onChange={setSupplier} />}</Field>
            <Field label="Status">{(p) => <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="approved">Approved</option><option value="conditional">Conditional</option><option value="disqualified">Disqualified</option></Select>}</Field>
            <div className="flex items-end justify-end"><Button onClick={save} disabled={!item || !f.manufacturer.trim()}><Plus className="size-4" aria-hidden /> Add</Button></div>
          </div>
        </Card>
      )}
      {q.isLoading && <LoadingBlock />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">Manufacturer · MPN</th><th className="px-4 py-2 font-medium">Through</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{m.code}</span> {m.name}</td>
                  <td className="px-4 py-2">{m.manufacturer}{m.mpn && <span className="font-mono"> · {m.mpn}</span>}</td>
                  <td className="px-4 py-2">{m.supplier ?? "–"}</td>
                  <td className="px-4 py-2"><Badge tone={m.status === "approved" ? "success" : m.status === "conditional" ? "warning" : "danger"}>{m.status}</Badge></td>
                  <td className="px-4 py-2 text-right">{manage && <Button size="sm" variant="ghost" aria-label="Remove" onClick={async () => { await api(`${QA}/suppliers/aml/${m.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: [QA, "aml"] }); }}><Trash2 className="size-4" aria-hidden /></Button>}</td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No manufacturer parts approved yet.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
