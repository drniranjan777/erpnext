"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { DMS, type Distributor } from "@/lib/dms";
import { inr } from "@/lib/payroll";

interface StockRow { itemId: string; code: string; name: string; adjustments: number; primaryIn: number; secondaryOut: number; onHand: number; sold30: number; daysCover: number | null }
interface Sale { id: string; number: string; date: string; retailer: string; gross: string; discount: string; net: string; source: string; status: string }

export default function DistributorPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const dists = useQuery({ queryKey: [DMS, "distributors"], queryFn: () => api<Distributor[]>(`${DMS}/distributors`) });
  const stock = useQuery({ queryKey: [DMS, "stock", id], queryFn: () => api<StockRow[]>(`${DMS}/distributors/${id}/stock`) });
  const sales = useQuery({ queryKey: [DMS, "sales", id], queryFn: () => api<Sale[]>(`${DMS}/secondary-sales`, { query: { distributorId: id } }) });
  const [f, setF] = useState({ itemId: "", kind: "opening", qty: "", remarks: "" });
  const [error, setError] = useState<string | null>(null);
  const d = dists.data?.find((x) => x.id === id);
  async function adjust() {
    setError(null);
    try {
      await api(`${DMS}/stock-adjustments`, { body: { distributorId: id, itemId: f.itemId, kind: f.kind, qty: Number(f.qty), remarks: f.remarks || null } });
      setF({ ...f, qty: "", remarks: "" });
      qc.invalidateQueries({ queryKey: [DMS, "stock", id] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  if (dists.isLoading) return <LoadingBlock />;
  if (!d) return <ErrorBlock error={new Error("Distributor not found")} />;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={d.name} description={`${d.code}${d.gstin ? ` · ${d.gstin}` : ""} · ${d.retailers} retailers · ${inr(d.secondaryMtd)} secondary sales this month`} />
      <Card>
        <CardHeader title="Stock at the distributor" description="Opening and counts, plus our invoices to them, less their sales to retailers (free goods included)." />
        {stock.isLoading && <LoadingBlock />}
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-3 py-2 text-right font-medium">Opening / counts</th><th className="px-3 py-2 text-right font-medium">Bought from us</th><th className="px-3 py-2 text-right font-medium">Sold</th><th className="px-3 py-2 text-right font-medium">In stock</th><th className="px-3 py-2 text-right font-medium">Days of cover</th></tr></thead>
          <tbody className="divide-y divide-border">
            {stock.data?.map((s) => (
              <tr key={s.itemId}>
                <td className="px-4 py-1.5">{s.code} {s.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s.adjustments}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s.primaryIn}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s.secondaryOut}</td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">{s.onHand}</td>
                <td className="px-3 py-1.5 text-right">{s.daysCover === null ? "–" : <Badge tone={s.daysCover < 7 ? "danger" : s.daysCover < 15 ? "warning" : "success"}>{s.daysCover} days</Badge>}</td>
              </tr>
            ))}
            {stock.data && !stock.data.length && <tr><td colSpan={6} className="px-4 py-4 text-center text-muted">Nothing invoiced or recorded yet.</td></tr>}
          </tbody>
        </table></div>
        {can("dms.network.manage") && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
            {error && <Alert>{error}</Alert>}
            <Field label="Item">{(p) => <Select {...p} className="w-56" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Choose…</option>{stock.data?.map((s) => <option key={s.itemId} value={s.itemId}>{s.code} {s.name}</option>)}</Select>}</Field>
            <Field label="What">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="opening">Opening stock</option><option value="count">Count difference</option><option value="damage">Damaged</option></Select>}</Field>
            <Field label="Qty (+/−)">{(p) => <Input {...p} className="w-24" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
            <Field label="Remarks">{(p) => <Input {...p} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} />}</Field>
            <Button size="sm" disabled={!f.itemId || !Number(f.qty)} onClick={adjust}>Record</Button>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Secondary sales" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {sales.data?.map((s) => <li key={s.id} className="flex flex-wrap gap-3 px-5 py-2"><span className="w-24">{formatDate(s.date)}</span><span className="font-mono text-xs text-muted">{s.number}</span><span className="font-medium">{s.retailer}</span><Badge>{s.source}</Badge>{s.status === "cancelled" && <Badge tone="danger">cancelled</Badge>}<span className="ml-auto tabular-nums">{inr(s.net)}{Number(s.discount) > 0 && <span className="text-xs text-muted"> after {inr(s.discount)} schemes</span>}</span></li>)}
          {sales.data && !sales.data.length && <li className="px-5 py-4 text-muted">No secondary sales yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
