"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useWarehouses } from "@/lib/masters";
import { QA, type Inspection, type Stage } from "@/lib/quality";

export default function NewInspectionPage() {
  const router = useRouter();
  const whs = useWarehouses();
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ stage: "incoming" as Stage, lotQty: "", warehouseId: "", batchNo: "", remarks: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!item) return setErrors({ itemId: "Choose the item" });
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const qi = await api<Inspection>(`${QA}/inspections`, { body: { stage: f.stage, itemId: item.id, lotQty: f.lotQty, warehouseId: f.warehouseId || null, batchNo: f.batchNo || null, remarks: f.remarks || null } });
      router.push(`${QA}/inspections/${qi.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New inspection" description="For lots outside the automatic triggers: customer returns, stock on hand, a second opinion. The item's active plan for the stage is used." />
      <Card className="space-y-4 p-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item" required error={errors.itemId} className="sm:col-span-2">
            {() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} stockOnly />)}
          </Field>
          <Field label="Stage" error={errors.stage}>
            {(p) => (
              <Select {...p} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>
                <option value="incoming">Incoming</option>
                <option value="final">Final</option>
                <option value="in_process">In-process</option>
              </Select>
            )}
          </Field>
          <Field label="Lot quantity" required error={errors.lotQty}>{(p) => <Input {...p} inputMode="decimal" value={f.lotQty} onChange={(e) => setF({ ...f, lotQty: e.target.value })} />}</Field>
          <Field label="Lot is in" error={errors.warehouseId} required={f.stage !== "in_process"}>
            {(p) => (
              <Select {...p} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}>
                <option value="">Choose…</option>
                {whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Batch number" error={errors.batchNo}>{(p) => <Input {...p} value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />}</Field>
          <Field label="Remarks" className="sm:col-span-2">{(p) => <Input {...p} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />}</Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
          <Button onClick={save} loading={busy}>Create</Button>
        </div>
      </Card>
    </div>
  );
}
