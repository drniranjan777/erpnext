"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty, todayIST } from "@/lib/documents";
import { PI_API, PI_ROUTE, type Billable, type PurchaseInvoice } from "@/lib/purchase";

interface Line {
  key: string;
  grnLineId: string | null;
  poLineId: string | null;
  itemId: string;
  itemCode: string;
  description: string;
  uomId: string | null;
  uomCode: string;
  qty: string;
  rate: string;
  discountPct: string;
  expectedRate: string | null;
  maxQty: string | null;
  source: string;
  itcEligible: boolean;
}

let seq = 0;
const key = () => `p${++seq}`;

function fromExisting(pi?: PurchaseInvoice): Line[] {
  return (pi?.lines ?? []).map((l) => ({
    key: key(),
    grnLineId: l.grnLineId,
    poLineId: l.grnLineId ? null : l.poLineId,
    itemId: l.itemId,
    itemCode: l.itemCode,
    description: l.description,
    uomId: l.uomId,
    uomCode: l.uomCode,
    qty: String(Number(l.qty)),
    rate: String(Number(l.rate)),
    discountPct: Number(l.discountPct) ? String(Number(l.discountPct)) : "",
    expectedRate: l.expectedRate,
    maxQty: null,
    source: l.grnNumber ? `GRN ${l.grnNumber}` : l.poLineId ? "Order" : "Direct",
    itcEligible: l.itcEligible,
  }));
}

