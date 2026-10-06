"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TaxSummary } from "@/components/documents/tax-summary";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty, todayIST } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { S, type SalesInvoice, type SalesPreview } from "@/lib/sales";

interface Billable {
  deliveryLines: { dlvLineId: string; deliveryId: string; deliveryNumber: string | null; deliveryDate: string; orderId: string; itemId: string; itemCode: string; itemName: string; uomId: string; uomCode: string; pendingQty: string; rate: string; discountPct: string; batchNo: string | null }[];
  orderLines: { soLineId: string; orderId: string; orderNumber: string | null; itemId: string; itemCode: string; itemName: string; isStockItem: boolean; description: string; uomId: string; uomCode: string; pendingQty: string; rate: string; discountPct: string }[];
}

interface Line {
  key: string;
  dlvLineId: string | null;
  soLineId: string | null;
  itemId: string;
  itemCode: string;
  description: string;
  uomId: string | null;
  qty: string;
  rate: string;
  discountPct: string;
  batchNo: string;
  maxQty: string | null;
  source: string;
  stock: boolean;
}

let seq = 0;
const key = () => `i${++seq}`;

export function InvoiceForm({ prefill }: { prefill?: { customer?: PickedParty; orderId?: string; deliveryId?: string } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [customer, setCustomer] = useState<PickedParty | null>(prefill?.customer ?? null);
  const [h, setH] = useState({ docDate: todayIST(), withLut: false, customerPoNo: "", warehouseId: "", transporter: "", vehicleNo: "", lrNo: "", creditDays: "", terms: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const billable = useQuery({ queryKey: ["sales", "billable", customer?.id], queryFn: () => api<Billable>(`${S.invoices}/billable`, { query: { customerId: customer!.id } }), enabled: !!customer });

  const used = new Set(lines.flatMap((l) => [l.dlvLineId, l.dlvLineId ? null : l.soLineId].filter(Boolean) as string[]));
  const addDlv = (d: Billable["deliveryLines"][number]) => setLines((ls) => [...ls, { key: key(), dlvLineId: d.dlvLineId, soLineId: null, itemId: d.itemId, itemCode: d.itemCode, description: d.itemName, uomId: d.uomId, qty: String(Number(d.pendingQty)), rate: String(Number(d.rate)), discountPct: Number(d.discountPct) ? String(Number(d.discountPct)) : "", batchNo: d.batchNo ?? "", maxQty: d.pendingQty, source: `Delivery ${d.deliveryNumber}`, stock: false }]);
  const addSo = (o: Billable["orderLines"][number]) => setLines((ls) => [...ls, { key: key(), dlvLineId: null, soLineId: o.soLineId, itemId: o.itemId, itemCode: o.itemCode, description: o.description, uomId: o.uomId, qty: String(Number(o.pendingQty)), rate: String(Number(o.rate)), discountPct: Number(o.discountPct) ? String(Number(o.discountPct)) : "", batchNo: "", maxQty: o.pendingQty, source: `Order ${o.orderNumber}${o.isStockItem ? " (dispatch with invoice)" : ""}`, stock: o.isStockItem }]);
  const addDirect = (it: PickedItem) => setLines((ls) => [...ls, { key: key(), dlvLineId: null, soLineId: null, itemId: it.id, itemCode: it.code, description: it.name, uomId: null, qty: "1", rate: "", discountPct: "", batchNo: "", maxQty: null, source: "Direct sale", stock: it.type !== "service" }]);

  // Coming from an order or delivery: bring its open lines in.
  if (!seeded && billable.data && (prefill?.orderId || prefill?.deliveryId)) {
    setSeeded(true);
    billable.data.deliveryLines.filter((d) => (prefill.deliveryId ? d.deliveryId === prefill.deliveryId : d.orderId === prefill.orderId)).forEach(addDlv);
    if (prefill.orderId && !prefill.deliveryId) billable.data.orderLines.filter((o) => o.orderId === prefill.orderId && !o.isStockItem).forEach(addSo);
  }

  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const ready = customer && lines.length > 0 && lines.every((l) => Number(l.qty) > 0);
  const payload = ready ? JSON.stringify({ customerId: customer!.id, withLut: h.withLut, lines: lines.map((l) => ({ itemId: l.itemId, uomId: l.uomId, qty: l.qty, rate: l.rate || null, discountPct: l.discountPct || null })) }) : null;
  const [debounced, setDebounced] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(payload), 350);
    return () => clearTimeout(t);
  }, [payload]);
  const preview = useQuery({ queryKey: ["sales", "preview", debounced], queryFn: () => api<SalesPreview>("/sales/preview", { body: JSON.parse(debounced!) }), enabled: !!debounced, placeholderData: (p) => p, retry: false });
  const needsWarehouse = lines.some((l) => !l.dlvLineId && l.stock);

  async function save(andSubmit: boolean) {
    setError(null);
    setErrors({});
    if (!customer) return setErrors({ customerId: "Choose the customer" });
    setBusy(true);
    try {
      const inv = await api<SalesInvoice>(S.invoices, {
        body: {
          customerId: customer.id,
          docDate: h.docDate,
          withLut: h.withLut,
          customerPoNo: h.customerPoNo || null,
          warehouseId: h.warehouseId || null,
          transporter: h.transporter || null,
          vehicleNo: h.vehicleNo || null,
          lrNo: h.lrNo || null,
          creditDays: h.creditDays ? Number(h.creditDays) : null,
          terms: h.terms || null,
          lines: lines.map((l) => ({ dlvLineId: l.dlvLineId, soLineId: l.dlvLineId ? null : l.soLineId, itemId: l.itemId, uomId: l.uomId, description: l.description, qty: l.qty, rate: l.rate || null, discountPct: l.discountPct || null, batchNo: l.batchNo || null })),
        },
      });
      if (andSubmit) await api(`${S.invoices}/${inv.id}/submit`, { body: { version: inv.version } });
      qc.invalidateQueries({ queryKey: [S.invoices] });
      qc.invalidateQueries({ queryKey: [S.orders] });
      router.push(`${S.invoices}/${inv.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  const dOpen = (billable.data?.deliveryLines ?? []).filter((d) => !used.has(d.dlvLineId));
  const oOpen = (billable.data?.orderLines ?? []).filter((o) => !used.has(o.soLineId));
  const p = preview.data;

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Customer & dispatch" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" required error={errors.customerId} className="sm:col-span-2">
            {(f) => <PartyPicker id={f.id} role="customer" value={customer} disabled={lines.length > 0} onChange={setCustomer} />}
          </Field>
          <Field label="Invoice date">{(f) => <Input {...f} type="date" max={todayIST()} value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}</Field>
          <Field label="Customer PO no.">{(f) => <Input {...f} value={h.customerPoNo} onChange={(e) => setH({ ...h, customerPoNo: e.target.value })} />}</Field>
          {needsWarehouse && (
            <Field label="Goods leave from" error={errors.warehouseId} hint="For lines not already delivered">
              {(f) => (
                <Select {...f} value={h.warehouseId} onChange={(e) => setH({ ...h, warehouseId: e.target.value })}>
                  <option value="">Order&apos;s / main store</option>
                  {(warehouses.data ?? []).filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Transporter">{(f) => <Input {...f} value={h.transporter} onChange={(e) => setH({ ...h, transporter: e.target.value })} />}</Field>
          <Field label="Vehicle no.">{(f) => <Input {...f} className="uppercase" value={h.vehicleNo} onChange={(e) => setH({ ...h, vehicleNo: e.target.value })} />}</Field>
          <Field label="Credit days" hint="Blank = order / customer">{(f) => <Input {...f} inputMode="numeric" value={h.creditDays} onChange={(e) => setH({ ...h, creditDays: e.target.value.replace(/\D/g, "") })} />}</Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Export / SEZ under LUT" checked={h.withLut} onChange={(e) => setH({ ...h, withLut: e.target.checked })} />
          </div>
        </div>
      </Card>

      {customer && (dOpen.length > 0 || oOpen.length > 0) && (
        <Card>
          <CardHeader title="Ready to invoice" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {dOpen.map((d) => (
              <li key={d.dlvLineId} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <Badge tone="success">Delivered</Badge>
                <span className="min-w-0 flex-1">{d.itemName} <span className="text-xs text-muted">· {d.deliveryNumber} of {formatDate(d.deliveryDate)}</span></span>
                <span className="tabular-nums">{formatQty(d.pendingQty)} {d.uomCode} @ {formatMoney(d.rate)}</span>
                <Button size="sm" variant="secondary" onClick={() => addDlv(d)}>Add</Button>
              </li>
            ))}
            {oOpen.map((o) => (
              <li key={o.soLineId} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <Badge>{o.isStockItem ? "Not delivered" : "Service"}</Badge>
                <span className="min-w-0 flex-1">{o.description} <span className="text-xs text-muted">· {o.orderNumber}</span></span>
                <span className="tabular-nums">{formatQty(o.pendingQty)} {o.uomCode} @ {formatMoney(o.rate)}</span>
                <Button size="sm" variant="secondary" onClick={() => addSo(o)}>Add</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Invoice lines" />
        {customer && <div className="px-5 pb-3"><ItemPicker onPick={addDirect} placeholder="Direct sale: add an item" /></div>}
        {lines.length > 0 && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Item</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Qty</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Rate</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Disc %</th>
                  <th className="w-32 px-2 py-2 font-medium">Batch</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {lines.map((l, i) => {
                  const err = (f: string) => errors[`lines.${i}.${f}`];
                  return (
                    <tr key={l.key}>
                      <td className="px-3 py-2.5 text-muted">{i + 1}</td>
                      <td className="px-2 py-2">
                        <p className="text-xs text-muted"><span className="font-mono">{l.itemCode}</span> · {l.source}</p>
                        <Input className="h-9" aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                        {(err("itemId") || err("rate")) && <p className="text-xs text-danger">{err("itemId") ?? err("rate")}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right" aria-label={`Line ${i + 1} quantity`} value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                        {l.maxQty && <p className="text-right text-xs text-muted">max {formatQty(l.maxQty)}</p>}
                        {err("qty") && <p className="text-xs text-danger">{err("qty")}</p>}
                      </td>
                      <td className="px-2 py-2"><Input inputMode="decimal" className="h-9 text-right" aria-label={`Line ${i + 1} rate`} placeholder="price list" value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input inputMode="decimal" className="h-9 text-right" aria-label={`Line ${i + 1} discount`} value={l.discountPct} onChange={(e) => update(l.key, { discountPct: e.target.value })} /></td>
                      <td className="px-2 py-2">
                        {!l.dlvLineId && l.stock ? <Input className="h-9 uppercase" aria-label={`Line ${i + 1} batch`} value={l.batchNo} onChange={(e) => update(l.key, { batchNo: e.target.value })} /> : <span className="font-mono text-xs text-muted">{l.batchNo || "—"}</span>}
                        {err("batchNo") && <p className="text-xs text-danger">{err("batchNo")}</p>}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{p?.lines[i] ? formatMoney(p.lines[i].taxableValue) : "—"}</td>
                      <td className="px-2 py-2"><Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4 text-danger" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-border px-5 py-4">{p ? <TaxSummary tax={p.header} stateTaxLabel={p.stateTaxLabel} totalLabel="Invoice total" /> : <p className="text-right text-sm text-muted">Add lines to see GST and the total.</p>}</div>
      </Card>
      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} disabled={!lines.length} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} disabled={!lines.length} onClick={() => save(true)}>Save & submit</Button>
      </div>
    </div>
  );
}
