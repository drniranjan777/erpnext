"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { DISPOSITION_FIELDS, NCR_SOURCE, QA, type Ncr, type NcrSource } from "@/lib/quality";

const num = (v: string | null | undefined) => (v && Number(v) ? String(Number(v)) : "");
const textarea = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function NcrForm({ ncr }: { ncr?: Ncr }) {
  const router = useRouter();
  const [item, setItem] = useState<{ id: string; label: string } | null>(ncr ? { id: ncr.item.id, label: `${ncr.item.code} ${ncr.item.name}` } : null);
  const [party, setParty] = useState<PickedParty | null>(ncr?.party ? { id: ncr.party.id, code: "", name: ncr.party.name, gstin: null, stateCode: null, creditDays: null } : null);
  const [f, setF] = useState({
    source: (ncr?.source ?? "internal") as NcrSource,
    severity: ncr?.severity ?? "major",
    batchNo: ncr?.batchNo ?? "",
    qtyAffected: num(ncr?.qtyAffected),
    defectCategory: ncr?.defectCategory ?? "",
    description: ncr?.description ?? "",
    containment: ncr?.containment ?? "",
    useAsIsQty: num(ncr?.useAsIsQty),
    reworkQty: num(ncr?.reworkQty),
    scrapQty: num(ncr?.scrapQty),
    returnQty: num(ncr?.returnQty),
    sortQty: num(ncr?.sortQty),
    dispositionNotes: ncr?.dispositionNotes ?? "",
    scrapCost: num(ncr?.scrapCost),
    reworkCost: num(ncr?.reworkCost),
    sortingCost: num(ncr?.sortingCost),
    otherCost: num(ncr?.otherCost),
    recovered: num(ncr?.recovered),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const disposed = DISPOSITION_FIELDS.reduce((s, [k]) => s + (Number(f[k]) || 0), 0);
  const partyRole = f.source === "customer" || f.source === "final" ? "customer" : "vendor";

  async function save() {
    if (!item) return setErrors({ itemId: "Choose the item" });
    setBusy(true);
    setError(null);
    setErrors({});
    const body = { ...f, itemId: item.id, partyId: party?.id ?? null, inspectionId: ncr?.inspection?.id ?? null, workOrderId: ncr?.workOrder?.id ?? null, batchNo: f.batchNo || null, containment: f.containment || null, dispositionNotes: f.dispositionNotes || null };
    try {
      const r = await api<Ncr>(ncr ? `${QA}/ncrs/${ncr.id}` : `${QA}/ncrs`, { method: ncr ? "PUT" : "POST", body: ncr ? { ...body, version: ncr.version } : body });
      router.push(`${QA}/ncrs/${r.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="Found at">{(p) => <Select {...p} value={f.source} onChange={set("source")}>{Object.entries(NCR_SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Severity">{(p) => <Select {...p} value={f.severity} onChange={set("severity")}><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></Select>}</Field>
        <Field label="Defect" required error={errors.defectCategory}>{(p) => <Input {...p} placeholder="Dimension out, colour shade, contamination…" value={f.defectCategory} onChange={set("defectCategory")} />}</Field>
        <Field label="Item" required error={errors.itemId} className="sm:col-span-2">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />)}</Field>
        <Field label="Batch / lot">{(p) => <Input {...p} className="font-mono uppercase" value={f.batchNo} onChange={set("batchNo")} />}</Field>
        <Field label="Quantity affected" required error={errors.qtyAffected}>{(p) => <Input {...p} inputMode="decimal" value={f.qtyAffected} onChange={set("qtyAffected")} />}</Field>
        <Field label={partyRole === "customer" ? "Customer" : "Vendor"} className="sm:col-span-2">{(p) => <PartyPicker id={p.id} role={partyRole} value={party} onChange={setParty} />}</Field>
        <Field label="What is wrong" required error={errors.description} className="sm:col-span-3">{(p) => <textarea {...p} rows={3} className={textarea} value={f.description} onChange={set("description")} />}</Field>
        <Field label="Containment" hint="What was done straight away: quarantine, stop shipment, 100% check" className="sm:col-span-3">{(p) => <textarea {...p} rows={2} className={textarea} value={f.containment} onChange={set("containment")} />}</Field>
      </Card>
      <Card>
        <CardHeader title="MRB disposition" description={`Split the quantity affected. ${disposed && f.qtyAffected ? `${disposed} of ${Number(f.qtyAffected)} disposed.` : ""}`} />
        <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-5">
          {DISPOSITION_FIELDS.map(([k, label]) => <Field key={k} label={label} error={errors[k]}>{(p) => <Input {...p} inputMode="decimal" value={f[k]} onChange={set(k)} />}</Field>)}
          <Field label="Decision notes" className="sm:col-span-5">{(p) => <Input {...p} value={f.dispositionNotes} onChange={set("dispositionNotes")} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Cost of poor quality" description="Scrap is valued at the item's stock rate when the MRB approves, unless entered here." />
        <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-5">
          <Field label="Scrap (₹)">{(p) => <Input {...p} inputMode="decimal" placeholder="At stock rate" value={f.scrapCost} onChange={set("scrapCost")} />}</Field>
          <Field label="Rework (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.reworkCost} onChange={set("reworkCost")} />}</Field>
          <Field label="Sorting (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.sortingCost} onChange={set("sortingCost")} />}</Field>
          <Field label="Other (₹)" hint="Freight, penalties">{(p) => <Input {...p} inputMode="decimal" value={f.otherCost} onChange={set("otherCost")} />}</Field>
          <Field label="Recovered (₹)" hint="Debit note, claim">{(p) => <Input {...p} inputMode="decimal" value={f.recovered} onChange={set("recovered")} />}</Field>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy}>Save</Button>
      </div>
    </div>
  );
}
