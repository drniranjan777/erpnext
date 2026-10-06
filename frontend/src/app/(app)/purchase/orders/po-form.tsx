"use client";

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomFieldInputs, useCustomFields, type CustomValues } from "@/components/custom-fields";
import { TaxSummary } from "@/components/documents/tax-summary";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { formatMoney, todayIST } from "@/lib/documents";
import { useUoms, useWarehouses, type Item } from "@/lib/masters";
import { PO_API, PO_ROUTE, type PurchaseOrder, type TaxTotals } from "@/lib/purchase";

interface Line {
  key: string;
  id?: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomId: string;
  description: string;
  qty: string;
  rate: string;
  discountPct: string;
  deliveryDate: string;
  requisitionLineId: string | null;
  remarks: string;
  receivedQty: string;
}

interface Preview {
  tax: TaxTotals;
  stateTaxLabel: string;
  lines: { taxableValue: string; gstRate: string; lineTotal: string; cgstAmount: string; sgstAmount: string; igstAmount: string }[];
}

let seq = 0;
const key = () => `l${++seq}`;
const num = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());

function fromExisting(po?: PurchaseOrder): Line[] {
  return (po?.lines ?? []).map((l) => ({
    key: key(),
    id: l.id,
    itemId: l.itemId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    uomId: l.uomId,
    description: l.description,
    qty: String(Number(l.qty)),
    rate: String(Number(po && po.currency !== "INR" && l.foreignRate ? l.foreignRate : l.rate)),
    discountPct: Number(l.discountPct) ? String(Number(l.discountPct)) : "",
    deliveryDate: l.deliveryDate ?? "",
    requisitionLineId: l.requisitionLineId,
    remarks: l.remarks ?? "",
    receivedQty: l.receivedQty,
  }));
}

