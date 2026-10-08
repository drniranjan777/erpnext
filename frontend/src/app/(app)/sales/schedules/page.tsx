"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";

interface Schedule { id: string; number: string; month: string; revision: number; reference: string | null; customerPartNo: string | null; customer: string; itemCode: string; itemName: string; qty: number }
interface Adherence { scheduleId: string; customer: string; itemCode: string; itemName: string; scheduled: number; dueToDate: number; delivered: number; deliveredToDate: number; adherencePct: number | null; onTimePct: number | null; shortfall: number; excess: number }
interface Asn { id: string; number: string; shippedAt: string; expectedAt: string | null; vehicleNo: string | null; lrNo: string | null; packages: number | null; status: string; customer: string; deliveryNumber: string; deliveryId: string; lines: { itemCode: string; customerPartNo: string | null; qty: string; uom: string }[] }
type Tab = "schedules" | "adherence" | "asn";

export default function SchedulesPage() {
  const { can } = useAuth();
  const manage = can("sales.schedules.manage");
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("adherence");
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  async function importFile(f: File) {
    setMsg(null);
    try {
      const r = await apiUpload<{ schedules: number; errors: { row: number; error: string }[] }>("/sales/schedules/import", f);
      setMsg({ tone: r.errors.length ? "danger" : "success", text: `${r.schedules} schedule(s) saved${r.errors.length ? `; ${r.errors.map((e) => `row ${e.row}: ${e.error}`).join("; ")}` : ""}.` });
      qc.invalidateQueries({ queryKey: ["/sales/schedules"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Import failed" });
    } finally {
      if (file.current) file.current.value = "";
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Customer schedules"
        description="Delivery schedules (releases) from OEM customers, dispatch adherence, and advance shipping notices."
        actions={
          manage && (
            <span className="flex gap-2">
              <input ref={file} type="file" accept=".csv,.xlsx" className="hidden" aria-label="Schedule file" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
              <Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import</Button>
              <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Schedule</Button>
            </span>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-44" type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <span className="text-xs text-muted">Import columns: customer (code or GSTIN), item_code or customer_part_no, date (YYYY-MM-DD), qty.</span>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "adherence", label: "Adherence" }, { value: "schedules", label: "Schedules" }, { value: "asn", label: "ASNs" }]} />
      {tab === "schedules" && <ScheduleList month={month} />}
      {tab === "adherence" && <AdherenceView month={month} />}
      {tab === "asn" && <Asns manage={manage} />}
      {adding && <ScheduleDialog month={month} onClose={() => setAdding(false)} />}
    </div>
  );
}

function ScheduleList({ month }: { month: string }) {
  const q = useQuery({ queryKey: ["/sales/schedules", "list", month], queryFn: () => api<Schedule[]>("/sales/schedules", { query: { month } }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return (
    <Card>
      <ul className="divide-y divide-border text-sm">
        {q.data!.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
            <span className="font-mono text-xs text-muted">{s.number}</span>
            <span className="font-medium">{s.customer}</span>
            <span>{s.itemCode} {s.itemName}{s.customerPartNo && <span className="text-xs text-muted"> · part {s.customerPartNo}</span>}</span>
            {s.revision > 0 && <Badge>rev {s.revision}</Badge>}
            <span className="ml-auto tabular-nums">{s.qty}</span>
          </li>
        ))}
        {!q.data!.length && <li className="px-5 py-6 text-center text-muted">No schedules for this month.</li>}
      </ul>
    </Card>
  );
}

function AdherenceView({ month }: { month: string }) {
  const q = useQuery({ queryKey: ["/sales/schedules", "adherence", month], queryFn: () => api<Adherence[]>("/sales/schedules/adherence", { query: { month } }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const tone = (p: number | null) => (p === null ? "neutral" : p >= 95 ? "success" : p >= 80 ? "warning" : "danger");
  return (
    <Card>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Customer · item</th><th className="px-3 py-2 text-right font-medium">Month</th><th className="px-3 py-2 text-right font-medium">Due to date</th><th className="px-3 py-2 text-right font-medium">Dispatched</th><th className="px-3 py-2 text-right font-medium">Short</th><th className="px-3 py-2 font-medium">Quantity</th><th className="px-3 py-2 font-medium">On time</th></tr></thead>
        <tbody className="divide-y divide-border">
          {q.data!.map((r) => (
            <tr key={r.scheduleId}>
              <td className="px-4 py-2"><span className="font-medium">{r.customer}</span><span className="block text-xs text-muted">{r.itemCode} {r.itemName}</span></td>
              <td className="px-3 py-2 text-right tabular-nums">{r.scheduled}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.dueToDate}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.deliveredToDate}{r.excess > 0 && <span className="block text-xs text-warning">{r.excess} over</span>}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.shortfall || ""}</td>
              <td className="px-3 py-2"><Badge tone={tone(r.adherencePct)}>{r.adherencePct === null ? "–" : `${r.adherencePct} %`}</Badge></td>
              <td className="px-3 py-2"><Badge tone={tone(r.onTimePct)}>{r.onTimePct === null ? "–" : `${r.onTimePct} %`}</Badge></td>
            </tr>
          ))}
          {!q.data!.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No schedules for this month.</td></tr>}
        </tbody>
      </table></div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted">Quantity: dispatched ÷ due so far. On time: schedule dates whose cumulative quantity had been dispatched by that date.</p>
    </Card>
  );
}

function Asns({ manage }: { manage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["/sales/schedules", "asns"], queryFn: () => api<Asn[]>("/sales/asns") });
  const deliveries = useQuery({ queryKey: ["/sales/deliveries", "approved"], queryFn: () => api<{ items: { id: string; number: string | null; title: string | null }[] }>("/sales/deliveries", { query: { status: "approved", limit: 100 } }), enabled: manage });
  const [deliveryId, setDeliveryId] = useState("");
  const [expected, setExpected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sent = new Set(q.data?.map((a) => a.deliveryId));
  async function send() {
    setError(null);
    try {
      await api(`/sales/deliveries/${deliveryId}/asn`, { body: { expectedAt: expected ? `${expected}T10:00:00+05:30` : null } });
      setDeliveryId("");
      qc.invalidateQueries({ queryKey: ["/sales/schedules", "asns"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-b border-border p-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Delivery note">{(p) => <Select {...p} className="w-72" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)}><option value="">Choose a posted delivery…</option>{deliveries.data?.items.filter((d) => !sent.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.number} {d.title}</option>)}</Select>}</Field>
          <Field label="Expected arrival">{(p) => <Input {...p} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />}</Field>
          <Button size="sm" disabled={!deliveryId} onClick={send}><Send className="size-4" aria-hidden /> Send ASN</Button>
        </div>
      )}
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
            <span className="font-mono text-xs">{a.number}</span>
            <span className="font-medium">{a.customer}</span>
            <Link className="text-primary hover:underline" href={`/sales/deliveries/${a.deliveryId}`}>{a.deliveryNumber}</Link>
            <span className="text-xs text-muted">{[a.vehicleNo, a.lrNo && `LR ${a.lrNo}`, a.packages && `${a.packages} pkg`, a.expectedAt && `due ${formatDate(a.expectedAt.slice(0, 10))}`].filter(Boolean).join(" · ")}</span>
            <span className="text-xs">{a.lines.map((l) => `${l.customerPartNo ?? l.itemCode} × ${Number(l.qty)}`).join(", ")}</span>
            <Badge tone={a.status === "received" ? "success" : "primary"} className="ml-auto">{a.status}</Badge>
            {manage && a.status === "sent" && <Button size="sm" variant="ghost" onClick={async () => { await api(`/sales/asns/${a.id}/received`, { body: {} }); qc.invalidateQueries({ queryKey: ["/sales/schedules", "asns"] }); }}>Received</Button>}
          </li>
        ))}
        {q.data && !q.data.length && <li className="px-5 py-6 text-center text-muted">No ASNs yet.</li>}
      </ul>
    </Card>
  );
}

function ScheduleDialog({ month, onClose }: { month: string; onClose: () => void }) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }) });
  const items = useQuery({ queryKey: ["/masters/items", "all"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/items`, { query: { limit: 200 } }) });
  const [f, setF] = useState({ customerId: "", itemId: "", customerPartNo: "", reference: "" });
  const [lines, setLines] = useState([{ date: `${month}-01`, qty: "" }]);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api("/sales/schedules", { body: { ...f, customerPartNo: f.customerPartNo || null, reference: f.reference || null, month, lines: lines.filter((l) => l.qty).map((l) => ({ date: l.date, qty: Number(l.qty) })) } });
      await qc.invalidateQueries({ queryKey: ["/sales/schedules"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Schedule for ${month}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.customerId || !f.itemId}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer">{(p) => <Select {...p} value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Choose…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Item">{(p) => <Select {...p} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Choose…</option>{items.data?.items.map((i) => <option key={i.id} value={i.id}>{i.code} {i.name}</option>)}</Select>}</Field>
        <Field label="Customer part no.">{(p) => <Input {...p} value={f.customerPartNo} onChange={(e) => setF({ ...f, customerPartNo: e.target.value })} />}</Field>
        <Field label="Customer reference">{(p) => <Input {...p} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />}</Field>
        <div className="space-y-2 sm:col-span-2">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label="Date" type="date" min={`${month}-01`} value={l.date} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
              <Input aria-label="Quantity" className="w-32" inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" aria-hidden /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { date: lines.at(-1)?.date ?? `${month}-01`, qty: "" }])}><Plus className="size-4" aria-hidden /> Date</Button>
          <p className="text-xs text-muted">Saving again for the same customer, item and month records a new revision.</p>
        </div>
      </div>
    </Dialog>
  );
}