/** Vendor bill: pick received (GRN) or ordered (service) lines, or add expense items directly. */
export function PiForm({ existing, prefill }: { existing?: PurchaseInvoice; prefill?: { vendor?: PickedParty; grnId?: string } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [vendor, setVendor] = useState<PickedParty | null>(
    existing ? { id: existing.vendor.id, code: existing.vendor.code, name: existing.vendor.name, gstin: existing.vendor.gstin, stateCode: existing.vendor.stateCode, creditDays: null } : (prefill?.vendor ?? null),
  );
  const [h, setH] = useState({
    supplierInvoiceNo: existing?.supplierInvoiceNo ?? "",
    supplierInvoiceDate: existing?.supplierInvoiceDate ?? todayIST(),
    docDate: existing?.docDate ?? todayIST(),
    reverseCharge: existing?.reverseCharge ?? false,
    tdsSection: existing?.tdsSection ?? "",
    tdsRate: existing && Number(existing.tdsRate) ? String(Number(existing.tdsRate)) : "",
    varianceNote: existing?.varianceNote ?? "",
    notes: existing?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(fromExisting(existing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const billable = useQuery({ queryKey: ["purchase", "billable", vendor?.id], queryFn: () => api<Billable>(`${PI_API}/billable`, { query: { vendorId: vendor!.id } }), enabled: !!vendor });
  const sections = useQuery({ queryKey: ["purchase", "tds-sections"], queryFn: () => api<{ code: string; label: string }[]>("/purchase/tds-sections"), staleTime: Infinity });

  const used = new Set(lines.flatMap((l) => [l.grnLineId, l.poLineId].filter(Boolean) as string[]));
  const addGrn = (g: Billable["grnLines"][number]) =>
    setLines((ls) => [...ls, { key: key(), grnLineId: g.grnLineId, poLineId: null, itemId: g.itemId, itemCode: g.itemCode, description: g.itemName, uomId: g.uomId, uomCode: g.uomCode, qty: String(Number(g.pendingQty)), rate: String(Number(g.rate)), discountPct: "", expectedRate: g.rate, maxQty: g.pendingQty, source: `GRN ${g.grnNumber}`, itcEligible: true }]);
  const addPo = (o: Billable["poLines"][number]) =>
    setLines((ls) => [...ls, { key: key(), grnLineId: null, poLineId: o.poLineId, itemId: o.itemId, itemCode: o.itemCode, description: o.description, uomId: o.uomId, uomCode: o.uomCode, qty: String(Number(o.pendingQty)), rate: String(Number(o.rate)), discountPct: "", expectedRate: o.rate, maxQty: o.pendingQty, source: `PO ${o.poNumber}`, itcEligible: true }]);
  const addDirect = (it: PickedItem) =>
    setLines((ls) => [...ls, { key: key(), grnLineId: null, poLineId: null, itemId: it.id, itemCode: it.code, description: it.name, uomId: null, uomCode: it.baseUom, qty: "1", rate: it.lastPurchaseRate ? String(Number(it.lastPurchaseRate)) : "", discountPct: "", expectedRate: null, maxQty: null, source: "Direct", itcEligible: true }]);

  // From a GRN page: bring in all of that receipt's open lines.
  if (!seeded && prefill?.grnId && billable.data) {
    setSeeded(true);
    billable.data.grnLines.filter((g) => g.grnId === prefill.grnId).forEach(addGrn);
  }

  const update = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const taxable = (l: Line) => {
    const v = Number(l.qty || 0) * Number(l.rate || 0);
    return Math.round((v - (v * Number(l.discountPct || 0)) / 100) * 100) / 100;
  };
  const variance = (l: Line) => (l.expectedRate ? Math.round((taxable(l) - Number(l.qty || 0) * Number(l.expectedRate)) * 100) / 100 : 0);
  const total = lines.reduce((s, l) => s + taxable(l), 0);

  async function save(andSubmit: boolean) {
    setError(null);
    setErrors({});
    if (!vendor) return setErrors({ vendorId: "Choose the vendor" });
    setBusy(true);
    const body = {
      vendorId: vendor.id,
      supplierInvoiceNo: h.supplierInvoiceNo,
      supplierInvoiceDate: h.supplierInvoiceDate,
      docDate: h.docDate,
      reverseCharge: h.reverseCharge,
      tdsSection: h.tdsSection || null,
      tdsRate: h.tdsRate || null,
      varianceNote: h.varianceNote || null,
      notes: h.notes || null,
      lines: lines.map((l) => ({ grnLineId: l.grnLineId, poLineId: l.poLineId, itemId: l.itemId, uomId: l.uomId, description: l.description, qty: l.qty, rate: l.rate, discountPct: l.discountPct || null, itcEligible: l.itcEligible })),
    };
    try {
      const pi = existing ? await api<PurchaseInvoice>(`${PI_API}/${existing.id}`, { method: "PUT", body: { ...body, version: existing.version } }) : await api<PurchaseInvoice>(PI_API, { body });
      if (andSubmit) await api(`${PI_API}/${pi.id}/submit`, { body: { version: pi.version } });
      qc.invalidateQueries({ queryKey: [PI_ROUTE] });
      router.push(`${PI_ROUTE}/${pi.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server. Please try again.");
    }
  }

  const grnOpen = (billable.data?.grnLines ?? []).filter((g) => !used.has(g.grnLineId));
  const poOpen = (billable.data?.poLines ?? []).filter((o) => !used.has(o.poLineId));

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
        <CardHeader title="Vendor bill" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Vendor" required error={errors.vendorId} className="sm:col-span-2">
            {(p) => (
              <PartyPicker
                id={p.id}
                role="vendor"
                value={vendor}
                disabled={!!existing || lines.length > 0}
                onChange={(v) => {
                  setVendor(v);
                  setLines([]);
                }}
              />
            )}
          </Field>
          <Field label="Vendor's invoice no." required error={errors.supplierInvoiceNo} hint="As printed on the bill (max 16 characters)">
            {(p) => <Input {...p} className="font-mono uppercase" maxLength={16} value={h.supplierInvoiceNo} onChange={(e) => setH({ ...h, supplierInvoiceNo: e.target.value })} />}
          </Field>
          <Field label="Invoice date" required error={errors.supplierInvoiceDate}>
            {(p) => <Input {...p} type="date" max={todayIST()} value={h.supplierInvoiceDate} onChange={(e) => setH({ ...h, supplierInvoiceDate: e.target.value })} />}
          </Field>
          <Field label="TDS section" error={errors.tdsSection} hint="Blank = the vendor's default">
            {(p) => (
              <Select {...p} value={h.tdsSection} onChange={(e) => setH({ ...h, tdsSection: e.target.value })}>
                <option value="">Vendor default / none</option>
                {(sections.data ?? []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="TDS rate % (override)" error={errors.tdsRate} hint="Lower-deduction certificate etc.">
            {(p) => <Input {...p} inputMode="decimal" value={h.tdsRate} onChange={(e) => setH({ ...h, tdsRate: e.target.value })} />}
          </Field>
          <Field label="Posting date" error={errors.docDate}>
            {(p) => <Input {...p} type="date" disabled={!!existing?.number} value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Reverse charge" description="We pay this GST to the government" checked={h.reverseCharge} onChange={(e) => setH({ ...h, reverseCharge: e.target.checked })} />
          </div>
        </div>
      </Card>

      {vendor && (grnOpen.length > 0 || poOpen.length > 0) && (
        <Card>
          <CardHeader title="Received and not yet billed" description="Add the lines this bill covers." />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {grnOpen.map((g) => (
              <li key={g.grnLineId} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <Badge tone="success">GRN</Badge>
                <span className="min-w-0 flex-1">
                  {g.itemName} <span className="text-xs text-muted">· {g.grnNumber} of {formatDate(g.grnDate)} · PO {g.poNumber}</span>
                </span>
                <span className="tabular-nums">
                  {formatQty(g.pendingQty)} {g.uomCode} @ {formatMoney(g.rate)}
                </span>
                <Button type="button" size="sm" variant="secondary" onClick={() => addGrn(g)}>
                  Add
                </Button>
              </li>
            ))}
            {poOpen.map((o) => (
              <li key={o.poLineId} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <Badge>Service PO</Badge>
                <span className="min-w-0 flex-1">
                  {o.description} <span className="text-xs text-muted">· PO {o.poNumber}</span>
                </span>
                <span className="tabular-nums">
                  {formatQty(o.pendingQty)} {o.uomCode} @ {formatMoney(o.rate)}
                </span>
                <Button type="button" size="sm" variant="secondary" onClick={() => addPo(o)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Bill lines" description="Enter the rate as billed. Differences from the order are shown and need an explanation above the tolerance." />
        {vendor && (
          <div className="px-5 pb-3">
            <ItemPicker onPick={addDirect} placeholder="Add an expense / non-stock item without an order" />
          </div>
        )}
        {errors.lines && <p className="px-5 pb-2 text-xs text-danger">{errors.lines}</p>}
        {lines.length > 0 && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Item</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Qty</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Rate (₹)</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Disc %</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Taxable</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">vs order</th>
                  <th className="w-20 px-2 py-2 font-medium">ITC</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {lines.map((l, i) => {
                  const err = (f: string) => errors[`lines.${i}.${f}`];
                  const v = variance(l);
                  return (
                    <tr key={l.key}>
                      <td className="px-3 py-2.5 text-muted">{i + 1}</td>
                      <td className="px-2 py-2">
                        <p className="text-xs text-muted">
                          <span className="font-mono">{l.itemCode}</span> · {l.source}
                        </p>
                        <Input className="h-9" aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
                        {(err("itemId") || err("grnLineId") || err("poLineId")) && <p className="mt-1 text-xs text-danger">{err("itemId") ?? err("grnLineId") ?? err("poLineId")}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} quantity`} aria-invalid={!!err("qty")} value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                        <p className="mt-0.5 text-right text-xs text-muted">
                          {l.uomCode}
                          {l.maxQty && ` · max ${formatQty(l.maxQty)}`}
                        </p>
                        {err("qty") && <p className="text-xs text-danger">{err("qty")}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} rate`} aria-invalid={!!err("rate")} value={l.rate} onChange={(e) => update(l.key, { rate: e.target.value })} />
                        {err("rate") && <p className="text-xs text-danger">{err("rate")}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <Input inputMode="decimal" className="h-9 text-right tabular-nums" aria-label={`Line ${i + 1} discount`} value={l.discountPct} onChange={(e) => update(l.key, { discountPct: e.target.value })} />
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{formatMoney(taxable(l))}</td>
                      <td className={`px-2 py-2.5 text-right tabular-nums ${v > 0 ? "text-danger" : v < 0 ? "text-success" : "text-muted"}`}>{l.expectedRate ? (v === 0 ? "Matches" : `${v > 0 ? "+" : ""}${formatMoney(v)}`) : "—"}</td>
                      <td className="px-2 py-2.5">
                        <Checkbox aria-label={`Line ${i + 1} input tax credit`} checked={l.itcEligible} onChange={(e) => update(l.key, { itcEligible: e.target.checked })} />
                      </td>
                      <td className="px-2 py-2">
                        <Button type="button" variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
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
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-border px-5 py-4">
          <Field label="Explain rate differences" className="w-full max-w-lg" error={errors.varianceNote} hint="Needed when a rate differs from the order by more than 1%">
            {(p) => <Input {...p} value={h.varianceNote} onChange={(e) => setH({ ...h, varianceNote: e.target.value })} />}
          </Field>
          <p className="text-sm text-muted">
            Taxable value <strong className="ml-1 text-foreground tabular-nums">{formatMoney(total)}</strong>
            <span className="block text-xs">GST, TDS and the due date are worked out when you save.</span>
          </p>
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
