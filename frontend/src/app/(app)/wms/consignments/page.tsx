"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, formatQty, todayIST } from "@/lib/documents";
import { useWmsWarehouses, WMS } from "@/lib/wms";

interface Consignment { id: string; direction: string; party: string; warehouse: string; notes: string | null }
interface Statement { party: string; warehouse: string; direction: string; from: string; to: string; stock: { code: string; name: string; qty: string }[]; used: { code: string; name: string; qty: string; value: string }[] }

export default function ConsignmentsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: [WMS, "consignments"], queryFn: () => api<Consignment[]>(`${WMS}/consignments`) });
  const whs = useWmsWarehouses();
  const parties = useQuery({ queryKey: ["/masters/parties", "all"], queryFn: () => api<{ items: { id: string; name: string }[] }>("/masters/parties", { query: { limit: 200 } }) });
  const [f, setF] = useState({ partyId: "", direction: "vendor_stock", warehouseId: "" });
  const [range, setRange] = useState({ from: `${todayIST().slice(0, 7)}-01`, to: todayIST() });
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const st = useQuery({ queryKey: [WMS, "consignment", open, range], queryFn: () => api<Statement>(`${WMS}/consignments/${open}/statement`, { query: range }), enabled: !!open });
  async function add() {
    setError(null);
    try {
      await api(`${WMS}/consignments`, { body: f });
      qc.invalidateQueries({ queryKey: [WMS, "consignments"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const total = (st.data?.used ?? []).reduce((s, u) => s + Number(u.value), 0);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Consignment stock" description="A vendor's stock kept at our site (we pay for what we use), or our stock kept at a customer (we bill what they use). Each consignment has its own warehouse." />
      {error && <Alert>{error}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="font-medium">{c.party}</span>
              <Badge>{c.direction === "vendor_stock" ? "vendor's stock at our site" : "our stock at the customer"}</Badge>
              <span className="text-xs text-muted">warehouse {c.warehouse}</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide" : "Statement"}</Button>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-5 py-4 text-center text-muted">No consignments.</li>}
        </ul>
      </Card>
      {open && (
        <Card>
          <CardHeader title={`Statement · ${st.data?.party ?? ""}`} action={<span className="flex gap-2"><Input className="h-9 w-40" type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /><Input className="h-9 w-40" type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></span>} />
          <div className="grid gap-4 border-t border-border p-4 text-sm md:grid-cols-2">
            <div>
              <p className="mb-1 font-medium">Used in the period{st.data?.direction === "vendor_stock" ? " (to pay)" : " (to bill)"}</p>
              <ul>{st.data?.used.map((u) => <li key={u.code} className="flex gap-2"><span className="font-mono text-xs">{u.code}</span><span>{u.name}</span><span className="ml-auto tabular-nums">{formatQty(u.qty)} · {formatMoney(u.value)}</span></li>)}</ul>
              {st.data && <p className="mt-1 border-t border-border pt-1 text-right font-medium">{formatMoney(total)} at stock value</p>}
            </div>
            <div>
              <p className="mb-1 font-medium">Holding now</p>
              <ul>{st.data?.stock.map((s) => <li key={s.code} className="flex gap-2"><span className="font-mono text-xs">{s.code}</span><span>{s.name}</span><span className="ml-auto tabular-nums">{formatQty(s.qty)}</span></li>)}</ul>
            </div>
          </div>
        </Card>
      )}
      {can("wms.setup.manage") && (
        <Card>
          <CardHeader title="New consignment" />
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            <Field label="Party">{(p) => <Select {...p} className="w-56" value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}><option value="">Choose…</option>{parties.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
            <Field label="Kind">{(p) => <Select {...p} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="vendor_stock">Vendor&apos;s stock at our site</option><option value="customer_stock">Our stock at the customer</option></Select>}</Field>
            <Field label="Warehouse">{(p) => <Select {...p} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</Select>}</Field>
            <Button disabled={!f.partyId || !f.warehouseId} onClick={add}>Add</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
