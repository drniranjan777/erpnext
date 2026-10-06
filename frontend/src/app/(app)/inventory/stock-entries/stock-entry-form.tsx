"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CustomFieldInputs, useCustomFields, type CustomValues } from "@/components/custom-fields";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty, todayIST } from "@/lib/documents";
import { INVENTORY_KEY, PURPOSE_META, SE_API, SE_ROUTE, type BatchStock, type ItemStock, type Purpose, type StockEntry } from "@/lib/inventory";
import { useWarehouses, type Item } from "@/lib/masters";

interface Line {
  key: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uomId: string;
  qty: string;
  rate: string;
  batchNo: string;
  mfgDate: string;
  expiryDate: string;
  serials: string;
  remarks: string;
}

let seq = 0;
const newKey = () => `l${++seq}`;

function fromExisting(se?: StockEntry): Line[] {
  return (se?.lines ?? []).map((l) => ({
    key: newKey(),
    itemId: l.itemId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    uomId: l.uomId,
    qty: String(Number(l.qty)),
    rate: l.rate ? String(Number(l.rate)) : "",
    batchNo: l.batchNo ?? "",
    mfgDate: l.mfgDate ?? "",
    expiryDate: l.expiryDate ?? "",
    serials: (l.serialNos ?? []).join("\n"),
    remarks: l.remarks ?? "",
  }));
}

const serialList = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Preview only; the server values the entry with exact decimals when it posts. */
function preview(qty: string, rate: string) {
  const q = Math.abs(Number(qty));
  const r = Number(rate);
  return rate !== "" && Number.isFinite(q) && Number.isFinite(r) ? Math.round(q * r * 100) / 100 : null;
}

