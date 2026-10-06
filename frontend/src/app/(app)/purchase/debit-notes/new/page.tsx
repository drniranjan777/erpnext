"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatMoney, formatQty, todayIST } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { DN_API, DN_ROUTE, PI_API, piKeys, type DebitNote, type PurchaseInvoice } from "@/lib/purchase";

export default function NewDebitNotePage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewDn />
    </Suspense>
  );
}

function NewDn() {
  const piId = useSearchParams().get("pi");
  const pi = useQuery({ queryKey: piKeys.detail(piId ?? ""), queryFn: () => api<PurchaseInvoice>(`${PI_API}/${piId}`), enabled: !!piId });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="New debit note" description="Return goods to the vendor, or record a price reduction, against an approved bill." />
      {!piId && <Alert tone="warning">Open the purchase invoice and choose “Debit note”.</Alert>}
      {pi.isLoading && piId && <LoadingBlock />}
      {pi.error && <ErrorBlock error={pi.error} />}
      {pi.data && <DnForm pi={pi.data} />}
    </div>
  );
}

function DnForm({ pi }: { pi: PurchaseInvoice }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [kind, setKind] = useState<"return" | "price_adjustment">("return");
  const [reason, setReason] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [docDate, setDocDate] = useState(todayIST());
  const [picked, setPicked] = useState<Record<string, { qty: string; rate: string; batchNo: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const netRate = (l: PurchaseInvoice["lines"][number]) => (Number(l.taxableValue) / Number(l.qty)).toFixed(4);
  const open = (l: PurchaseInvoice["lines"][number]) => (kind === "return" ? Number(l.qty) - Number(l.returnedQty) : Number(l.qty));
  const chosen = pi.lines.filter((l) => picked[l.id]);
  const total = chosen.reduce((s, l) => s + Number(picked[l.id].qty || 0) * Number(picked[l.id].rate || 0), 0);

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const dn = await api<DebitNote>(DN_API, {
        body: {
          piId: pi.id,
          kind,
          reason,
          docDate,
          warehouseId: kind === "return" ? warehouseId || null : null,
          vehicleNo: vehicleNo || null,
          lines: chosen.map((l) => ({ piLineId: l.id, qty: picked[l.id].qty, rate: picked[l.id].rate || undefined, batchNo: picked[l.id].batchNo || null })),
        },
      });
      if (andSubmit) await api(`${DN_API}/${dn.id}/submit`, { body: { version: dn.version } });
      qc.invalidateQueries({ queryKey: [DN_ROUTE] });
      qc.invalidateQueries({ queryKey: piKeys.detail(pi.id) });
      router.push(`${DN_ROUTE}/${dn.id}`);
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
        <CardHeader title={`Against ${pi.vendor.name}'s bill ${pi.supplierInvoiceNo}`} description={`${pi.displayNumber} · GST is reversed at the same rates as the bill.`} />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Type" required>
            {(p) => (
              <Select
                {...p}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  setPicked({});
                }}
              >
                <option value="return">Return of goods</option>
                <option value="price_adjustment">Price reduction (no goods)</option>
              </Select>
            )}
          </Field>
          <Field label="Date" required>
            {(p) => <Input {...p} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />}
          </Field>
          {kind === "return" && (
            <Field label="Return from" hint="Blank = where the goods were received" error={errors.warehouseId}>
              {(p) => (
                <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">Receiving warehouse</option>
                  {(warehouses.data ?? []).filter((w) => w.isActive).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {kind === "return" && (
            <Field label="Vehicle no.">{(p) => <Input {...p} className="uppercase" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />}</Field>
          )}
          <Field label="Reason" required className="sm:col-span-2 lg:col-span-4" error={errors.reason}>
            {(p) => <Input {...p} placeholder={kind === "return" ? "e.g. Failed incoming inspection" : "e.g. Agreed rebate on rate"} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Lines" description={kind === "return" ? "Quantity going back, at the bill's net rate (you can lower it)." : "Quantity the reduction applies to, and the reduction per unit."} />
        <ul className="divide-y divide-border border-t border-border">
          {pi.lines.map((l, i) => {
            const sel = picked[l.id];
            const idx = chosen.findIndex((c) => c.id === l.id);
            const err = (f: string) => (idx >= 0 ? errors[`lines.${idx}.${f}`] : undefined);
            return (
              <li key={l.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
                <Checkbox
                  aria-label={`Include line ${i + 1}`}
                  checked={!!sel}
                  disabled={open(l) <= 0}
                  onChange={(e) =>
                    setPicked((p) => {
                      const next = { ...p };
                      if (e.target.checked) next[l.id] = { qty: String(open(l)), rate: kind === "return" ? String(Number(netRate(l))) : "", batchNo: "" };
                      else delete next[l.id];
                      return next;
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  {l.description}
                  <p className="text-xs text-muted">
                    Billed {formatQty(l.qty)} {l.uomCode} @ {formatMoney(netRate(l))} net{Number(l.returnedQty) > 0 && ` · ${formatQty(l.returnedQty)} already returned`}
                  </p>
                </div>
                {sel && (
                  <div className="flex flex-wrap gap-2">
                    <Field label="Qty" error={err("qty")}>
                      {(p) => <Input {...p} className="h-9 w-24 text-right" inputMode="decimal" value={sel.qty} onChange={(e) => setPicked({ ...picked, [l.id]: { ...sel, qty: e.target.value } })} />}
                    </Field>
                    <Field label={kind === "return" ? "Rate" : "Reduction / unit"} error={err("rate")}>
                      {(p) => <Input {...p} className="h-9 w-28 text-right" inputMode="decimal" value={sel.rate} onChange={(e) => setPicked({ ...picked, [l.id]: { ...sel, rate: e.target.value } })} />}
                    </Field>
                    {kind === "return" && (
                      <Field label="Batch" error={err("batchNo")}>
                        {(p) => <Input {...p} className="h-9 w-28 uppercase" value={sel.batchNo} onChange={(e) => setPicked({ ...picked, [l.id]: { ...sel, batchNo: e.target.value } })} />}
                      </Field>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-5 py-3 text-right text-sm text-muted">
          Taxable value <strong className="ml-1 text-foreground tabular-nums">{formatMoney(total)}</strong> (GST added on save)
        </p>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button variant="secondary" loading={busy} disabled={!chosen.length || reason.trim().length < 3} onClick={() => save(false)}>
          Save draft
        </Button>
        <Button loading={busy} disabled={!chosen.length || reason.trim().length < 3} onClick={() => save(true)}>
          Save & submit
        </Button>
      </div>
    </div>
  );
}
