"use client";

import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, ScanLine } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatQty } from "@/lib/documents";
import type { PoListItem, PurchaseOrder } from "@/lib/purchase";
import { useWarehouseParam, WMS } from "@/lib/wms";

interface Count { poLineId: string; qty: number; batchNo: string; mfgDate: string; expiryDate: string }

export default function ReceivingPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Receiving />
    </Suspense>
  );
}

/** Dock receiving: pick the PO, scan each unit (or type a count), then make the GRN. */
function Receiving() {
  const { wh, loading, current } = useWarehouseParam();
  const [poId, setPoId] = useState("");
  const [code, setCode] = useState("");
  const [counts, setCounts] = useState<Count[]>([]);
  const [vehicleNo, setVehicleNo] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string; grnId?: string } | null>(null);
  const pos = useQuery({ queryKey: ["/purchase/orders", "pending-receipt"], queryFn: () => api<{ items: PoListItem[] }>("/purchase/orders", { query: { status: "approved", pendingReceipt: "true", limit: 100 } }) });
  const po = useQuery({ queryKey: ["/purchase/orders", poId], queryFn: () => api<PurchaseOrder>(`/purchase/orders/${poId}`), enabled: !!poId });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  const lines = (po.data?.lines ?? []).filter((l) => l.isStockItem && Number(l.pendingQty) > 0);
  const counted = (lineId: string) => counts.filter((c) => c.poLineId === lineId).reduce((s, c) => s + c.qty, 0);
  function bump(lineId: string, by: number) {
    setCounts((cs) => {
      const at = cs.findIndex((c) => c.poLineId === lineId);
      if (at < 0) return by > 0 ? [...cs, { poLineId: lineId, qty: by, batchNo: "", mfgDate: "", expiryDate: "" }] : cs;
      const next = [...cs];
      next[at] = { ...next[at], qty: Math.max(0, next[at].qty + by) };
      return next;
    });
  }
  async function scan(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    setCode("");
    if (!c) return;
    try {
      const r = await api<{ kind: string; id: string; code: string }>(`${WMS}/warehouses/${wh}/resolve`, { query: { code: c } });
      if (r.kind !== "item") return setMsg({ tone: "warning", text: `${c} is a ${r.kind}, not an item` });
      const line = lines.find((l) => l.itemId === r.id);
      if (!line) return setMsg({ tone: "warning", text: `${r.code} is not pending on this PO` });
      bump(line.id, 1);
      setMsg(null);
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  async function makeGrn() {
    setMsg(null);
    try {
      const grn = await api<{ id: string }>(`${WMS}/receiving`, { body: { poId, warehouseId: wh, vehicleNo: vehicleNo || null, lines: counts.filter((c) => c.qty > 0).map((c) => ({ poLineId: c.poLineId, receivedQty: c.qty, batchNo: c.batchNo || null, mfgDate: c.mfgDate || null, expiryDate: c.expiryDate || null })) } });
      setCounts([]);
      setMsg({ tone: "success", text: "Draft GRN made. Check it and submit; the goods then wait in the receiving bin for put-away.", grnId: grn.id });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Receiving · ${current.code}`} description="Scan each unit's barcode (or item code) against the purchase order, then make the GRN." actions={<WarehouseSelect />} />
      {msg && <Alert tone={msg.tone}>{msg.text} {msg.grnId && <Link className="underline" href={`/purchase/receipts/${msg.grnId}`}>Open the GRN</Link>}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Purchase order">{(p) => <Select {...p} value={poId} onChange={(e) => { setPoId(e.target.value); setCounts([]); }}><option value="">Choose…</option>{pos.data?.items.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.vendor.name}</option>)}</Select>}</Field>
        <Field label="Vehicle">{(p) => <Input {...p} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />}</Field>
      </div>
      {poId && (
        <>
          <form className="flex gap-2" onSubmit={scan}>
            <Input className="h-11 flex-1 font-mono" autoFocus placeholder="Scan a barcode" aria-label="Barcode" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit" size="lg"><ScanLine className="size-5" aria-hidden /></Button>
          </form>
          <Card>
            <CardHeader title="Counted" />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {lines.map((l) => {
                const c = counts.find((x) => x.poLineId === l.id);
                const n = counted(l.id);
                return (
                  <li key={l.id} className="space-y-2 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span><span className="font-mono text-xs text-muted">{l.itemCode}</span> {l.itemName}<span className="block text-xs text-muted">pending {formatQty(l.pendingQty)} {l.uomCode}</span></span>
                      <span className="ml-auto flex items-center gap-1">
                        <Button size="sm" variant="ghost" aria-label="One less" onClick={() => bump(l.id, -1)}><Minus className="size-4" aria-hidden /></Button>
                        <Input aria-label="Count" className="w-20 text-right tabular-nums" inputMode="decimal" value={String(n)} onChange={(e) => bump(l.id, (Number(e.target.value) || 0) - n)} />
                        <Button size="sm" variant="ghost" aria-label="One more" onClick={() => bump(l.id, 1)}><Plus className="size-4" aria-hidden /></Button>
                      </span>
                    </div>
                    {n > Number(l.pendingQty) && <p className="text-xs text-warning">More than pending on the PO.</p>}
                    {l.trackBatch && c && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input aria-label="Batch" placeholder="Batch" value={c.batchNo} onChange={(e) => setCounts(counts.map((x) => (x.poLineId === l.id ? { ...x, batchNo: e.target.value } : x)))} />
                        <Input aria-label="Made on" type="date" value={c.mfgDate} onChange={(e) => setCounts(counts.map((x) => (x.poLineId === l.id ? { ...x, mfgDate: e.target.value } : x)))} />
                        {l.hasExpiry && <Input aria-label="Expires on" type="date" value={c.expiryDate} onChange={(e) => setCounts(counts.map((x) => (x.poLineId === l.id ? { ...x, expiryDate: e.target.value } : x)))} />}
                      </div>
                    )}
                  </li>
                );
              })}
              {po.data && !lines.length && <li className="px-5 py-4 text-center text-muted">Nothing pending on this PO.</li>}
            </ul>
          </Card>
          <div className="flex justify-end"><Button onClick={makeGrn} disabled={!counts.some((c) => c.qty > 0)}>Make the GRN</Button></div>
        </>
      )}
    </div>
  );
}
