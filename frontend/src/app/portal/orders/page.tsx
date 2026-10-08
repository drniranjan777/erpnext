"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { ApiError } from "@/lib/api";
import { formatDate, formatMoney, STATUS_META, type DocumentStatus } from "@/lib/documents";
import { portalApi } from "@/lib/portal";
import { askConfirm } from "@/components/ui/ask";

interface Order { id: string; number: string; docDate: string; status: DocumentStatus; grandTotal: string; customerPoNo: string | null; expectedDate: string | null; closedAt: string | null; deliveredPct: number }
interface Request { id: string; number: string; status: string; customerPoNo: string | null; createdAt: string; lines: { itemId: string; qty: string }[]; rejectReason: string | null; salesOrderId: string | null; salesOrderNumber: string | null }
interface Item { id: string; code: string; name: string; sellingRate: string | null; uom: string | null }
const REQ_TONE = { submitted: "primary", accepted: "success", rejected: "danger", withdrawn: "neutral" } as const;

export default function PortalOrders() {
  const qc = useQueryClient();
  const [placing, setPlacing] = useState(false);
  const orders = useQuery({ queryKey: ["portal", "orders"], queryFn: () => portalApi<Order[]>("/portal/orders") });
  const requests = useQuery({ queryKey: ["portal", "requests"], queryFn: () => portalApi<Request[]>("/portal/requests") });
  async function withdraw(id: string) {
    if (!await askConfirm("Withdraw this order?")) return;
    await portalApi(`/portal/requests/${id}/withdraw`, { body: {} }).catch(() => null);
    qc.invalidateQueries({ queryKey: ["portal"] });
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Orders" description="Orders you have placed and their delivery progress." actions={<Button onClick={() => setPlacing(true)}><Plus className="size-4" aria-hidden /> New order</Button>} />
      {requests.data && requests.data.some((r) => r.status === "submitted" || r.status === "rejected") && (
        <Card>
          <CardHeader title="Placed on the portal" description="Our team confirms each order and turns it into an order with prices and delivery dates." />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {requests.data.filter((r) => r.status !== "accepted").map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <span className="font-mono text-xs">{r.number}</span>
                <span>{r.lines.length} item(s){r.customerPoNo && ` · PO ${r.customerPoNo}`}</span>
                <span className="text-xs text-muted">{formatDate(r.createdAt.slice(0, 10))}</span>
                {r.rejectReason && <span className="text-xs text-danger">{r.rejectReason}</span>}
                <Badge tone={REQ_TONE[r.status as keyof typeof REQ_TONE]} className="ml-auto">{r.status === "submitted" ? "awaiting confirmation" : r.status}</Badge>
                {r.status === "submitted" && <Button size="sm" variant="ghost" onClick={() => withdraw(r.id)}>Withdraw</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {orders.isLoading && <LoadingBlock />}
      {orders.error && <ErrorBlock error={orders.error} />}
      {orders.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Order</th><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Your PO</th><th className="px-4 py-2 text-right font-medium">Value</th><th className="px-4 py-2 font-medium">Delivered</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {orders.data.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2"><Link className="text-primary hover:underline" href={`/portal/orders/${o.id}`}>{o.number}</Link></td>
                  <td className="px-4 py-2">{formatDate(o.docDate)}</td>
                  <td className="px-4 py-2">{o.customerPoNo ?? "–"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(o.grandTotal)}</td>
                  <td className="px-4 py-2"><div className="h-1.5 w-24 rounded bg-surface-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.min(100, o.deliveredPct)}%` }} /></div><span className="text-xs text-muted">{o.deliveredPct} %</span></td>
                  <td className="px-4 py-2"><Badge tone={o.closedAt ? "neutral" : STATUS_META[o.status]?.tone}>{o.closedAt ? "closed" : STATUS_META[o.status]?.label ?? o.status}</Badge></td>
                </tr>
              ))}
              {!orders.data.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No orders yet.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
      {placing && <NewOrder onClose={() => setPlacing(false)} />}
    </div>
  );
}

function NewOrder({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["portal", "catalogue"], queryFn: () => portalApi<Item[]>("/portal/catalogue") });
  const [f, setF] = useState({ customerPoNo: "", expectedDate: "", notes: "" });
  const [lines, setLines] = useState([{ itemId: "", qty: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rate = (id: string) => items.data?.find((i) => i.id === id)?.sellingRate;
  const total = lines.reduce((s, l) => s + Number(rate(l.itemId) ?? 0) * Number(l.qty || 0), 0);
  async function save() {
    setError(null);
    setBusy(true);
    try {
      await portalApi("/portal/requests", { body: { customerPoNo: f.customerPoNo || null, expectedDate: f.expectedDate || null, notes: f.notes || null, lines: lines.filter((l) => l.itemId && Number(l.qty) > 0) } });
      await qc.invalidateQueries({ queryKey: ["portal"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} size="lg" title="New order" description="Prices shown are list prices; the confirmed order carries your agreed prices and taxes." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={!lines.some((l) => l.itemId && Number(l.qty) > 0)}>Place order</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Select aria-label="Item" className="flex-1" value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
              <option value="">Choose an item…</option>
              {items.data?.map((it) => <option key={it.id} value={it.id}>{it.code} · {it.name}{it.sellingRate ? ` · ${formatMoney(it.sellingRate)}/${it.uom ?? "unit"}` : ""}</option>)}
            </Select>
            <Input aria-label="Quantity" className="w-24" inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: "", qty: "" }])}><Trash2 className="size-3.5" aria-hidden /></Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { itemId: "", qty: "" }])}><Plus className="size-4" aria-hidden /> Item</Button>
          {total > 0 && <span className="text-sm text-muted">About {formatMoney(total)} before tax</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your PO number">{(p) => <Input {...p} value={f.customerPoNo} onChange={(e) => setF({ ...f, customerPoNo: e.target.value })} />}</Field>
          <Field label="Needed by">{(p) => <Input {...p} type="date" value={f.expectedDate} onChange={(e) => setF({ ...f, expectedDate: e.target.value })} />}</Field>
        </div>
        <Field label="Notes">{(p) => <Input {...p} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
