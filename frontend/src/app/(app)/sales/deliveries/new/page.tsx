"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatQty, todayIST } from "@/lib/documents";
import type { BatchStock } from "@/lib/inventory";
import { useWarehouses } from "@/lib/masters";
import { S, type Delivery, type SalesOrderLine } from "@/lib/sales";

interface Deliverable {
  id: string;
  number: string | null;
  warehouseId: string | null;
  lines: (SalesOrderLine & { availableBaseQty: string | null })[];
}

export default function NewDeliveryPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewDelivery />
    </Suspense>
  );
}

function NewDelivery() {
  const orderId = useSearchParams().get("order");
  const order = useQuery({ queryKey: ["sales", "deliverable", orderId], queryFn: () => api<Deliverable>(`${S.orders}/${orderId}/deliverable`), enabled: !!orderId });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="New delivery" description="Pick what is going out. Stock leaves the warehouse when the delivery is posted." />
      {!orderId && <Alert tone="warning">Open the sales order and choose “Deliver”.</Alert>}
      {order.isLoading && orderId && <LoadingBlock />}
      {order.error && <ErrorBlock error={order.error} />}
      {order.data && <DeliveryForm order={order.data} />}
    </div>
  );
}

function DeliveryForm({ order }: { order: Deliverable }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const open = order.lines.filter((l) => l.isStockItem && Number(l.pendingQty) > 0);
  const [warehouseId, setWarehouseId] = useState(order.warehouseId ?? "");
  const [h, setH] = useState({ docDate: todayIST(), transporter: "", vehicleNo: "", lrNo: "", packages: "", grossWeightKg: "" });
  const [rows, setRows] = useState(() => Object.fromEntries(open.map((l) => [l.id, { qty: String(Number(l.pendingQty)), batchNo: "", serials: "", include: true }])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = open.filter((l) => rows[l.id].include);

  async function save(andPost: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const dlv = await api<Delivery>(S.deliveries, {
        body: {
          orderId: order.id,
          docDate: h.docDate,
          warehouseId: warehouseId || null,
          transporter: h.transporter || null,
          vehicleNo: h.vehicleNo || null,
          lrNo: h.lrNo || null,
          packages: h.packages ? Number(h.packages) : null,
          grossWeightKg: h.grossWeightKg || null,
          lines: chosen.map((l) => ({ soLineId: l.id, qty: rows[l.id].qty, batchNo: rows[l.id].batchNo || null, serialNos: rows[l.id].serials ? rows[l.id].serials.split(/[\s,]+/).filter(Boolean) : null })),
        },
      });
      if (andPost) await api(`${S.deliveries}/${dlv.id}/submit`, { body: { version: dlv.version } });
      qc.invalidateQueries({ queryKey: [S.deliveries] });
      qc.invalidateQueries({ queryKey: [S.orders] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      router.push(`${S.deliveries}/${dlv.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title={`Against ${order.number}`} />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Date">{(p) => <Input {...p} type="date" value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}</Field>
          <Field label="From" error={errors.warehouseId}>
            {(p) => (
              <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {(warehouses.data ?? []).filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Transporter">{(p) => <Input {...p} value={h.transporter} onChange={(e) => setH({ ...h, transporter: e.target.value })} />}</Field>
          <Field label="Vehicle no." error={errors.vehicleNo}>{(p) => <Input {...p} className="uppercase" value={h.vehicleNo} onChange={(e) => setH({ ...h, vehicleNo: e.target.value })} />}</Field>
          <Field label="LR no.">{(p) => <Input {...p} value={h.lrNo} onChange={(e) => setH({ ...h, lrNo: e.target.value })} />}</Field>
          <Field label="Packages / gross kg">
            {(p) => (
              <div className="flex gap-2">
                <Input {...p} inputMode="numeric" placeholder="Pkgs" value={h.packages} onChange={(e) => setH({ ...h, packages: e.target.value.replace(/\D/g, "") })} />
                <Input aria-label="Gross weight kg" inputMode="decimal" placeholder="kg" value={h.grossWeightKg} onChange={(e) => setH({ ...h, grossWeightKg: e.target.value })} />
              </div>
            )}
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Items to dispatch" />
        <ul className="divide-y divide-border border-t border-border">
          {open.map((l) => {
            const i = chosen.findIndex((c) => c.id === l.id);
            const err = (f: string) => (i >= 0 ? errors[`lines.${i}.${f}`] : undefined);
            const r = rows[l.id];
            return (
              <li key={l.id} className="space-y-2 px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <input type="checkbox" aria-label={`Include line ${l.lineNo}`} checked={r.include} onChange={(e) => setRows({ ...rows, [l.id]: { ...r, include: e.target.checked } })} />
                  <span className="min-w-0 flex-1">
                    {l.description} <span className="font-mono text-xs text-muted">{l.itemCode}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {formatQty(l.pendingQty)} {l.uomCode} to deliver{l.availableBaseQty !== null && ` · ${formatQty(l.availableBaseQty)} in stock (base unit)`}
                  </span>
                </div>
                {r.include && (
                  <div className="flex flex-wrap gap-3 pl-7">
                    <Field label={`Qty (${l.uomCode})`} error={err("qty")}>{(p) => <Input {...p} className="h-9 w-28 text-right" inputMode="decimal" value={r.qty} onChange={(e) => setRows({ ...rows, [l.id]: { ...r, qty: e.target.value } })} />}</Field>
                    {l.trackBatch && <BatchPick itemId={l.itemId} warehouseId={warehouseId} value={r.batchNo} error={err("batchNo")} onChange={(b) => setRows({ ...rows, [l.id]: { ...r, batchNo: b } })} />}
                    {l.trackSerial && <Field label="Serial numbers" error={err("serialNos")}>{(p) => <Input {...p} className="h-9 w-80 font-mono uppercase" placeholder="Comma separated" value={r.serials} onChange={(e) => setRows({ ...rows, [l.id]: { ...r, serials: e.target.value } })} />}</Field>}
                  </div>
                )}
              </li>
            );
          })}
          {!open.length && <li className="px-5 py-4 text-sm text-muted">Nothing left to deliver on this order.</li>}
        </ul>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} disabled={!chosen.length} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} disabled={!chosen.length} onClick={() => save(true)}>Save & dispatch</Button>
      </div>
    </div>
  );
}

function BatchPick({ itemId, warehouseId, value, error, onChange }: { itemId: string; warehouseId: string; value: string; error?: string; onChange: (v: string) => void }) {
  const batches = useQuery({ queryKey: ["inventory", "batches", itemId, warehouseId], queryFn: () => api<BatchStock[]>("/inventory/batches", { query: { itemId, warehouseId } }), enabled: !!warehouseId });
  return (
    <Field label="Batch (earliest expiry first)" error={error}>
      {(p) => (
        <Select {...p} className="h-9 w-64" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(batches.data ?? []).map((b) => (
            <option key={b.batchId} value={b.batchNo} disabled={b.expired}>
              {b.batchNo} · {formatQty(b.qty)}{b.expiryDate ? ` · exp ${formatDate(b.expiryDate)}` : ""}{b.expired ? " (expired)" : ""}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
