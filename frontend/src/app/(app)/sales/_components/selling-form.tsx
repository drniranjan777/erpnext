"use client";

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TaxSummary } from "@/components/documents/tax-summary";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty, todayIST } from "@/lib/documents";
import { useUoms, useWarehouses, type Item } from "@/lib/masters";
import type { Quotation, SalesOrder, SalesPreview } from "@/lib/sales";

export type SellingMode = "quotation" | "order";

interface Line {
  key: string;
  id?: string;
  itemId: string;
  itemCode: string;
  description: string;
  uomId: string | null;
  qty: string;
  rate: string;
  discountPct: string;
  deliveryDate: string;
  quotationLineId: string | null;
  done: number;
}

let seq = 0;
const key = () => `s${++seq}`;
const num = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

type Existing = Quotation | SalesOrder;

/** Quotation and sales order editor with live pricing: price list rates, GST to the ship-to state, margin. */
export function SellingForm({ mode, api: base, existing }: { mode: SellingMode; api: string; existing?: Existing }) {
  const router = useRouter();
  const qc = useQueryClient();
  const uoms = useUoms();
  const warehouses = useWarehouses();
  const order = mode === "order" ? (existing as SalesOrder | undefined) : undefined;
  const quote = mode === "quotation" ? (existing as Quotation | undefined) : undefined;
  const [customer, setCustomer] = useState<PickedParty | null>(existing ? { id: existing.customer.id, code: existing.customer.code, name: existing.customer.name, gstin: existing.customer.gstin, stateCode: existing.customer.stateCode, creditDays: existing.creditDays } : null);
  const [h, setH] = useState({
    docDate: existing?.docDate ?? todayIST(),
    withLut: existing?.withLut ?? false,
    paymentTerms: existing?.paymentTerms ?? "",
    creditDays: existing?.creditDays?.toString() ?? "",
    terms: existing?.terms ?? "",
    notes: existing?.notes ?? "",
    validUntil: quote?.validUntil ?? "",
    customerEnquiryRef: quote?.customerEnquiryRef ?? "",
    customerPoNo: order?.customerPoNo ?? "",
    customerPoDate: order?.customerPoDate ?? "",
    expectedDate: order?.expectedDate ?? "",
    warehouseId: order?.warehouse?.id ?? "",
  });
  const [lines, setLines] = useState<Line[]>(
    (existing?.lines ?? []).map((l) => ({
      key: key(),
      id: mode === "order" ? l.id : undefined,
      itemId: l.itemId,
      itemCode: l.itemCode,
      description: l.description,
      uomId: l.uomId,
      qty: String(Number(l.qty)),
      rate: String(Number(l.rate)),
      discountPct: Number(l.discountPct) ? String(Number(l.discountPct)) : "",
      deliveryDate: ("deliveryDate" in l ? (l.deliveryDate as string | null) : null) ?? "",
      quotationLineId: ("quotationLineId" in l ? (l.quotationLineId as string | null) : null) ?? null,
      done: "deliveredQty" in l ? Math.max(Number(l.deliveredQty), Number((l as { invoicedQty: string }).invoicedQty)) : 0,
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const details = useQueries({ queries: itemIds.map((id) => ({ queryKey: ["masters", "items", id], queryFn: () => api<Item>(`/masters/items/${id}`), staleTime: 60_000 })) });
  const itemById = new Map(details.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])));
  const uomCode = (id: string) => uoms.data?.find((u) => u.id === id)?.code ?? "";
  // Available to promise (on hand − reserved by other orders), orders only.
  const atp = useQuery({
    queryKey: ["sales", "atp", itemIds.join(","), h.warehouseId],
    queryFn: () => api<{ itemId: string; available: string; onOrder: string; nextReceipt: string | null }[]>("/sales/atp", { query: { itemIds: itemIds.join(","), ...(h.warehouseId ? { warehouseId: h.warehouseId } : {}) } }),
    enabled: mode === "order" && itemIds.length > 0,
    staleTime: 30_000,
  });
  const atpFor = (itemId: string) => atp.data?.find((a) => a.itemId === itemId);
  const unitsFor = (it: Item) => [{ uomId: it.baseUomId, uom: uomCode(it.baseUomId) }, ...it.conversions];

  // Live pricing (rate blank = price list).
  const ready = customer && lines.length > 0 && lines.every((l) => num(l.qty) && Number(l.qty) > 0 && (!l.rate || num(l.rate)) && (!l.discountPct || num(l.discountPct)));
  const payload = ready ? JSON.stringify({ customerId: customer!.id, withLut: h.withLut, lines: lines.map((l) => ({ itemId: l.itemId, uomId: l.uomId, qty: l.qty, rate: l.rate || null, discountPct: l.discountPct || null })) }) : null;
  const [debounced, setDebounced] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(payload), 350);
    return () => clearTimeout(t);
  }, [payload]);
  const preview = useQuery({ queryKey: ["sales", "preview", debounced], queryFn: () => api<SalesPreview>("/sales/preview", { body: JSON.parse(debounced!) }), enabled: !!debounced, placeholderData: (p) => p, retry: false });

  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  async function addItem(it: PickedItem) {
    const full = await qc.fetchQuery({ queryKey: ["masters", "items", it.id], queryFn: () => api<Item>(`/masters/items/${it.id}`), staleTime: 60_000 });
    setLines((ls) => [...ls, { key: key(), itemId: it.id, itemCode: it.code, description: it.name, uomId: full.salesUomId ?? full.baseUomId, qty: "1", rate: "", discountPct: "", deliveryDate: "", quotationLineId: null, done: 0 }]);
  }

  async function save(andSubmit: boolean) {
    setError(null);
    setErrors({});
    if (!customer) return setErrors({ customerId: "Choose the customer" });
    setBusy(true);
    const common = {
      customerId: customer.id,
      docDate: h.docDate,
      withLut: h.withLut,
      paymentTerms: h.paymentTerms || null,
      creditDays: h.creditDays ? Number(h.creditDays) : null,
      terms: h.terms || null,
      notes: h.notes || null,
      lines: lines.map((l) => ({ id: l.id, itemId: l.itemId, uomId: l.uomId, description: l.description || null, qty: l.qty, rate: l.rate || null, discountPct: l.discountPct || null, deliveryDate: l.deliveryDate || null, quotationLineId: l.quotationLineId })),
    };
    const body =
      mode === "quotation"
        ? { ...common, validUntil: h.validUntil || null, customerEnquiryRef: h.customerEnquiryRef || null }
        : { ...common, customerPoNo: h.customerPoNo || null, customerPoDate: h.customerPoDate || null, expectedDate: h.expectedDate || null, warehouseId: h.warehouseId || null, quotationId: order?.quotationId ?? null };
    try {
      const doc = existing ? await api<Existing>(`${base}/${existing.id}`, { method: "PUT", body: { ...body, version: existing.version } }) : await api<Existing>(base, { body });
      if (andSubmit) await api(`${base}/${doc.id}/submit`, { body: { version: doc.version } });
      qc.invalidateQueries({ queryKey: [base] });
      router.push(`${base}/${doc.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.status === 403 && mode === "order" ? `${e.message} The order was saved as a draft; open it to submit with a reason.` : e.message);
      } else setError("Could not reach the server. Please try again.");
    }
  }

  const p = preview.data;
  const amended = !!existing && existing.revision > 0;

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
        <CardHeader title="Customer" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" required error={errors.customerId} className="sm:col-span-2">
            {(f) => <PartyPicker id={f.id} role="customer" value={customer} disabled={amended} onChange={(c) => { setCustomer(c); if (c?.creditDays && !h.creditDays) setH((x) => ({ ...x, creditDays: String(c.creditDays) })); }} />}
          </Field>
          <Field label="Date" required error={errors.docDate}>
            {(f) => <Input {...f} type="date" disabled={!!existing?.number} value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}
          </Field>
          {mode === "quotation" ? (
            <Field label="Valid until" error={errors.validUntil}>
              {(f) => <Input {...f} type="date" min={todayIST()} value={h.validUntil} onChange={(e) => setH({ ...h, validUntil: e.target.value })} />}
            </Field>
          ) : (
            <Field label="Dispatch by" error={errors.expectedDate}>
              {(f) => <Input {...f} type="date" value={h.expectedDate} onChange={(e) => setH({ ...h, expectedDate: e.target.value })} />}
            </Field>
          )}
          {mode === "quotation" ? (
            <Field label="Customer enquiry ref.">{(f) => <Input {...f} value={h.customerEnquiryRef} onChange={(e) => setH({ ...h, customerEnquiryRef: e.target.value })} />}</Field>
          ) : (
            <>
              <Field label="Customer PO no." error={errors.customerPoNo}>{(f) => <Input {...f} value={h.customerPoNo} onChange={(e) => setH({ ...h, customerPoNo: e.target.value })} />}</Field>
              <Field label="PO date">{(f) => <Input {...f} type="date" value={h.customerPoDate} onChange={(e) => setH({ ...h, customerPoDate: e.target.value })} />}</Field>
              <Field label="Dispatch from" hint="Blank = main store" error={errors.warehouseId}>
                {(f) => (
                  <Select {...f} value={h.warehouseId} onChange={(e) => setH({ ...h, warehouseId: e.target.value })}>
                    <option value="">Main store</option>
                    {(warehouses.data ?? []).filter((w) => w.isActive).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} · {w.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          <Field label="Credit days">{(f) => <Input {...f} inputMode="numeric" value={h.creditDays} onChange={(e) => setH({ ...h, creditDays: e.target.value.replace(/\D/g, "") })} />}</Field>
          <Field label="Payment terms" className="sm:col-span-2">{(f) => <Input {...f} placeholder="e.g. 50% advance, balance before dispatch" value={h.paymentTerms} onChange={(e) => setH({ ...h, paymentTerms: e.target.value })} />}</Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Export / SEZ under LUT" description="Zero-rated, no IGST" checked={h.withLut} onChange={(e) => setH({ ...h, withLut: e.target.checked })} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Items" description="Leave the rate blank to use the price list. Rates are before GST." />
        <div className="px-5 pb-3">
          <ItemPicker onPick={addItem} placeholder="Add an item: search or scan" />
          {errors.lines && <p className="mt-1 text-xs text-danger">{errors.lines}</p>}
        </div>
        {lines.length > 0 && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-8 px-3 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Item</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Qty</th>
                  <th className="w-24 px-2 py-2 font-medium">Unit</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Rate (₹)</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Disc %</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Amount</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Margin</th>
                  {mode === "order" && <th className="w-36 px-2 py-2 font-medium">Deliver by</th>}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {lines.map((l, i) => {
                  const it = itemById.get(l.itemId);
                  const pl = p?.lines[i];
                  const err = (f: string) => errors[`lines.${i}.${f}`];
                  const margin = pl?.unitCost && Number(pl.taxableValue) ? ((Number(pl.taxableValue) - Number(pl.unitCost) * Number(l.qty)) * 100) / Number(pl.taxableValue) : null;
                  return (
                    <tr key={l.key}>
                      <td className="px-3 py-2.5 text-muted">{i + 1}</td>
                      <td className="px-2 py-2">
                        <p className="font-mono text-xs text-muted">
                          {l.itemCode}
                          {l.done > 0 && <span className="font-sans"> · {l.done} delivered/invoiced</span>}
                        </p>
                        <Input className="h-9" aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                        {(err("itemId") || err("rate")) && <p className="mt-1 text-xs text-danger">{err("itemId") ?? err("rate")}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} quantity`} aria-invalid={!!err("qty")} value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                        {err("qty") && <p className="text-xs text-danger">{err("qty")}</p>}
                        {mode === "order" && it && it.type !== "service" && atpFor(l.itemId) && (
                          <p className={`text-right text-xs ${Number(atpFor(l.itemId)!.available) <= 0 ? "text-danger" : "text-muted"}`} title={atpFor(l.itemId)!.nextReceipt ? `${formatQty(atpFor(l.itemId)!.onOrder)} on order, next ${formatDate(atpFor(l.itemId)!.nextReceipt)}` : undefined}>
                            {formatQty(atpFor(l.itemId)!.available)} free
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Select className="h-9" aria-label={`Line ${i + 1} unit`} disabled={!it || l.done > 0} value={l.uomId ?? ""} onChange={(e) => update(l.key, { uomId: e.target.value })}>
                          {it ? unitsFor(it).map((u) => <option key={u.uomId} value={u.uomId}>{u.uom}</option>) : <option>{uomCode(l.uomId ?? "")}</option>}
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} rate`} placeholder={pl?.listRate ? String(Number(pl.listRate)) : "price list"} value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} discount`} value={l.discountPct} onChange={(e) => update(l.key, { discountPct: e.target.value })} />
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{pl ? formatMoney(pl.taxableValue) : "—"}</td>
                      <td className={`px-2 py-2.5 text-right tabular-nums ${margin !== null && margin < 10 ? "text-danger" : "text-muted"}`}>{margin === null ? "—" : `${margin.toFixed(1)}%`}</td>
                      {mode === "order" && (
                        <td className="px-2 py-2">
                          <Input type="date" className="h-9" aria-label={`Line ${i + 1} deliver by`} value={l.deliveryDate} onChange={(e) => update(l.key, { deliveryDate: e.target.value })} />
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <Button type="button" variant="ghost" size="sm" disabled={l.done > 0} aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          <Trash2 className="size-4 text-danger" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-2">
          <div className="text-sm text-muted">
            {p && (
              <>
                <p>
                  Cost <span className="tabular-nums text-foreground">{formatMoney(p.header.costTotal)}</span> · margin{" "}
                  <span className={`tabular-nums ${p.header.marginPct !== null && Number(p.header.marginPct) < 10 ? "text-danger" : "text-foreground"}`}>{p.header.marginPct === null ? "—" : `${Number(p.header.marginPct).toFixed(1)}%`}</span>
                </p>
                {Number(p.header.maxDiscountPct) > 0 && <p>Largest discount below list price: {Number(p.header.maxDiscountPct).toFixed(1)}%</p>}
              </>
            )}
            {preview.error && <p className="text-danger">{preview.error instanceof ApiError ? preview.error.message : "Could not price the lines"}</p>}
          </div>
          {p ? <TaxSummary tax={p.header} stateTaxLabel={p.stateTaxLabel} totalLabel={mode === "quotation" ? "Quoted total" : "Order total"} /> : <p className="text-right text-sm text-muted">{customer ? "Add items to see prices and GST." : "Choose a customer to price the items."}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Terms & notes" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Terms (printed)">{(f) => <textarea {...f} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={h.terms} onChange={(e) => setH({ ...h, terms: e.target.value })} />}</Field>
          <Field label="Internal notes">{(f) => <textarea {...f} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />}</Field>
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
          Save & submit
        </Button>
      </div>
    </form>
  );
}
