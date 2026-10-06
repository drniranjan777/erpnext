"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { todayIST } from "@/lib/documents";
import { type Challan, JW } from "@/lib/jobwork";
import { useWarehouses } from "@/lib/masters";

interface Line { key: string; item: PickedItem; qty: string; rate: string; goodsType: "inputs" | "capital_goods"; batchNo: string }

let n = 0;

export default function NewChallanPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [worker, setWorker] = useState<PickedParty | null>(null);
  const [h, setH] = useState({ docDate: todayIST(), warehouseId: "", process: "", expectedReturnDate: "", transporter: "", vehicleNo: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const own = (warehouses.data ?? []).filter((w) => w.isActive && w.type !== "job_work");
  const whId = h.warehouseId || own.find((w) => w.code === "MAIN")?.id || own[0]?.id || "";
  const upd = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));

  async function save(andSubmit: boolean) {
    setError(null);
    setErrors({});
    if (!worker) return setErrors({ jobWorkerId: "Choose the job worker" });
    setBusy(true);
    try {
      const ch = await api<Challan>(JW.challans, {
        body: {
          jobWorkerId: worker.id,
          warehouseId: whId,
          docDate: h.docDate,
          process: h.process,
          expectedReturnDate: h.expectedReturnDate || null,
          transporter: h.transporter || null,
          vehicleNo: h.vehicleNo || null,
          notes: h.notes || null,
          lines: lines.map((l) => ({ itemId: l.item.id, qty: l.qty, rate: l.rate || null, goodsType: l.goodsType, batchNo: l.batchNo || null })),
        },
      });
      if (andSubmit) await api(`${JW.challans}/${ch.id}/submit`, { body: { version: ch.version } });
      qc.invalidateQueries({ queryKey: [JW.challans] });
      router.push(`${JW.challans}/${ch.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Send material for job work" description="A delivery challan (rule 55): no GST is charged; the material moves to the job worker's virtual warehouse at cost." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Job worker" />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Job worker" required error={errors.jobWorkerId} className="sm:col-span-2">{(f) => <PartyPicker id={f.id} role="vendor" value={worker} onChange={setWorker} />}</Field>
          <Field label="Process" required error={errors.process} className="sm:col-span-2">{(f) => <Input {...f} placeholder="Zinc plating, CNC machining, powder coating…" value={h.process} onChange={(e) => setH({ ...h, process: e.target.value })} />}</Field>
          <Field label="Date">{(f) => <Input {...f} type="date" max={todayIST()} value={h.docDate} onChange={(e) => setH({ ...h, docDate: e.target.value })} />}</Field>
          <Field label="Send from" error={errors.warehouseId}>
            {(f) => (
              <Select {...f} value={whId} onChange={(e) => setH({ ...h, warehouseId: e.target.value })}>
                {own.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Expected back">{(f) => <Input {...f} type="date" value={h.expectedReturnDate} onChange={(e) => setH({ ...h, expectedReturnDate: e.target.value })} />}</Field>
          <Field label="Vehicle no.">{(f) => <Input {...f} className="uppercase" value={h.vehicleNo} onChange={(e) => setH({ ...h, vehicleNo: e.target.value })} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Material" description="Quantities in the item's base unit. Leave the value blank to use stock cost." />
        <div className="px-5 pb-3"><ItemPicker stockOnly onPick={(item) => setLines((ls) => [...ls, { key: `l${++n}`, item, qty: "", rate: "", goodsType: "inputs", batchNo: "" }])} /></div>
        {lines.length > 0 && (
          <table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2 font-medium">Item</th><th className="w-28 px-2 py-2 text-right font-medium">Qty</th><th className="w-32 px-2 py-2 text-right font-medium">Value / unit</th><th className="w-40 px-2 py-2 font-medium">Goods</th><th className="w-32 px-2 py-2 font-medium">Batch</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="px-4 py-2.5">{l.item.name}<p className="font-mono text-xs text-muted">{l.item.code} · {l.item.baseUom}</p>{errors[`lines.${i}.itemId`] && <p className="text-xs text-danger">{errors[`lines.${i}.itemId`]}</p>}</td>
                  <td className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Line ${i + 1} quantity`} value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} />{errors[`lines.${i}.qty`] && <p className="text-xs text-danger">{errors[`lines.${i}.qty`]}</p>}</td>
                  <td className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Line ${i + 1} value`} placeholder="stock cost" value={l.rate} onChange={(e) => upd(l.key, { rate: e.target.value })} />{errors[`lines.${i}.rate`] && <p className="text-xs text-danger">{errors[`lines.${i}.rate`]}</p>}</td>
                  <td className="px-2 py-2">
                    <Select className="h-9" aria-label={`Line ${i + 1} goods type`} value={l.goodsType} onChange={(e) => upd(l.key, { goodsType: e.target.value as Line["goodsType"] })}>
                      <option value="inputs">Inputs (1 year)</option>
                      <option value="capital_goods">Capital goods (3 years)</option>
                    </Select>
                  </td>
                  <td className="px-2 py-2"><Input className="h-9 uppercase" aria-label={`Line ${i + 1} batch`} value={l.batchNo} onChange={(e) => upd(l.key, { batchNo: e.target.value })} /></td>
                  <td className="px-2 py-2"><Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4 text-danger" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} disabled={!lines.length} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} disabled={!lines.length} onClick={() => save(true)}>Save & send</Button>
      </div>
    </div>
  );
}
