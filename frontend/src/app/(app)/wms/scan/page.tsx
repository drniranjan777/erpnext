"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, ScanLine } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { OfflineBanner } from "@/components/wms/offline-banner";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { clientRef, sendOrQueue } from "@/lib/offline-queue";
import { CONDITION_TONE, useWarehouseParam, WMS, type BinContent, type BinView } from "@/lib/wms";

interface Location { warehouseId: string; warehouse: string; binId: string; bin: string; zoneKind: string; condition: string; batchKey: string; batchNo: string | null; expiryDate: string | null; qty: string; isBlocked: boolean }

export default function ScanPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Scan />
    </Suspense>
  );
}

/** Phone / handheld screen: scan a bin to see and move what is in it, or look up where an item is. */
function Scan() {
  const sp = useSearchParams();
  const { wh, loading, current } = useWarehouseParam();
  const [code, setCode] = useState(sp.get("bin") ?? "");
  const [bin, setBin] = useState(sp.get("bin") ?? "");
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const view = useQuery({ queryKey: [WMS, "bin", wh, bin], queryFn: () => api<BinView>(`${WMS}/warehouses/${wh}/bins/${encodeURIComponent(bin)}`), enabled: !!wh && !!bin, retry: false });
  const locs = useQuery({ queryKey: [WMS, "locations", item?.id, wh], queryFn: () => api<Location[]>(`${WMS}/items/${item!.id}/locations`, { query: { warehouseId: wh ?? undefined } }), enabled: !!item && !!wh });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={`Scan · ${current.code}`} actions={<WarehouseSelect />} />
      <OfflineBanner />
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setBin(code.trim().toUpperCase()); }}>
        <Input className="h-11 flex-1 font-mono text-lg uppercase" autoFocus placeholder="Scan a bin label" aria-label="Bin code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" size="lg" aria-label="Look up"><ScanLine className="size-5" aria-hidden /></Button>
      </form>
      {view.error && <ErrorBlock error={view.error} />}
      {view.data && <BinCard wh={wh} b={view.data} />}
      <Card>
        <CardHeader title="Where is an item?" />
        <div className="border-t border-border p-4"><ItemPicker stockOnly onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} /></div>
        {item && (
          <ul className="divide-y divide-border border-t border-border text-sm">
            {locs.data?.map((l) => (
              <li key={`${l.binId}-${l.batchKey}`} className="flex items-center gap-3 px-4 py-2">
                <button type="button" className="font-mono text-primary" onClick={() => { setCode(l.bin); setBin(l.bin); }}>{l.bin}</button>
                {l.batchNo && <span className="text-xs text-muted">{l.batchNo}{l.expiryDate && ` · exp ${formatDate(l.expiryDate)}`}</span>}
                {l.isBlocked && <Badge tone="danger">blocked</Badge>}
                <span className="ml-auto tabular-nums">{formatQty(l.qty)}</span>
              </li>
            ))}
            {locs.data && !locs.data.length && <li className="px-4 py-4 text-center text-muted">{item.label} is not in any bin here.</li>}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BinCard({ wh, b }: { wh: string; b: BinView }) {
  const { can } = useAuth();
  const [moving, setMoving] = useState<BinContent | null>(null);
  return (
    <Card>
      <CardHeader title={`Bin ${b.code}`} description={`${b.zone} · ${b.binType}${b.fixedItem ? ` · home of ${b.fixedItem}` : ""}`} action={<span className="flex gap-1"><Badge tone={CONDITION_TONE[b.condition]}>{b.condition}</Badge>{b.isBlocked && <Badge tone="danger">blocked</Badge>}</span>} />
      {b.blockReason && <p className="border-t border-border px-5 py-2 text-xs text-danger">{b.blockReason}</p>}
      <ul className="divide-y divide-border border-t border-border text-sm">
        {b.contents.map((c) => (
          <li key={`${c.itemId}-${c.batchKey}`} className="space-y-2 px-5 py-3">
            <div className="flex items-center gap-3">
              <span><span className="font-mono text-xs text-muted">{c.code}</span> {c.name}{c.batchNo && <span className="block text-xs text-muted">batch {c.batchNo}{c.expiryDate && ` · exp ${formatDate(c.expiryDate)}`}{c.qcStatus && c.qcStatus !== "released" && ` · ${c.qcStatus}`}</span>}</span>
              <span className="ml-auto font-medium tabular-nums">{formatQty(c.qty)} {c.uom}</span>
              {can("wms.tasks.execute") && moving?.itemId !== c.itemId && <Button size="sm" variant="ghost" aria-label="Move" onClick={() => setMoving(c)}><ArrowRightLeft className="size-4" aria-hidden /></Button>}
            </div>
            {moving && moving.itemId === c.itemId && moving.batchKey === c.batchKey && <MoveForm wh={wh} fromBinId={b.id} c={c} onDone={() => setMoving(null)} />}
          </li>
        ))}
        {!b.contents.length && <li className="px-5 py-4 text-center text-muted">Empty.</li>}
      </ul>
    </Card>
  );
}

function MoveForm({ wh, fromBinId, c, onDone }: { wh: string; fromBinId: string; c: BinContent; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ to: "", qty: String(Number(c.qty)), reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [ref] = useState(clientRef);
  async function save() {
    setError(null);
    try {
      const to = await api<BinView>(`${WMS}/warehouses/${wh}/bins/${encodeURIComponent(f.to.trim().toUpperCase())}`);
      await sendOrQueue(`${WMS}/moves`, { itemId: c.itemId, batchId: c.batchKey === "00000000-0000-0000-0000-000000000000" ? null : c.batchKey, fromBinId, toBinId: to.id, qty: Number(f.qty), overrideReason: f.reason || null, clientRef: ref }, `Move ${c.code} to ${f.to.toUpperCase()}`);
      await qc.invalidateQueries({ queryKey: [WMS] });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="space-y-2 rounded-lg bg-surface-muted p-3">
      {error && <Alert>{error}</Alert>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="To bin">{(p) => <Input {...p} autoFocus className="font-mono uppercase" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        <Field label="Quantity">{(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
      </div>
      <Field label="Reason, if overfilling">{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
      <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button><Button size="sm" disabled={!f.to.trim() || !(Number(f.qty) > 0)} onClick={save}>Move</Button></div>
    </div>
  );
}