export function StockEntryForm({ existing }: { existing?: StockEntry }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const customDefs = useCustomFields("stock_entry");
  const [saved, setSaved] = useState<{ id: string; version: number } | null>(existing ? { id: existing.id, version: existing.version } : null);
  const [purpose, setPurpose] = useState<Purpose>(existing?.purpose ?? "material_receipt");
  const [docDate, setDocDate] = useState(existing?.docDate ?? todayIST());
  const [fromId, setFromId] = useState(existing?.fromWarehouse?.id ?? "");
  const [toId, setToId] = useState(existing?.toWarehouse?.id ?? "");
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [reference, setReference] = useState(existing?.reference ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(fromExisting(existing));
  const [custom, setCustom] = useState<CustomValues>(existing?.customFields ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = PURPOSE_META[purpose];
  const active = (warehouses.data ?? []).filter((w) => w.isActive);
  // Stock leaves the source; adjustments use their single warehouse (sent as the target).
  const stockWarehouse = meta.from ? fromId : toId;
  const total = lines.reduce((s, l) => s + (preview(l.qty, l.rate) ?? 0), 0);

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addItem = (it: PickedItem) =>
    setLines((ls) => [
      ...ls,
      {
        key: newKey(),
        itemId: it.id,
        itemCode: it.code,
        itemName: it.name,
        uomId: it.baseUomId,
        qty: "",
        rate: meta.rate === "none" ? "" : (it.lastPurchaseRate ?? it.standardCost ?? "").replace(/\.?0+$/, ""),
        batchNo: "",
        mfgDate: "",
        expiryDate: "",
        serials: "",
        remarks: "",
      },
    ]);

  async function save(andSubmit: boolean) {
    setError(null);
    setErrors({});
    if (!lines.length) return setError("Add at least one item.");
    setBusy(true);
    const payload = {
      purpose,
      docDate,
      fromWarehouseId: meta.from ? fromId || null : null,
      toWarehouseId: meta.to ? toId || null : null,
      reason: reason || null,
      reference: reference || null,
      notes: notes || null,
      customFields: custom,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        uomId: l.uomId,
        qty: l.qty.trim(),
        rate: meta.rate === "none" ? null : l.rate.trim() || null,
        batchNo: l.batchNo.trim() || null,
        mfgDate: l.mfgDate || null,
        expiryDate: l.expiryDate || null,
        serialNos: serialList(l.serials).length ? serialList(l.serials) : null,
        remarks: l.remarks || null,
      })),
    };
    let current = saved;
    try {
      const doc = current
        ? await api<StockEntry>(`${SE_API}/${current.id}`, { method: "PUT", body: { ...payload, version: current.version } })
        : await api<StockEntry>(SE_API, { body: payload });
      current = { id: doc.id, version: doc.version };
      setSaved(current);
      if (andSubmit) await api(`${SE_API}/${doc.id}/submit`, { body: { version: doc.version } });
      qc.invalidateQueries({ queryKey: [SE_ROUTE] });
      qc.invalidateQueries({ queryKey: INVENTORY_KEY });
      router.push(`${SE_ROUTE}/${doc.id}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        const draftNote = andSubmit && current ? " The entry was saved as a draft; fix the problem and submit again." : "";
        setError(err.status === 409 ? `${err.message} Your changes were not saved.` : `${err.message}${draftNote}`);
      } else setError("Could not reach the server. Please try again.");
    }
  }

  const warehouseSelect = (label: string, value: string, set: (v: string) => void, path: string) => (
    <Field label={label} required error={errors[path]}>
      {(p) => (
        <Select {...p} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Choose…</option>
          {active.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} · {w.name}
              {!w.isNettable ? " (not available for use)" : ""}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

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
        <CardHeader title="Details" description={meta.hint} />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Purpose" required>
            {(p) => (
              <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)}>
                {Object.entries(PURPOSE_META).map(([k, m]) => (
                  <option key={k} value={k}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Posting date" required error={errors.docDate} hint={existing?.number ? "Fixed once numbered" : undefined}>
            {(p) => <Input {...p} type="date" value={docDate} disabled={!!existing?.number} onChange={(e) => setDocDate(e.target.value)} />}
          </Field>
          {meta.from && warehouseSelect("From warehouse", fromId, setFromId, "fromWarehouseId")}
          {meta.to && warehouseSelect(purpose === "adjustment" ? "Warehouse" : "To warehouse", toId, setToId, "toWarehouseId")}
          <Field label="Reference" error={errors.reference} hint="Challan, job card or slip number">
            {(p) => <Input {...p} value={reference} onChange={(e) => setReference(e.target.value)} />}
          </Field>
          <Field label="Reason" required={purpose === "adjustment"} error={errors.reason} className="sm:col-span-2 lg:col-span-3">
            {(p) => <Input {...p} value={reason} placeholder={purpose === "adjustment" ? "e.g. Physical count difference, damaged in storage" : "Optional"} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
        {!!customDefs.data?.length && (
          <div className="border-t border-border px-5 py-4">
            <CustomFieldInputs defs={customDefs.data} values={custom} errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith("customFields.")).map(([k, v]) => [k.slice(13), v]))} onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))} />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Items"
          description={meta.signed ? "Positive quantities add stock, negative quantities remove it." : undefined}
          action={meta.rate !== "none" && <span className="text-sm text-muted">Value <strong className="ml-1 text-foreground tabular-nums">{formatMoney(total)}</strong></span>}
        />
        <div className="space-y-3 px-5 py-4">
          <ItemPicker stockOnly onPick={addItem} placeholder="Add an item: search by name, code or scan a barcode" />
          {errors.lines && <p className="text-xs text-danger">{errors.lines}</p>}
        </div>
        {lines.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {lines.map((l, i) => (
              <LineRow
                key={l.key}
                index={i}
                line={l}
                purpose={purpose}
                warehouseId={stockWarehouse}
                errors={errors}
                onChange={(patch) => update(l.key, patch)}
                onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Notes" />
        <div className="px-5 py-4">
          <textarea
            rows={3}
            aria-label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
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
          Save & post
        </Button>
      </div>
    </form>
  );
}

function LineRow({
  index,
  line: l,
  purpose,
  warehouseId,
  errors,
  onChange,
  onRemove,
}: {
  index: number;
  line: Line;
  purpose: Purpose;
  warehouseId: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<Line>) => void;
  onRemove: () => void;
}) {
  const meta = PURPOSE_META[purpose];
  const item = useQuery({ queryKey: ["masters", "items", l.itemId], queryFn: () => api<Item>(`/masters/items/${l.itemId}`), staleTime: 60_000 });
  const outgoing = purpose === "material_issue" || purpose === "transfer" || (purpose === "adjustment" && Number(l.qty) < 0);
  const stock = useQuery({
    queryKey: [...INVENTORY_KEY, "item-stock", l.itemId],
    queryFn: () => api<ItemStock>(`/inventory/stock/${l.itemId}`),
    enabled: outgoing,
  });
  const it = item.data;
  const batches = useQuery({
    queryKey: [...INVENTORY_KEY, "batches", l.itemId, warehouseId],
    queryFn: () => api<BatchStock[]>("/inventory/batches", { query: { itemId: l.itemId, warehouseId } }),
    enabled: outgoing && !!it?.trackBatch && !!warehouseId,
  });
  const err = (f: string) => errors[`lines.${index}.${f}`];
  const uoms = it ? [{ uomId: it.baseUomId, uom: "Base unit", factor: "1" }, ...it.conversions] : [];
  const available = stock.data?.byWarehouse.find((w) => w.warehouseId === warehouseId);
  const serialCount = serialList(l.serials).length;
  const amount = meta.rate === "none" ? null : preview(l.qty, l.rate);

  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-2 w-6 text-sm text-muted">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-medium">
              <span className="font-mono text-xs text-muted">{l.itemCode}</span> {l.itemName}
            </p>
            {it?.trackBatch && <span className="text-xs text-muted">Batch tracked{it.hasExpiry ? " · expiry" : ""}</span>}
            {it?.trackSerial && <span className="text-xs text-muted">Serial numbers</span>}
            {outgoing && warehouseId && stock.data && (
              <span className="text-xs text-muted">
                Available here: <strong className="text-foreground">{formatQty(available?.qty ?? 0)}</strong> {stock.data.item.uom}
              </span>
            )}
            {err("itemId") && <span className="text-xs text-danger">{err("itemId")}</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Field label={meta.signed ? "Qty (±)" : "Qty"} required error={err("qty")}>
              {(p) => <Input {...p} inputMode="decimal" className="text-right tabular-nums" value={l.qty} onChange={(e) => onChange({ qty: e.target.value })} />}
            </Field>
            <Field label="Unit" error={err("uomId")}>
              {(p) => (
                <Select {...p} value={l.uomId} onChange={(e) => onChange({ uomId: e.target.value })} disabled={!it || it.trackSerial}>
                  {uoms.map((u) => (
                    <option key={u.uomId} value={u.uomId}>
                      {u.factor === "1" ? (stock.data?.item.uom ?? u.uom) : `${u.uom} (= ${formatQty(u.factor)} base)`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {meta.rate !== "none" && !(purpose === "adjustment" && Number(l.qty) < 0) && (
              <Field label={meta.rate === "required" ? "Rate (₹)" : "Rate (₹, optional)"} required={meta.rate === "required"} error={err("rate")} hint={meta.rate === "optional" ? "Blank = current stock rate" : undefined}>
                {(p) => <Input {...p} inputMode="decimal" className="text-right tabular-nums" value={l.rate} onChange={(e) => onChange({ rate: e.target.value })} />}
              </Field>
            )}
            {it?.trackBatch &&
              (outgoing ? (
                <Field label="Batch" required error={err("batchNo")} className="lg:col-span-2" hint={!warehouseId ? "Choose the warehouse first" : "Earliest expiry first (FEFO)"}>
                  {(p) => (
                    <Select {...p} value={l.batchNo} onChange={(e) => onChange({ batchNo: e.target.value })}>
                      <option value="">Choose…</option>
                      {(batches.data ?? []).map((b) => (
                        <option key={b.batchId} value={b.batchNo}>
                          {b.batchNo} · {formatQty(b.qty)} {b.expiryDate ? `· exp ${formatDate(b.expiryDate)}` : ""}
                          {b.expired ? " (EXPIRED)" : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <>
                  <Field label="Batch no." required error={err("batchNo")}>
                    {(p) => <Input {...p} className="uppercase" value={l.batchNo} onChange={(e) => onChange({ batchNo: e.target.value })} />}
                  </Field>
                  {it.hasExpiry && (
                    <>
                      <Field label="Mfg date" error={err("mfgDate")}>
                        {(p) => <Input {...p} type="date" value={l.mfgDate} onChange={(e) => onChange({ mfgDate: e.target.value })} />}
                      </Field>
                      <Field label="Expiry" error={err("expiryDate")} hint={it.shelfLifeDays ? `Blank = mfg + ${it.shelfLifeDays} days` : undefined}>
                        {(p) => <Input {...p} type="date" value={l.expiryDate} onChange={(e) => onChange({ expiryDate: e.target.value })} />}
                      </Field>
                    </>
                  )}
                </>
              ))}
            {amount !== null && (
              <div className="flex flex-col justify-end pb-2 text-right text-sm tabular-nums text-muted lg:col-start-6">
                <span className="text-xs">Amount</span>
                {formatMoney(amount)}
              </div>
            )}
          </div>
          {it?.trackSerial && (
            <Field label={`Serial numbers (${serialCount} of ${Math.abs(Number(l.qty)) || 0})`} required error={err("serialNos")} hint="One per line, or separated by commas. A scanner works here.">
              {(p) => (
                <textarea
                  {...p}
                  rows={Math.min(6, Math.max(2, serialCount + 1))}
                  value={l.serials}
                  onChange={(e) => onChange({ serials: e.target.value })}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </Field>
          )}
          <Input className="h-8 text-xs" aria-label={`Line ${index + 1} remarks`} placeholder="Remarks (optional)" value={l.remarks} onChange={(e) => onChange({ remarks: e.target.value })} />
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove line ${index + 1}`}>
          <Trash2 className="size-4 text-danger" />
        </Button>
      </div>
    </li>
  );
}
