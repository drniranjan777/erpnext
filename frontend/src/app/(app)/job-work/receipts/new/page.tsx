"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatQty, todayIST } from "@/lib/documents";
import { type Challan, JW, type Receipt } from "@/lib/jobwork";
import { useWarehouses } from "@/lib/masters";

export default function NewReceiptPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <NewReceipt />
    </Suspense>
  );
}

function NewReceipt() {
  const id = useSearchParams().get("challan");
  const ch = useQuery({ queryKey: [JW.challans, id], queryFn: () => api<Challan>(`${JW.challans}/${id}`), enabled: !!id });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Receive from job worker" description="Processed goods come in at the cost of the material used plus job charges. Unprocessed material returns as is; process loss is written off." />
      {!id && <Alert tone="warning">Open a job-work challan and choose “Receive back”.</Alert>}
      {ch.isLoading && id && <LoadingBlock />}
      {ch.error && <ErrorBlock error={ch.error} />}
      {ch.data && <ReceiptForm challan={ch.data} />}
    </div>
  );
}

interface Output { key: string; item: PickedItem; qty: string; batchNo: string }
let n = 0;

function ReceiptForm({ challan }: { challan: Challan }) {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const own = (warehouses.data ?? []).filter((w) => w.isActive && w.type !== "job_work");
  const [h, setH] = useState({ docDate: todayIST(), warehouseId: challan.warehouse?.id ?? "", jwChallanNo: "", jwChallanDate: "", jobCharges: "", natureOfJob: challan.process });
  const [mat, setMat] = useState<Record<string, { consumedQty: string; returnedQty: string; lossQty: string }>>({});
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = challan.lines.filter((l) => Number(l.pendingQty) > 0);
  const setM = (lineId: string, k: "consumedQty" | "returnedQty" | "lossQty", v: string) => setMat((m) => ({ ...m, [lineId]: { ...(m[lineId] ?? { consumedQty: "", returnedQty: "", lossQty: "" }), [k]: v } }));

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await api<Receipt>(JW.receipts, {
        body: {
          challanId: challan.id,
          docDate: h.docDate,
          warehouseId: h.warehouseId,
          jwChallanNo: h.jwChallanNo || null,
          jwChallanDate: h.jwChallanDate || null,
          natureOfJob: h.natureOfJob || null,
          jobCharges: h.jobCharges || "0",
          outputs: outputs.map((o) => ({ itemId: o.item.id, qty: o.qty, batchNo: o.batchNo || null })),
          materials: Object.entries(mat).map(([challanLineId, m]) => ({ challanLineId, consumedQty: m.consumedQty || "0", returnedQty: m.returnedQty || "0", lossQty: m.lossQty || "0" })),
        },
      });
      if (andSubmit) await api(`${JW.receipts}/${r.id}/submit`, { body: { version: r.version } });
      qc.invalidateQueries({ queryKey: [JW.challans] });
      router.push(`${JW.receipts}/${r.id}`);
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
        <CardHeader title={`Against ${challan.displayNumber} · ${challan.jobWorker.name}`} />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date">{(f) => <Input {...f} type="date" max={todayIST()} value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}</Field>
          <Field label="Receive into" error={errors.warehouseId}>
            {(f) => (
              <Select {...f} value={h.warehouseId} onChange={(e) => setH({ ...h, warehouseId: e.target.value })}>
                {own.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Their challan no.">{(f) => <Input {...f} value={h.jwChallanNo} onChange={(e) => setH({ ...h, jwChallanNo: e.target.value })} />}</Field>
          <Field label="Their challan date">{(f) => <Input {...f} type="date" value={h.jwChallanDate} onChange={(e) => setH({ ...h, jwChallanDate: e.target.value })} />}</Field>
          <Field label="Job done" className="sm:col-span-2">{(f) => <Input {...f} value={h.natureOfJob} onChange={(e) => setH({ ...h, natureOfJob: e.target.value })} />}</Field>
          <Field label="Job charges (₹)" hint="Added to the value of the goods received" error={errors.jobCharges}>{(f) => <Input {...f} inputMode="decimal" value={h.jobCharges} onChange={(e) => setH({ ...h, jobCharges: e.target.value })} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Material sent" description="How much was used, came back unprocessed, or was lost." />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2 font-medium">Item</th><th className="px-2 py-2 text-right font-medium">Still out</th><th className="w-28 px-2 py-2 text-right font-medium">Consumed</th><th className="w-28 px-2 py-2 text-right font-medium">Returned</th><th className="w-28 px-2 py-2 text-right font-medium">Loss</th></tr>
          </thead>
          <tbody className="divide-y divide-border align-top">
            {open.map((l) => {
              const i = Object.keys(mat).indexOf(l.id);
              const err = i >= 0 ? (errors[`materials.${i}.consumedQty`] ?? errors[`materials.${i}.challanLineId`]) : undefined;
              return (
                <tr key={l.id}>
                  <td className="px-4 py-2.5">{l.description}<p className="font-mono text-xs text-muted">{l.itemCode}</p>{err && <p className="text-xs text-danger">{err}</p>}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatQty(l.pendingQty)} {l.uomCode}</td>
                  {(["consumedQty", "returnedQty", "lossQty"] as const).map((k) => (
                    <td key={k} className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`${l.description} ${k}`} value={mat[l.id]?.[k] ?? ""} onChange={(e) => setM(l.id, k, e.target.value)} /></td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Card>
      <Card>
        <CardHeader title="Processed goods received" description={errors.outputs} />
        <div className="px-5 pb-3"><ItemPicker stockOnly onPick={(item) => setOutputs((o) => [...o, { key: `o${++n}`, item, qty: "", batchNo: "" }])} placeholder="Add the item that came back" /></div>
        {outputs.length > 0 && (
          <ul className="divide-y divide-border border-t border-border text-sm">
            {outputs.map((o, i) => (
              <li key={o.key} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <span className="min-w-0 flex-1">{o.item.name} <span className="font-mono text-xs text-muted">{o.item.code}</span></span>
                <Input className="h-9 w-28 text-right" inputMode="decimal" aria-label={`Output ${i + 1} quantity`} placeholder={o.item.baseUom} value={o.qty} onChange={(e) => setOutputs((os) => os.map((x) => (x.key === o.key ? { ...x, qty: e.target.value } : x)))} />
                <Input className="h-9 w-32 uppercase" aria-label={`Output ${i + 1} batch`} placeholder="Batch" value={o.batchNo} onChange={(e) => setOutputs((os) => os.map((x) => (x.key === o.key ? { ...x, batchNo: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" aria-label={`Remove output ${i + 1}`} onClick={() => setOutputs((os) => os.filter((x) => x.key !== o.key))}><Trash2 className="size-4 text-danger" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} onClick={() => save(true)}>Save & post</Button>
      </div>
    </div>
  );
}
