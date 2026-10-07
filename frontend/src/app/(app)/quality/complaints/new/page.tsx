"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { todayIST } from "@/lib/documents";
import { QA, type Complaint } from "@/lib/quality";

export default function NewComplaintPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedParty | null>(null);
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ receivedOn: todayIST(), channel: "email", category: "", severity: "major", description: "", batchNo: "", qty: "", isFieldFailure: false, warrantyCost: "", responseDays: "7" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (!customer) return setErrors({ customerId: "Choose the customer" });
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await api<Complaint>(`${QA}/complaints`, { body: { ...f, customerId: customer.id, itemId: item?.id ?? null, batchNo: f.batchNo || null, qty: f.qty || null, warrantyCost: f.isFieldFailure ? f.warrantyCost || "0" : "0", responseDays: Number(f.responseDays) || 7 } });
      router.push(`${QA}/complaints/${r.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Log a customer complaint" />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="Customer" required error={errors.customerId} className="sm:col-span-2">{(p) => <PartyPicker id={p.id} role="customer" value={customer} onChange={setCustomer} />}</Field>
        <Field label="Received on">{(p) => <Input {...p} type="date" value={f.receivedOn} onChange={set("receivedOn")} />}</Field>
        <Field label="Item" className="sm:col-span-2">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />)}</Field>
        <Field label="Quantity">{(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={set("qty")} />}</Field>
        <Field label="Batch / lot">{(p) => <Input {...p} className="font-mono uppercase" value={f.batchNo} onChange={set("batchNo")} />}</Field>
        <Field label="Category" required error={errors.category}>{(p) => <Input {...p} placeholder="Dimension, packing, short supply…" value={f.category} onChange={set("category")} />}</Field>
        <Field label="Severity">{(p) => <Select {...p} value={f.severity} onChange={set("severity")}><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></Select>}</Field>
        <Field label="Received by">{(p) => <Select {...p} value={f.channel} onChange={set("channel")}><option value="email">Email</option><option value="phone">Phone</option><option value="visit">Visit</option><option value="portal">Portal</option><option value="other">Other</option></Select>}</Field>
        <Field label="Respond within (days)">{(p) => <Input {...p} inputMode="numeric" value={f.responseDays} onChange={set("responseDays")} />}</Field>
        <div className="flex items-end pb-2"><Checkbox label="Field failure / warranty" checked={f.isFieldFailure} onChange={(e) => setF({ ...f, isFieldFailure: e.target.checked })} /></div>
        {f.isFieldFailure && <Field label="Warranty cost (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.warrantyCost} onChange={set("warrantyCost")} />}</Field>}
        <Field label="What the customer says" required error={errors.description} className="sm:col-span-3">{(p) => <textarea {...p} rows={4} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={f.description} onChange={set("description")} />}</Field>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy}>Log complaint</Button>
      </div>
    </div>
  );
}
