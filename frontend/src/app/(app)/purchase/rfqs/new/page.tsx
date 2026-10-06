"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { PartyPicker } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { todayIST } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { RFQ_API, RFQ_ROUTE, type Rfq, type VendorLookup } from "@/lib/purchase";

interface Line {
  key: number;
  item: PickedItem;
  qty: string;
  requiredBy: string;
}
let seq = 0;

export default function NewRfqPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const warehouses = useWarehouses();
  const [lines, setLines] = useState<Line[]>([]);
  const [vendors, setVendors] = useState<VendorLookup[]>([]);
  const [h, setH] = useState({ responseDueDate: "", deliveryWarehouseId: "", terms: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(andSubmit: boolean) {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const rfq = await api<Rfq>(RFQ_API, {
        body: {
          responseDueDate: h.responseDueDate || null,
          deliveryWarehouseId: h.deliveryWarehouseId || null,
          terms: h.terms || null,
          notes: h.notes || null,
          lines: lines.map((l) => ({ itemId: l.item.id, qty: l.qty, requiredBy: l.requiredBy || null })),
          vendorIds: vendors.map((v) => v.id),
        },
      });
      if (andSubmit) await api(`${RFQ_API}/${rfq.id}/submit`, { body: { version: rfq.version } });
      qc.invalidateQueries({ queryKey: [RFQ_ROUTE] });
      router.push(`${RFQ_ROUTE}/${rfq.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="New request for quotation" description="Submit it to issue it; then email it to the vendors and record their quotes." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Items" description="Quantities in each item's purchase unit." />
        <div className="px-5 pb-3">
          <ItemPicker onPick={(item) => setLines((ls) => [...ls, { key: ++seq, item, qty: "", requiredBy: "" }])} placeholder="Add an item" />
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {lines.map((l, i) => (
            <li key={l.key} className="flex flex-wrap items-end gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                {l.item.name} <span className="font-mono text-xs text-muted">{l.item.code}</span>
              </div>
              <Field label="Quantity" error={errors[`lines.${i}.qty`]}>
                {(p) => <Input {...p} className="w-28 text-right" inputMode="decimal" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} />}
              </Field>
              <Field label="Needed by">{(p) => <Input {...p} type="date" min={todayIST()} value={l.requiredBy} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, requiredBy: e.target.value } : x)))} />}</Field>
              <Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                <Trash2 className="size-4 text-danger" />
              </Button>
            </li>
          ))}
        </ul>
        {errors.lines && <p className="px-5 py-2 text-xs text-danger">{errors.lines}</p>}
      </Card>
      <Card>
        <CardHeader title="Vendors to invite" description="They receive the RFQ by email when you send it." />
        <div className="space-y-3 px-5 pb-4">
          <PartyPicker role="vendor" value={null} onChange={(v) => v && !vendors.some((x) => x.id === v.id) && setVendors((vs) => [...vs, v])} />
          <div className="flex flex-wrap gap-2">
            {vendors.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 text-sm">
                {v.name}
                <button type="button" aria-label={`Remove ${v.name}`} onClick={() => setVendors((vs) => vs.filter((x) => x.id !== v.id))}>
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
          {errors.vendorIds && <p className="text-xs text-danger">{errors.vendorIds}</p>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Terms" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Quotes due by">{(p) => <Input {...p} type="date" min={todayIST()} value={h.responseDueDate} onChange={(e) => setH({ ...h, responseDueDate: e.target.value })} />}</Field>
          <Field label="Deliver to">
            {(p) => (
              <Select {...p} value={h.deliveryWarehouseId} onChange={(e) => setH({ ...h, deliveryWarehouseId: e.target.value })}>
                <option value="">Main store</option>
                {(warehouses.data ?? []).filter((w) => w.isActive).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Terms sent to vendors" className="sm:col-span-2">
            {(p) => <textarea {...p} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Prices ex-works / delivered, validity, test certificates…" value={h.terms} onChange={(e) => setH({ ...h, terms: e.target.value })} />}
          </Field>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button variant="secondary" loading={busy} disabled={!lines.length || !vendors.length} onClick={() => save(false)}>
          Save draft
        </Button>
        <Button loading={busy} disabled={!lines.length || !vendors.length} onClick={() => save(true)}>
          Save & issue
        </Button>
      </div>
    </div>
  );
}
