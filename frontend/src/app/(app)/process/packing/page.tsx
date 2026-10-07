"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatQty } from "@/lib/documents";
import { useWarehouses } from "@/lib/masters";
import { PROC } from "@/lib/process";

interface Option { formulaId: string; number: string | null; packItem: { id: string; code: string; name: string }; bulkPerPack: string }

export default function PackingPage() {
  const whs = useWarehouses();
  const [bulk, setBulk] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ batchNo: "", sourceWarehouseId: "", targetWarehouseId: "" });
  const [packs, setPacks] = useState<Record<string, string>>({});
  const options = useQuery({ queryKey: [PROC, "packing", bulk?.id], queryFn: () => api<Option[]>(`${PROC}/packing/options`, { query: { bulkItemId: bulk!.id } }), enabled: !!bulk });
  const need = (options.data ?? []).reduce((s, o) => s + Number(o.bulkPerPack) * (Number(packs[o.formulaId]) || 0), 0);
  const [result, setResult] = useState<{ bulkNeeded: string; orders: { id: string; item: { code: string }; packs: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api(`${PROC}/packing`, { body: { bulkItemId: bulk!.id, batchNo: f.batchNo || null, sourceWarehouseId: f.sourceWarehouseId, targetWarehouseId: f.targetWarehouseId, lines: Object.entries(packs).filter(([, v]) => Number(v) > 0).map(([formulaId, v]) => ({ formulaId, packs: v })) } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Packing" description="Split a bulk lot into pack sizes. Each pack size is made from its packing formula as a packing order you then release and book like any batch." />
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Bulk product" className="sm:col-span-2">{() => (bulk ? <div className="flex items-center gap-2 text-sm">{bulk.label}<Button size="sm" variant="ghost" onClick={() => { setBulk(null); setPacks({}); setResult(null); }}>Change</Button></div> : <ItemPicker onPick={(it) => setBulk({ id: it.id, label: `${it.code} ${it.name}` })} stockOnly />)}</Field>
        <Field label="Bulk lot">{(p) => <Input {...p} value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />}</Field>
        <div />
        <Field label="Bulk and packaging from">{(p) => <Select {...p} value={f.sourceWarehouseId} onChange={(e) => setF({ ...f, sourceWarehouseId: e.target.value })}><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>
        <Field label="Packs to">{(p) => <Select {...p} value={f.targetWarehouseId} onChange={(e) => setF({ ...f, targetWarehouseId: e.target.value })}><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>
      </Card>
      {bulk && (
        <Card>
          <CardHeader title="Pack sizes" description={options.data?.length ? `Bulk needed: ${formatQty(String(need))}` : "No approved packing formula uses this bulk yet."} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {options.data?.map((o) => (
              <li key={o.formulaId} className="flex items-center justify-between gap-3 px-5 py-2">
                <span><span className="font-mono text-xs text-muted">{o.packItem.code}</span> {o.packItem.name} <span className="text-xs text-muted">· {formatQty(o.bulkPerPack)} bulk per pack</span></span>
                <Input className="h-9 w-28" inputMode="numeric" aria-label={`Packs of ${o.packItem.code}`} placeholder="Packs" value={packs[o.formulaId] ?? ""} onChange={(e) => setPacks({ ...packs, [o.formulaId]: e.target.value })} />
              </li>
            ))}
          </ul>
          <div className="flex justify-end border-t border-border p-4"><Button onClick={go} loading={busy} disabled={!need || !f.sourceWarehouseId || !f.targetWarehouseId}>Create packing orders</Button></div>
        </Card>
      )}
      {error && <Alert>{error}</Alert>}
      {result && (
        <Alert tone="success">
          {result.orders.length} packing order{result.orders.length === 1 ? "" : "s"} created as drafts, using {formatQty(result.bulkNeeded)} of bulk:{" "}
          {result.orders.map((o) => <Link key={o.id} className="mr-2 underline" href={`/manufacturing/work-orders/${o.id}`}>{o.item.code} × {Number(o.packs)}</Link>)}
        </Alert>
      )}
    </div>
  );
}