export function PoForm({ existing }: { existing?: PurchaseOrder }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const uoms = useUoms();
  const customDefs = useCustomFields("purchase_order");
  const amendment = !!existing && existing.revision > 0;
  const [vendor, setVendor] = useState<PickedParty | null>(
    existing ? { id: existing.vendor.id, code: existing.vendor.code, name: existing.vendor.name, gstin: existing.vendor.gstin, stateCode: existing.vendor.stateCode, creditDays: existing.creditDays } : null,
  );
  const [h, setH] = useState({
    docDate: existing?.docDate ?? todayIST(),
    poType: existing?.poType ?? "standard",
    deliveryWarehouseId: existing?.deliveryWarehouse?.id ?? "",
    expectedDate: existing?.expectedDate ?? "",
    vendorQuoteRef: existing?.vendorQuoteRef ?? "",
    paymentTerms: existing?.paymentTerms ?? "",
    creditDays: existing?.creditDays?.toString() ?? "",
    tolerancePct: existing && Number(existing.tolerancePct) ? String(Number(existing.tolerancePct)) : "",
    reverseCharge: existing?.reverseCharge ?? false,
    currency: existing?.currency ?? "INR",
    exchangeRate: existing?.exchangeRate && existing.currency !== "INR" ? String(Number(existing.exchangeRate)) : "",
    terms: existing?.terms ?? "",
    notes: existing?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(fromExisting(existing));
  const [custom, setCustom] = useState<CustomValues>(existing?.customFields ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Units each item can be bought in.
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const details = useQueries({ queries: itemIds.map((id) => ({ queryKey: ["masters", "items", id], queryFn: () => api<Item>(`/masters/items/${id}`), staleTime: 60_000 })) });
  const itemById = new Map(details.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])));
  const uomCode = (id: string) => uoms.data?.find((u) => u.id === id)?.code ?? "";
  const unitsFor = (it: Item) => [{ uomId: it.baseUomId, uom: uomCode(it.baseUomId), factor: "1" }, ...it.conversions];

  // Live GST: re-priced on the server (same engine as saving) shortly after each change.
  const foreign = h.currency !== "INR";
  const fx = foreign ? Number(h.exchangeRate) || 0 : 1;
  const inr = (rate: string) => (foreign ? String(Math.round(Number(rate) * fx * 10000) / 10000) : rate);
  const pricable = vendor && (!foreign || fx > 0) && lines.length > 0 && lines.every((l) => num(l.qty) && Number(l.qty) > 0 && num(l.rate) && (!l.discountPct || num(l.discountPct)));
  const payload = pricable
    ? { vendorId: vendor!.id, reverseCharge: h.reverseCharge, lines: lines.map((l) => ({ itemId: l.itemId, uomId: l.uomId, qty: l.qty, rate: inr(l.rate), discountPct: l.discountPct || null })) }
    : null;
  const [debounced, setDebounced] = useState(payload);
  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(payloadKey === "null" ? null : JSON.parse(payloadKey)), 350);
    return () => clearTimeout(t);
  }, [payloadKey]);
  const preview = useQuery({
    queryKey: ["purchase", "preview-tax", debounced],
    queryFn: () => api<Preview>(`${PO_API}/preview-tax`, { body: debounced }),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  async function addItem(picked: PickedItem) {
    const it = await qc.fetchQuery({ queryKey: ["masters", "items", picked.id], queryFn: () => api<Item>(`/masters/items/${picked.id}`), staleTime: 60_000 });
    const uomId = it.purchaseUomId ?? it.baseUomId;
    const factor = uomId === it.baseUomId ? 1 : Number(it.conversions.find((c) => c.uomId === uomId)?.factor ?? 1);
    const base = it.lastPurchaseRate ?? it.standardCost;
    setLines((ls) => [
      ...ls,
      { key: key(), itemId: it.id, itemCode: it.code, itemName: it.name, uomId, description: it.name, qty: "", rate: base ? String(Math.round(Number(base) * factor * 10000) / 10000) : "", discountPct: "", deliveryDate: "", requisitionLineId: null, remarks: "", receivedQty: "0" },
    ]);
  }

  async function save(andSubmit: boolean) {
    setError(null);
    setErrors({});
    if (!vendor) return setErrors({ vendorId: "Choose the vendor" });
    if (!lines.length) return setError("Add at least one item.");
    setBusy(true);
    const body = {
      vendorId: vendor.id,
      docDate: h.docDate,
      poType: h.poType,
      deliveryWarehouseId: h.deliveryWarehouseId || null,
      expectedDate: h.expectedDate || null,
      vendorQuoteRef: h.vendorQuoteRef || null,
      paymentTerms: h.paymentTerms || null,
      creditDays: h.creditDays ? Number(h.creditDays) : null,
      tolerancePct: h.tolerancePct || null,
      reverseCharge: h.reverseCharge,
      currency: h.currency,
      exchangeRate: foreign ? h.exchangeRate || null : null,
      terms: h.terms || null,
      notes: h.notes || null,
      customFields: custom,
      lines: lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        uomId: l.uomId,
        description: l.description || null,
        qty: l.qty,
        rate: inr(l.rate),
        foreignRate: foreign ? l.rate : null,
        discountPct: l.discountPct || null,
        deliveryDate: l.deliveryDate || null,
        requisitionLineId: l.requisitionLineId,
        remarks: l.remarks || null,
      })),
    };
    try {
      const po = existing ? await api<PurchaseOrder>(`${PO_API}/${existing.id}`, { method: "PUT", body: { ...body, version: existing.version } }) : await api<PurchaseOrder>(PO_API, { body });
      if (andSubmit) await api(`${PO_API}/${po.id}/submit`, { body: { version: po.version } });
      qc.invalidateQueries({ queryKey: [PO_ROUTE] });
      router.push(`${PO_ROUTE}/${po.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.status === 409 ? `${e.message} Your changes were not saved.` : e.message);
      } else setError("Could not reach the server. Please try again.");
    }
  }

  const tax = preview.data?.tax;

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
      {amendment && <Alert tone="warning">Amendment (revision {existing!.revision}). Lines with goods received keep their item and unit, and can&apos;t drop below the quantity received.</Alert>}

      <Card>
        <CardHeader title="Vendor & delivery" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Vendor" required error={errors.vendorId} className="sm:col-span-2">
            {(p) => (
              <PartyPicker
                id={p.id}
                role="vendor"
                value={vendor}
                disabled={amendment}
                invalid={!!errors.vendorId}
                onChange={(v) => {
                  setVendor(v);
                  if (v?.creditDays && !h.creditDays) setH((x) => ({ ...x, creditDays: String(v.creditDays) }));
                }}
              />
            )}
          </Field>
          <Field label="Order date" required error={errors.docDate} hint={existing?.number ? "Fixed once numbered" : undefined}>
            {(p) => <Input {...p} type="date" disabled={!!existing?.number} value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}
          </Field>
          <Field label="Type">
            {(p) => (
              <Select {...p} value={h.poType} onChange={(e) => setH({ ...h, poType: e.target.value as "standard" | "service" })}>
                <option value="standard">Goods</option>
                <option value="service">Services</option>
              </Select>
            )}
          </Field>
          {h.poType === "standard" && (
            <Field label="Deliver to" error={errors.deliveryWarehouseId} hint="Blank = main store">
              {(p) => (
                <Select {...p} value={h.deliveryWarehouseId} onChange={(e) => setH({ ...h, deliveryWarehouseId: e.target.value })}>
                  <option value="">Main store</option>
                  {(warehouses.data ?? [])
                    .filter((w) => w.isActive)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} · {w.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Expected by" error={errors.expectedDate}>
            {(p) => <Input {...p} type="date" value={h.expectedDate} onChange={(e) => setH({ ...h, expectedDate: e.target.value })} />}
          </Field>
          <Field label="Vendor quotation ref." error={errors.vendorQuoteRef}>
            {(p) => <Input {...p} value={h.vendorQuoteRef} onChange={(e) => setH({ ...h, vendorQuoteRef: e.target.value })} />}
          </Field>
          <Field label="Credit days" error={errors.creditDays}>
            {(p) => <Input {...p} inputMode="numeric" value={h.creditDays} onChange={(e) => setH({ ...h, creditDays: e.target.value.replace(/\D/g, "") })} />}
          </Field>
          <Field label="Payment terms" error={errors.paymentTerms} className="sm:col-span-2">
            {(p) => <Input {...p} placeholder="e.g. 30% advance, balance against delivery" value={h.paymentTerms} onChange={(e) => setH({ ...h, paymentTerms: e.target.value })} />}
          </Field>
          <Field label="Over-receipt allowed (%)" error={errors.tolerancePct} hint="GRNs may exceed the order by this much">
            {(p) => <Input {...p} inputMode="decimal" value={h.tolerancePct} onChange={(e) => setH({ ...h, tolerancePct: e.target.value })} />}
          </Field>
          <Field label="Currency" hint="Import orders: enter rates in this currency">
            {(p) => <Input {...p} className="uppercase" maxLength={3} value={h.currency} onChange={(e) => setH({ ...h, currency: e.target.value.toUpperCase() || "INR" })} />}
          </Field>
          {foreign && (
            <Field label={`Exchange rate (₹ per ${h.currency})`} required error={errors.exchangeRate}>
              {(p) => <Input {...p} inputMode="decimal" value={h.exchangeRate} onChange={(e) => setH({ ...h, exchangeRate: e.target.value })} />}
            </Field>
          )}
          <div className="flex items-end pb-2">
            <Checkbox label="Reverse charge" description="We pay the GST to the government" checked={h.reverseCharge} onChange={(e) => setH({ ...h, reverseCharge: e.target.checked })} />
          </div>
        </div>
        {!!customDefs.data?.length && (
          <div className="border-t border-border px-5 py-4">
            <CustomFieldInputs
              defs={customDefs.data}
              values={custom}
              errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith("customFields.")).map(([k, v]) => [k.slice(13), v]))}
              onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))}
            />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Items" description="Rates are before GST. GST is worked out from each item's HSN rate and the vendor's state." />
        <div className="px-5 pb-3">
          <ItemPicker onPick={addItem} placeholder="Add an item: search or scan" />
          {errors.lines && <p className="mt-1 text-xs text-danger">{errors.lines}</p>}
        </div>
        {lines.length > 0 && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-8 px-3 py-2 font-medium">#</th>
                  <th className="min-w-64 px-2 py-2 font-medium">Item</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Qty</th>
                  <th className="w-28 px-2 py-2 font-medium">Unit</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Rate ({foreign ? h.currency : "₹"})</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Disc %</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">GST</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Amount</th>
                  <th className="w-36 px-2 py-2 font-medium">Needed by</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {lines.map((l, i) => {
                  const it = itemById.get(l.itemId);
                  const err = (f: string) => errors[`lines.${i}.${f}`];
                  const received = Number(l.receivedQty) > 0;
                  const priced = preview.data?.lines[i];
                  return (
                    <tr key={l.key}>
                      <td className="px-3 py-2.5 text-muted">{i + 1}</td>
                      <td className="px-2 py-2">
                        <p className="text-xs text-muted">
                          <span className="font-mono">{l.itemCode}</span>
                          {received && ` · ${Number(l.receivedQty)} received`}
                        </p>
                        <Input aria-label={`Line ${i + 1} description`} className="h-9" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                        {(err("itemId") || err("requisitionLineId")) && <p className="mt-1 text-xs text-danger">{err("itemId") ?? err("requisitionLineId")}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} quantity`} aria-invalid={!!err("qty")} value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                        {err("qty") && <p className="mt-1 text-xs text-danger">{err("qty")}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Select className="h-9" aria-label={`Line ${i + 1} unit`} aria-invalid={!!err("uomId")} disabled={received || !it} value={l.uomId} onChange={(e) => update(l.key, { uomId: e.target.value })}>
                          {it ? unitsFor(it).map((u) => <option key={u.uomId} value={u.uomId}>{u.uom}</option>) : <option value={l.uomId}>{uomCode(l.uomId)}</option>}
                        </Select>
                        {err("uomId") && <p className="mt-1 text-xs text-danger">{err("uomId")}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} rate`} aria-invalid={!!err("rate")} value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} discount`} value={l.discountPct} onChange={(e) => update(l.key, { discountPct: e.target.value })} />
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted">{priced ? `${Number(priced.gstRate)}%` : it?.gstRate ? `${Number(it.gstRate)}%` : "—"}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {priced ? formatMoney(priced.taxableValue) : "—"}
                        {priced && Number(priced.lineTotal) !== Number(priced.taxableValue) && <p className="text-xs text-muted">{formatMoney(priced.lineTotal)} with GST</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Input type="date" className="h-9" aria-label={`Line ${i + 1} needed by`} value={l.deliveryDate} onChange={(e) => update(l.key, { deliveryDate: e.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <Button type="button" variant="ghost" size="sm" disabled={received} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>
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
        <div className="border-t border-border px-5 py-4">
          {tax ? <TaxSummary tax={tax} stateTaxLabel={preview.data?.stateTaxLabel} totalLabel="Order total" /> : <p className="text-right text-sm text-muted">{vendor ? "Enter quantities and rates to see GST and the total." : "Choose a vendor to work out GST."}</p>}
          {preview.error && <p className="mt-2 text-right text-xs text-danger">{preview.error instanceof ApiError ? preview.error.message : "Could not work out GST"}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Terms & notes" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Terms & conditions (printed)">
            {(p) => (
              <textarea {...p} rows={4} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={h.terms} onChange={(e) => setH({ ...h, terms: e.target.value })} />
            )}
          </Field>
          <Field label="Notes">
            {(p) => (
              <textarea {...p} rows={4} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
            )}
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" loading={busy}>
          Save draft
        </Button>
        <Button type="button" loading={busy} onClick={() => save(true)}>
          Save & submit
        </Button>
      </div>
    </form>
  );
}
