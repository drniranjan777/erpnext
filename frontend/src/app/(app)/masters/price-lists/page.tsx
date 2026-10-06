"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { useUoms } from "@/lib/masters";

interface PriceListRow {
  id: string;
  name: string;
  type: "selling" | "buying";
  currency: string;
  taxInclusive: boolean;
  validFrom: string | null;
  validTo: string | null;
  isDefault: boolean;
  isActive: boolean;
  itemCount: number;
}

interface PriceListLine {
  itemId: string;
  code: string;
  name: string;
  uomId: string;
  uom: string;
  minQty: string;
  rate: string;
}

export default function PriceListsPage() {
  const { can } = useAuth();
  const lists = useQuery({ queryKey: ["masters", "price-lists"], queryFn: () => api<PriceListRow[]>("/masters/price-lists") });
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Price lists"
        description="Selling lists (dealer, distributor, retail/MRP) and buying lists (vendor rate contracts), with quantity breaks."
        actions={
          can("masters.setup.manage") && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> New price list
            </Button>
          )
        }
      />
      <Card>
        {lists.isLoading && <LoadingBlock />}
        {lists.error && <div className="p-5"><ErrorBlock error={lists.error} /></div>}
        {lists.data?.length === 0 && <EmptyState title="No price lists" description="Item selling rates are used until you add one." />}
        <ul className="divide-y divide-border">
          {lists.data?.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {l.name}
                  <Badge tone={l.type === "selling" ? "primary" : "success"}>{l.type}</Badge>
                  {l.isDefault && <Badge tone="warning">Default</Badge>}
                  {!l.isActive && <Badge>Inactive</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {l.itemCount} rates · {l.taxInclusive ? "incl. GST" : "excl. GST"}
                  {(l.validFrom || l.validTo) && ` · valid ${formatDate(l.validFrom)} – ${formatDate(l.validTo)}`}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(l.id)} aria-label={`Edit ${l.name}`}>
                <Pencil className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {editing && <PriceListDialog id={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PriceListDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const existing = useQuery({
    queryKey: ["masters", "price-list", id],
    queryFn: () => api<PriceListRow & { items: PriceListLine[]; version: number }>(`/masters/price-lists/${id}`),
    enabled: !!id,
  });
  if (id && !existing.data) return null;
  return <PriceListForm key={id ?? "new"} id={id} initial={existing.data} onClose={onClose} />;
}

function PriceListForm({ id, initial, onClose }: { id: string | null; initial?: PriceListRow & { items: PriceListLine[] }; onClose: () => void }) {
  const qc = useQueryClient();
  const uoms = useUoms();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    type: initial?.type ?? ("selling" as "selling" | "buying"),
    taxInclusive: initial?.taxInclusive ?? false,
    validFrom: initial?.validFrom ?? "",
    validTo: initial?.validTo ?? "",
    isDefault: initial?.isDefault ?? false,
    isActive: initial?.isActive ?? true,
  });
  const [lines, setLines] = useState(
    initial?.items.map((l) => ({ itemId: l.itemId, label: `${l.code} · ${l.name}`, uomId: l.uomId, minQty: String(Number(l.minQty)), rate: String(Number(l.rate)) })) ?? [],
  );
  const save = useMutation({
    mutationFn: () =>
      api(id ? `/masters/price-lists/${id}` : "/masters/price-lists", {
        method: id ? "PUT" : "POST",
        body: { ...f, validFrom: f.validFrom || null, validTo: f.validTo || null, items: lines.map(({ label: _l, ...l }) => ({ ...l, minQty: l.minQty || "0" })) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["masters", "price-lists"] });
      qc.invalidateQueries({ queryKey: ["masters", "price-list", id] });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const add = (item: PickedItem) => setLines((l) => [...l, { itemId: item.id, label: `${item.code} · ${item.name}`, uomId: item.baseUomId, minQty: "0", rate: String(Number(f.type === "selling" ? (item.sellingRate ?? 0) : (item.lastPurchaseRate ?? 0))) }]);

  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={id ? `Edit ${initial?.name}` : "New price list"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={f.name.length < 2} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{(save.error as Error).message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Name" required error={errors.name} className="sm:col-span-2">
            {(p) => <Input {...p} placeholder="e.g. Dealer price 2026-27" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
          </Field>
          <Field label="Type">
            {(p) => (
              <Select {...p} value={f.type} disabled={!!id} onChange={(e) => setF({ ...f, type: e.target.value as typeof f.type })}>
                <option value="selling">Selling</option>
                <option value="buying">Buying</option>
              </Select>
            )}
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Rates include GST" checked={f.taxInclusive} onChange={(e) => setF({ ...f, taxInclusive: e.target.checked })} />
          </div>
          <Field label="Valid from">
            {(p) => <Input {...p} type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />}
          </Field>
          <Field label="Valid to" error={errors.validTo}>
            {(p) => <Input {...p} type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />}
          </Field>
          <div className="flex items-end gap-6 pb-2 sm:col-span-2">
            <Checkbox label="Default" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
            <Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="w-28 px-3 py-2 font-medium">Unit</th>
                <th className="w-32 px-3 py-2 text-right font-medium">From qty</th>
                <th className="w-36 px-3 py-2 text-right font-medium">Rate (₹)</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l, i) => {
                const up = (patch: Partial<typeof l>) => setLines((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">{l.label}</td>
                    <td className="px-3 py-2">
                      <Select aria-label="Unit" value={l.uomId} onChange={(e) => up({ uomId: e.target.value })}>
                        {uoms.data?.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label="From quantity" inputMode="decimal" className="text-right" value={l.minQty} onChange={(e) => up({ minQty: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label="Rate" aria-invalid={!!errors[`items.${i}.rate`]} inputMode="decimal" className="text-right" value={l.rate} onChange={(e) => up({ rate: e.target.value })} />
                    </td>
                    <td className="px-2">
                      <Button variant="ghost" size="sm" onClick={() => setLines((x) => x.filter((_, j) => j !== i))} aria-label="Remove rate">
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-border p-3">
            <ItemPicker onPick={add} placeholder="Add item: search name, code or scan barcode…" />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
