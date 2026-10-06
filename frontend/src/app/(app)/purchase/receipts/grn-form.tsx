"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatMoney, formatQty, todayIST } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { GRN_API, GRN_ROUTE, PO_API, type GoodsReceipt, type Receivable } from "@/lib/purchase";

interface Line {
  key: string;
  poLineId: string;
  receivedQty: string;
  rejectedQty: string;
  rejectionReason: string;
  batchNo: string;
  mfgDate: string;
  expiryDate: string;
  serials: string;
  remarks: string;
}

let seq = 0;
const key = () => `g${++seq}`;
const serialList = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/** Receive against a PO: every pending line is pre-filled with its open quantity. */
export function GrnForm({ poId, existing }: { poId: string; existing?: GoodsReceipt }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const po = useQuery({ queryKey: ["purchase", "receivable", poId], queryFn: () => api<Receivable>(`${PO_API}/${poId}/receivable`) });
  const [h, setH] = useState({
    docDate: existing?.docDate ?? todayIST(),
    warehouseId: existing?.warehouse.id ?? "",
    supplierInvoiceNo: existing?.supplierInvoiceNo ?? "",
    supplierInvoiceDate: existing?.supplierInvoiceDate ?? "",
    challanNo: existing?.challanNo ?? "",
    gateEntryNo: existing?.gateEntryNo ?? "",
    vehicleNo: existing?.vehicleNo ?? "",
    transporter: existing?.transporter ?? "",
    lrNo: existing?.lrNo ?? "",
    notes: existing?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[] | null>(
    existing
      ? existing.lines.map((l) => ({
          key: key(),
          poLineId: l.poLineId,
          receivedQty: String(Number(l.receivedQty)),
          rejectedQty: Number(l.rejectedQty) ? String(Number(l.rejectedQty)) : "",
          rejectionReason: l.rejectionReason ?? "",
          batchNo: l.batchNo ?? "",
          mfgDate: l.mfgDate ?? "",
          expiryDate: l.expiryDate ?? "",
          serials: (l.serialNos ?? []).join("\n"),
          remarks: l.remarks ?? "",
        }))
      : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed lines from the PO's pending quantities once it loads.
  if (!lines && po.data) {
    setLines(
      po.data.lines
        .filter((l) => Number(l.pendingQty) > 0)
        .map((l) => ({ key: key(), poLineId: l.id, receivedQty: String(Number(l.pendingQty)), rejectedQty: "", rejectionReason: "", batchNo: "", mfgDate: "", expiryDate: "", serials: "", remarks: "" })),
    );
  }

  if (po.isLoading || !lines) return po.error ? <ErrorBlock error={po.error} /> : <LoadingBlock />;
  const poLine = (id: string) => po.data!.lines.find((l) => l.id === id)!;
  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls!.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => {
    const pl = poLine(l.poLineId);
    const accepted = Number(l.receivedQty || 0) - Number(l.rejectedQty || 0);
    return s + (pl && accepted > 0 ? (accepted * Number(pl.taxableValue)) / Number(pl.qty) : 0);
  }, 0);

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      poId,
      docDate: h.docDate,
      warehouseId: h.warehouseId || null,
      supplierInvoiceNo: h.supplierInvoiceNo || null,
      supplierInvoiceDate: h.supplierInvoiceDate || null,
      challanNo: h.challanNo || null,
      gateEntryNo: h.gateEntryNo || null,
      vehicleNo: h.vehicleNo || null,
      transporter: h.transporter || null,
      lrNo: h.lrNo || null,
      notes: h.notes || null,
      lines: lines!.map((l) => ({
        poLineId: l.poLineId,
        receivedQty: l.receivedQty || "0",
        rejectedQty: l.rejectedQty || "0",
        rejectionReason: l.rejectionReason || null,
        batchNo: l.batchNo || null,
        mfgDate: l.mfgDate || null,
        expiryDate: l.expiryDate || null,
        serialNos: serialList(l.serials).length ? serialList(l.serials) : null,
        remarks: l.remarks || null,
      })),
    };
    try {
      const grn = existing ? await api<GoodsReceipt>(`${GRN_API}/${existing.id}`, { method: "PUT", body: { ...body, version: existing.version } }) : await api<GoodsReceipt>(GRN_API, { body });
      if (andSubmit) await api(`${GRN_API}/${grn.id}/submit`, { body: { version: grn.version } });
      qc.invalidateQueries({ queryKey: [GRN_ROUTE] });
      qc.invalidateQueries({ queryKey: ["/purchase/orders"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      router.push(`${GRN_ROUTE}/${grn.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server. Please try again.");
    }
  }

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title={`Against ${po.data!.number}`} description={Number(po.data!.tolerancePct) ? `Up to ${Number(po.data!.tolerancePct)}% over the ordered quantity can be accepted.` : "Quantities can't exceed what was ordered."} />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Receipt date" required error={errors.docDate}>
            {(p) => <Input {...p} type="date" disabled={!!existing?.number} value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}
          </Field>
          <Field label="Received into" error={errors.warehouseId} hint="Blank = the PO's delivery warehouse">
            {(p) => (
              <Select {...p} value={h.warehouseId} onChange={(e) => setH({ ...h, warehouseId: e.target.value })}>
                <option value="">As per PO</option>
                {(warehouses.data ?? [])
                  .filter((w) => w.isActive)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                      {!w.isNettable ? " (quality hold)" : ""}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Supplier invoice no." error={errors.supplierInvoiceNo}>
            {(p) => <Input {...p} value={h.supplierInvoiceNo} onChange={(e) => setH({ ...h, supplierInvoiceNo: e.target.value })} />}
          </Field>
          <Field label="Invoice date" error={errors.supplierInvoiceDate}>
            {(p) => <Input {...p} type="date" value={h.supplierInvoiceDate} onChange={(e) => setH({ ...h, supplierInvoiceDate: e.target.value })} />}
          </Field>
          <Field label="Delivery challan" error={errors.challanNo}>
            {(p) => <Input {...p} value={h.challanNo} onChange={(e) => setH({ ...h, challanNo: e.target.value })} />}
          </Field>
          <Field label="Gate entry no." error={errors.gateEntryNo}>
            {(p) => <Input {...p} value={h.gateEntryNo} onChange={(e) => setH({ ...h, gateEntryNo: e.target.value })} />}
          </Field>
          <Field label="Vehicle no." error={errors.vehicleNo}>
            {(p) => <Input {...p} className="uppercase" placeholder="TS09EA1234" value={h.vehicleNo} onChange={(e) => setH({ ...h, vehicleNo: e.target.value })} />}
          </Field>
          <Field label="Transporter / LR no." error={errors.lrNo}>
            {(p) => (
              <div className="flex gap-2">
                <Input {...p} placeholder="Transporter" value={h.transporter} onChange={(e) => setH({ ...h, transporter: e.target.value })} />
                <Input aria-label="LR number" placeholder="LR no." className="w-28" value={h.lrNo} onChange={(e) => setH({ ...h, lrNo: e.target.value })} />
              </div>
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Items received" action={<span className="text-sm text-muted">Accepted value <strong className="ml-1 text-foreground tabular-nums">{formatMoney(total)}</strong></span>} />
        {errors.lines && <p className="px-5 pb-2 text-xs text-danger">{errors.lines}</p>}
        <ul className="divide-y divide-border border-t border-border">
          {lines.map((l, i) => {
            const pl = poLine(l.poLineId);
            const err = (f: string) => errors[`lines.${i}.${f}`];
            const rejected = Number(l.rejectedQty || 0) > 0;
            return (
              <li key={l.key} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    <span className="text-muted">{pl.lineNo}.</span> {pl.description} <span className="font-mono text-xs text-muted">{pl.itemCode}</span>
                  </p>
                  <p className="text-xs text-muted">
                    Ordered {formatQty(pl.qty)} {pl.uomCode} · received so far {formatQty(pl.receivedQty)} · up to {formatQty(pl.maxReceivableQty)} more
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Field label={`Received (${pl.uomCode})`} required error={err("receivedQty")}>
                    {(p) => <Input {...p} inputMode="decimal" className="text-right tabular-nums" value={l.receivedQty} onChange={(e) => update(l.key, { receivedQty: e.target.value })} />}
                  </Field>
                  <Field label="Rejected" error={err("rejectedQty")}>
                    {(p) => <Input {...p} inputMode="decimal" className="text-right tabular-nums" value={l.rejectedQty} onChange={(e) => update(l.key, { rejectedQty: e.target.value })} />}
                  </Field>
                  {rejected && (
                    <Field label="Why rejected" required error={err("rejectionReason")} className="sm:col-span-2">
                      {(p) => <Input {...p} placeholder="Damaged, wrong grade, short weight…" value={l.rejectionReason} onChange={(e) => update(l.key, { rejectionReason: e.target.value })} />}
                    </Field>
                  )}
                  {pl.trackBatch && (
                    <>
                      <Field label="Batch no." required error={err("batchNo")}>
                        {(p) => <Input {...p} className="uppercase" value={l.batchNo} onChange={(e) => update(l.key, { batchNo: e.target.value })} />}
                      </Field>
                      {pl.hasExpiry && (
                        <>
                          <Field label="Mfg date" error={err("mfgDate")}>
                            {(p) => <Input {...p} type="date" value={l.mfgDate} onChange={(e) => update(l.key, { mfgDate: e.target.value })} />}
                          </Field>
                          <Field label="Expiry" error={err("expiryDate")}>
                            {(p) => <Input {...p} type="date" value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />}
                          </Field>
                        </>
                      )}
                    </>
                  )}
                </div>
                {pl.trackSerial && (
                  <Field label={`Serial numbers (${serialList(l.serials).length})`} required error={err("serialNos")} hint="One per unit accepted, separated by commas or new lines">
                    {(p) => <textarea {...p} rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm uppercase" value={l.serials} onChange={(e) => update(l.key, { serials: e.target.value })} />}
                  </Field>
                )}
                <div className="flex flex-wrap gap-2">
                  {pl.trackBatch && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls!.slice(0, i + 1), { ...l, key: key(), receivedQty: "", rejectedQty: "", batchNo: "", serials: "" }, ...ls!.slice(i + 1)])}>
                      <Copy className="size-3.5" aria-hidden /> Another batch
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => ls!.filter((x) => x.key !== l.key))}>
                    <Trash2 className="size-3.5 text-danger" aria-hidden /> Not received
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        {!lines.length && <p className="px-5 py-6 text-center text-sm text-muted">Nothing left to receive on this order.</p>}
      </Card>

      <Card>
        <CardHeader title="Notes" />
        <div className="px-5 py-4">
          <textarea rows={2} aria-label="Notes" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" loading={busy} disabled={!lines.length}>
          Save draft
        </Button>
        <Button type="button" loading={busy} disabled={!lines.length} onClick={() => save(true)}>
          Save & post to stock
        </Button>
      </div>
    </form>
  );
}
