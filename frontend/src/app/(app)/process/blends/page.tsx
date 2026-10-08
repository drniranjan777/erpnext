"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { PROC } from "@/lib/process";
import { DataTable } from "@/components/ui/data-table";

interface Blend { id: string; number: string; docDate: string; item: { code: string; name: string }; newBatchNo: string; totalQty: string; value: string; warehouse: string }

export default function BlendsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: [PROC, "blends"], queryFn: () => api<{ items: Blend[] }>(`${PROC}/blends`) });
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Blends" description="Combine lots of one item into a new lot. The new lot carries the cost of what went in, and traces back to every lot blended." actions={can("manufacturing.production.manage") && <Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /> New blend</Button>} />
      {open && <BlendForm onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: [PROC, "blends"] }); }} onCancel={() => setOpen(false)} />}
      {list.isLoading && <LoadingBlock />}
      {list.error && <ErrorBlock error={list.error} />}
      {list.data && (
        <Card>
          <DataTable
            rows={list.data.items}
            rowKey={(b) => String(b.id)}
            exportName="process-blends"
            storageKey="process-blends-0"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No blends yet.</p>}
            columns={[
              { key: "blend", label: "Blend", locked: true, className: "whitespace-normal", render: (b) => <>{b.number}<span className="block text-xs text-muted">{formatDate(b.docDate)} · {b.warehouse}</span></> },
              { key: "item", label: "Item", className: "whitespace-normal", render: (b) => <><span className="font-mono text-xs text-muted">{b.item.code}</span> {b.item.name}</> },
              { key: "new-lot", label: "New lot", className: "font-mono whitespace-normal", render: (b) => <>{b.newBatchNo}</> },
              { key: "quantity", label: "Quantity", align: "right", render: (b) => <>{formatQty(b.totalQty)}</> },
              { key: "value", label: "Value", align: "right", render: (b) => <>{formatMoney(b.value)}</> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

function BlendForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const whs = useWarehouses();
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ warehouseId: "", newBatchNo: "", notes: "" });
  const [lots, setLots] = useState([{ batchNo: "", qty: "" }, { batchNo: "", qty: "" }]);
  const stock = useQuery({ queryKey: ["inventory", "stock", item?.id], queryFn: () => api<{ byBatch: { batchNo: string; warehouseId: string; qty: string }[] }>(`/inventory/stock/${item!.id}`), enabled: !!item });
  const available = (stock.data?.byBatch ?? []).filter((b) => !f.warehouseId || b.warehouseId === f.warehouseId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!item) return setError("Choose the item");
    setBusy(true);
    setError(null);
    try {
      await api(`${PROC}/blends`, { body: { itemId: item.id, warehouseId: f.warehouseId, newBatchNo: f.newBatchNo, notes: f.notes || null, lots: lots.filter((l) => l.batchNo && l.qty) } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="New blend" />
      <div className="space-y-4 border-t border-border p-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Item" required>{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} stockOnly />)}</Field>
          <Field label="Warehouse" required>{(p) => <Select {...p} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>
          <Field label="New lot number" required>{(p) => <Input {...p} className="font-mono uppercase" value={f.newBatchNo} onChange={(e) => setF({ ...f, newBatchNo: e.target.value.toUpperCase() })} />}</Field>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Lots to blend</p>
          {lots.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select className="h-9 w-56" aria-label="Lot" value={l.batchNo} onChange={(e) => setLots(lots.map((x, j) => (j === i ? { ...x, batchNo: e.target.value } : x)))}>
                <option value="">Choose a lot…</option>
                {available.map((b) => <option key={`${b.warehouseId}-${b.batchNo}`} value={b.batchNo}>{b.batchNo} · {formatQty(b.qty)} in stock</option>)}
              </Select>
              <Input className="h-9 w-28" inputMode="decimal" aria-label="Quantity" placeholder="Quantity" value={l.qty} onChange={(e) => setLots(lots.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              {lots.length > 2 && <Button size="sm" variant="ghost" aria-label="Remove lot" onClick={() => setLots(lots.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>}
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setLots([...lots, { batchNo: "", qty: "" }])}><Plus className="size-4" aria-hidden /> Another lot</Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={save} loading={busy}>Blend</Button>
        </div>
      </div>
    </Card>
  );
}
