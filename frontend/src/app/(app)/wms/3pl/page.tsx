"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty, todayIST } from "@/lib/documents";
import { useWmsWarehouses, WMS } from "@/lib/wms";

interface Client { id: string; client: string; warehouse: string; storagePerPalletDay: string; inboundPerUnit: string; outboundPerUnit: string; minimumMonthly: string | null; serviceItem: string; items: number; billedTo: string | null; isActive: boolean }
interface Preview { perItem: { itemId: string; code: string; name: string; palletDays: string; unitsIn: string; unitsOut: string }[]; palletDays: number; unitsIn: number; unitsOut: number; storage: number; handling: number; topUp: number; total: number }
interface Bill { id: string; fromDate: string; toDate: string; palletDays: string; total: string; invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null }

/** Contract warehousing: goods owned by clients, billed for storage (pallet-days) and handling. */
export default function ThreePlPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const clients = useQuery({ queryKey: [WMS, "3pl"], queryFn: () => api<Client[]>(`${WMS}/3pl/clients`) });
  const whs = useWmsWarehouses();
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string }[] }>("/masters/parties", { query: { role: "customer", limit: 200 } }), enabled: can("wms.setup.manage") });
  const services = useQuery({ queryKey: ["/masters/items", "services"], queryFn: () => api<{ items: { id: string; code: string; name: string; type: string }[] }>("/masters/items", { query: { type: "service", limit: 200 } }), enabled: can("wms.setup.manage") });
  const [open, setOpen] = useState<string | null>(null);
  const [period, setPeriod] = useState({ from: `${todayIST().slice(0, 7)}-01`, to: todayIST() });
  const [f, setF] = useState({ partyId: "", warehouseId: "", storagePerPalletDay: "", inboundPerUnit: "", outboundPerUnit: "", minimumMonthly: "", defaultUnitsPerPallet: "1", serviceItemId: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const preview = useQuery({ queryKey: [WMS, "3pl-preview", open, period], queryFn: () => api<Preview>(`${WMS}/3pl/clients/${open}/preview`, { query: period }), enabled: !!open });
  const bills = useQuery({ queryKey: [WMS, "3pl-bills", open], queryFn: () => api<Bill[]>(`${WMS}/3pl/clients/${open}/bills`), enabled: !!open });
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const n = (v: string) => (v ? Number(v) : 0);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Contract warehousing (3PL)" description="Goods you store for clients: mark their items with the client as owner (Item storage) and keep them at no value. Each period is billed as storage pallet-days plus handling in and out, with a monthly minimum." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {clients.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="font-medium">{c.client}</span>
              <span className="text-xs text-muted">{c.warehouse} · {c.items} item(s) · ₹{Number(c.storagePerPalletDay)}/pallet-day · in ₹{Number(c.inboundPerUnit)} · out ₹{Number(c.outboundPerUnit)}{c.minimumMonthly && ` · minimum ${formatMoney(c.minimumMonthly)}`}</span>
              {c.billedTo && <Badge>billed to {formatDate(c.billedTo)}</Badge>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "Hide" : "Bill"}</Button>
            </li>
          ))}
          {clients.data && !clients.data.length && <li className="px-5 py-4 text-center text-muted">No warehousing clients.</li>}
        </ul>
      </Card>
      {open && (
        <Card>
          <CardHeader title="Billing" action={<span className="flex gap-2"><Input className="h-9 w-40" type="date" aria-label="From" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /><Input className="h-9 w-40" type="date" aria-label="To" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></span>} />
          {preview.data && (
            <div className="space-y-3 border-t border-border p-4 text-sm">
              <table className="w-full">
                <thead className="text-left text-xs text-muted"><tr><th>Item</th><th className="text-right">Pallet-days</th><th className="text-right">In</th><th className="text-right">Out</th></tr></thead>
                <tbody>{preview.data.perItem.map((i) => <tr key={i.itemId}><td>{i.code} · {i.name}</td><td className="text-right tabular-nums">{formatQty(i.palletDays)}</td><td className="text-right tabular-nums">{formatQty(i.unitsIn)}</td><td className="text-right tabular-nums">{formatQty(i.unitsOut)}</td></tr>)}</tbody>
              </table>
              <p className="text-right">Storage {formatMoney(preview.data.storage)} · handling {formatMoney(preview.data.handling)}{preview.data.topUp > 0 && ` · minimum top-up ${formatMoney(preview.data.topUp)}`} · <span className="font-semibold">total {formatMoney(preview.data.total)}</span></p>
              {can("wms.setup.manage") && can("sales.invoices.manage") && <div className="flex justify-end"><Button disabled={preview.data.total <= 0} onClick={() => run(() => api(`${WMS}/3pl/clients/${open}/bills`, { body: period }), "Bill saved and a draft invoice raised.")}>Bill this period</Button></div>}
            </div>
          )}
          <ul className="divide-y divide-border border-t border-border text-sm">
            {bills.data?.map((b) => <li key={b.id} className="flex gap-3 px-5 py-2"><span>{formatDate(b.fromDate)} to {formatDate(b.toDate)}</span><span className="text-xs text-muted">{formatQty(b.palletDays)} pallet-days</span><span className="ml-auto tabular-nums">{formatMoney(b.total)}</span>{b.invoiceId && <Link className="text-primary hover:underline" href={`/sales/invoices/${b.invoiceId}`}>{b.invoiceNumber ?? `draft invoice`}</Link>}</li>)}
          </ul>
        </Card>
      )}
      {can("wms.setup.manage") && (
        <Card>
          <CardHeader title="New warehousing client" />
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
            <Field label="Client">{(p) => <Select {...p} value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}><option value="">Choose…</option>{customers.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
            <Field label="Warehouse">{(p) => <Select {...p} value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</Select>}</Field>
            <Field label="Invoice with service">{(p) => <Select {...p} value={f.serviceItemId} onChange={(e) => setF({ ...f, serviceItemId: e.target.value })}><option value="">Choose…</option>{services.data?.items.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>}</Field>
            <Field label="Units per pallet (default)">{(p) => <Input {...p} inputMode="decimal" value={f.defaultUnitsPerPallet} onChange={(e) => setF({ ...f, defaultUnitsPerPallet: e.target.value })} />}</Field>
            <Field label="₹ per pallet-day">{(p) => <Input {...p} inputMode="decimal" value={f.storagePerPalletDay} onChange={(e) => setF({ ...f, storagePerPalletDay: e.target.value })} />}</Field>
            <Field label="₹ per unit in">{(p) => <Input {...p} inputMode="decimal" value={f.inboundPerUnit} onChange={(e) => setF({ ...f, inboundPerUnit: e.target.value })} />}</Field>
            <Field label="₹ per unit out">{(p) => <Input {...p} inputMode="decimal" value={f.outboundPerUnit} onChange={(e) => setF({ ...f, outboundPerUnit: e.target.value })} />}</Field>
            <Field label="Monthly minimum ₹">{(p) => <Input {...p} inputMode="decimal" value={f.minimumMonthly} onChange={(e) => setF({ ...f, minimumMonthly: e.target.value })} />}</Field>
            <div className="sm:col-span-4 flex justify-end">
              <Button disabled={!f.partyId || !f.warehouseId || !f.serviceItemId || f.storagePerPalletDay === ""} onClick={() => run(() => api(`${WMS}/3pl/clients`, { body: { partyId: f.partyId, warehouseId: f.warehouseId, serviceItemId: f.serviceItemId, storagePerPalletDay: n(f.storagePerPalletDay), inboundPerUnit: n(f.inboundPerUnit), outboundPerUnit: n(f.outboundPerUnit), minimumMonthly: f.minimumMonthly ? n(f.minimumMonthly) : null, defaultUnitsPerPallet: n(f.defaultUnitsPerPallet) || 1 } }), "Client added.")}>Add client</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
