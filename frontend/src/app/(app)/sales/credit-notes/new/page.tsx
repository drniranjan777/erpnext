"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatMoney, formatQty, todayIST } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { keys, S, type CreditNote, type SalesInvoice } from "@/lib/sales";

export default function NewCreditNotePage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewCredit />
    </Suspense>
  );
}

function NewCredit() {
  const invoiceId = useSearchParams().get("invoice");
  const inv = useQuery({ queryKey: keys.detail(S.invoices, invoiceId ?? ""), queryFn: () => api<SalesInvoice>(`${S.invoices}/${invoiceId}`), enabled: !!invoiceId });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="New credit note" description="Goods returned by the customer, or a price reduction, against an invoice." />
      {!invoiceId && <Alert tone="warning">Open the invoice and choose “Credit note”.</Alert>}
      {inv.isLoading && invoiceId && <LoadingBlock />}
      {inv.error && <ErrorBlock error={inv.error} />}
      {inv.data && <CreditForm inv={inv.data} />}
    </div>
  );
}

function CreditForm({ inv }: { inv: SalesInvoice }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [kind, setKind] = useState<"return" | "price_adjustment">("return");
  const [reason, setReason] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [docDate, setDocDate] = useState(todayIST());
  const [picked, setPicked] = useState<Record<string, { qty: string; rate: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const net = (l: SalesInvoice["lines"][number]) => (Number(l.taxableValue) / Number(l.qty)).toFixed(4);
  const open = (l: SalesInvoice["lines"][number]) => (kind === "return" ? Number(l.qty) - Number(l.returnedQty) : Number(l.qty));
  const chosen = inv.lines.filter((l) => picked[l.id]);
  const total = chosen.reduce((s, l) => s + Number(picked[l.id].qty || 0) * Number(picked[l.id].rate || 0), 0);

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const cn = await api<CreditNote>(S.credits, { body: { invoiceId: inv.id, kind, reason, docDate, warehouseId: kind === "return" ? warehouseId || null : null, lines: chosen.map((l) => ({ invoiceLineId: l.id, qty: picked[l.id].qty, rate: picked[l.id].rate || null })) } });
      if (andSubmit) await api(`${S.credits}/${cn.id}/submit`, { body: { version: cn.version } });
      qc.invalidateQueries({ queryKey: [S.credits] });
      qc.invalidateQueries({ queryKey: keys.detail(S.invoices, inv.id) });
      router.push(`${S.credits}/${cn.id}`);
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
        <CardHeader title={`Against ${inv.displayNumber} · ${inv.customer.name}`} />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Type">
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setPicked({}); }}>
                <option value="return">Sales return (goods back)</option>
                <option value="price_adjustment">Price reduction</option>
              </Select>
            )}
          </Field>
          <Field label="Date">{(p) => <Input {...p} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />}</Field>
          {kind === "return" && (
            <Field label="Goods come back into" hint="Quality hold, scrap… (blank = where they left from)" error={errors.warehouseId}>
              {(p) => (
                <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">Original warehouse</option>
                  {(warehouses.data ?? []).filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Reason" required className="sm:col-span-2 lg:col-span-4" error={errors.reason}>{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Lines" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {inv.lines.map((l) => {
            const sel = picked[l.id];
            const i = chosen.findIndex((c) => c.id === l.id);
            const err = (f: string) => (i >= 0 ? errors[`lines.${i}.${f}`] : undefined);
            return (
              <li key={l.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <input type="checkbox" aria-label={`Include line ${l.lineNo}`} disabled={open(l) <= 0} checked={!!sel} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[l.id] = { qty: String(open(l)), rate: kind === "return" ? String(Number(net(l))) : "" }; else delete n[l.id]; return n; })} />
                <div className="min-w-0 flex-1">{l.description}<p className="text-xs text-muted">Invoiced {formatQty(l.qty)} {l.uomCode} @ {formatMoney(net(l))} net{Number(l.returnedQty) > 0 && ` · ${formatQty(l.returnedQty)} returned`}</p></div>
                {sel && (
                  <div className="flex gap-2">
                    <Field label="Qty" error={err("qty")}>{(p) => <Input {...p} className="h-9 w-24 text-right" value={sel.qty} onChange={(e) => setPicked({ ...picked, [l.id]: { ...sel, qty: e.target.value } })} />}</Field>
                    <Field label={kind === "return" ? "Rate" : "Reduction / unit"} error={err("rate")}>{(p) => <Input {...p} className="h-9 w-28 text-right" value={sel.rate} onChange={(e) => setPicked({ ...picked, [l.id]: { ...sel, rate: e.target.value } })} />}</Field>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-5 py-3 text-right text-sm text-muted">Taxable value <strong className="ml-1 text-foreground tabular-nums">{formatMoney(total)}</strong> (GST added on save)</p>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} disabled={!chosen.length || reason.trim().length < 3} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} disabled={!chosen.length || reason.trim().length < 3} onClick={() => save(true)}>Save & submit</Button>
      </div>
    </div>
  );
}
