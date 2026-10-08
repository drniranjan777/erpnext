"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Printer, ScanLine, Truck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { WMS } from "@/lib/wms";
import { askConfirm } from "@/components/ui/ask";

interface PickTask { id: string; number: string; status: string; pathSeq: number; orderId: string; orderNumber: string; itemId: string; itemCode: string; itemName: string; batchId: string | null; batchNo: string | null; expiryDate: string | null; qty: string; doneQty: string | null; fromBin: string; zone: string; doneBin: string | null; assignee: string | null }
interface WaveView { id: string; number: string; mode: string; status: string; warehouseId: string; shortages: { orderId: string; itemId: string; short: string; why: string }[]; orders: { id: string; number: string; customer: string; packages: number; deliveryId: string | null; deliveryNumber: string | null }[]; tasks: PickTask[] }
interface Packing { toPack: { itemId: string; batchId: string | null; code: string; name: string; left: string }[]; packages: { id: string; sscc: string; kind: string; status: string; contents: { itemId: string; qty: string }[]; grossWeightKg: string | null; deliveryId: string | null }[] }

export default function WavePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [picking, setPicking] = useState<PickTask | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const q = useQuery({ queryKey: [WMS, "wave", id], queryFn: () => api<WaveView>(`${WMS}/waves/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const w = q.data!;
  const exec = can("wms.tasks.execute");
  const refresh = () => qc.invalidateQueries({ queryKey: [WMS] });
  async function act(path: string, done: string) {
    setMsg(null);
    try {
      await api(path, { body: {} });
      setMsg({ tone: "success", text: done });
      refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const zones = [...new Set(w.tasks.map((t) => t.zone))];
  const groups = w.mode === "zone" ? zones.map((z) => ({ title: `Zone ${z}`, tasks: w.tasks.filter((t) => t.zone === z) })) : [{ title: w.mode === "batch" ? "One walk for all orders" : "Pick list", tasks: w.tasks }];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href={`${WMS}/waves?wh=${w.warehouseId}`} className="text-sm text-primary hover:underline">← Waves</Link>
      <PageHeader
        title={`Wave ${w.number}`}
        description={`${w.orders.length} order(s) · ${w.mode} picking`}
        actions={
          <span className="flex flex-wrap gap-2">
            <Badge tone={w.status === "delivered" ? "success" : w.status === "cancelled" ? "neutral" : "primary"}>{w.status}</Badge>
            {exec && w.status === "picked" && <Button onClick={() => act(`${WMS}/waves/${id}/deliveries`, "Draft delivery notes made from the picks. Submit them to issue the stock.")}><Truck className="size-4" aria-hidden /> Make delivery notes</Button>}
            {exec && ["open", "picked"].includes(w.status) && <Button variant="ghost" onClick={async () => await askConfirm("Cancel this wave? Open picks are dropped.") && act(`${WMS}/waves/${id}/cancel`, "Wave cancelled.")}>Cancel wave</Button>}
          </span>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {w.shortages.length > 0 && <Alert tone="warning">Could not allocate everything: {w.shortages.map((s) => `${w.orders.find((o) => o.id === s.orderId)?.number ?? ""} short ${formatQty(s.short)} (${s.why})`).join("; ")}.</Alert>}
      {groups.map((g) => (
        <Card key={g.title}>
          <CardHeader title={g.title} />
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Bin</th><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Batch</th><th className="px-3 py-2 text-right font-medium">Qty</th><th className="px-3 py-2 font-medium">Order</th><th className="px-3 py-2 font-medium" /></tr></thead>
            <tbody className="divide-y divide-border">
              {g.tasks.map((t) => (
                <tr key={t.id} className={t.status === "open" ? "" : "text-muted"}>
                  <td className="px-3 py-2 tabular-nums">{t.pathSeq}</td>
                  <td className="px-3 py-2 font-mono">{t.fromBin}</td>
                  <td className="px-3 py-2">{t.itemCode} · {t.itemName}</td>
                  <td className="px-3 py-2 text-xs">{t.batchNo ?? "–"}{t.expiryDate && <span className="block">exp {formatDate(t.expiryDate)}</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.status === "done" ? `${formatQty(t.doneQty)} / ${formatQty(t.qty)}` : formatQty(t.qty)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{t.orderNumber}</td>
                  <td className="px-3 py-2 text-right">{t.status === "open" ? exec && <Button size="sm" onClick={() => setPicking(t)}><ScanLine className="size-4" aria-hidden /> Pick</Button> : <Badge tone={t.status === "done" ? "success" : "neutral"}>{t.status}{t.doneBin && t.doneBin !== t.fromBin ? ` from ${t.doneBin}` : ""}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      ))}
      {w.status !== "cancelled" && w.orders.map((o) => <PackCard key={o.id} waveId={id} order={o} canPack={exec && w.status !== "delivered"} />)}
      {picking && <PickDialog t={picking} onClose={() => { setPicking(null); refresh(); }} />}
    </div>
  );
}

function PickDialog({ t, onClose }: { t: PickTask; onClose: () => void }) {
  const [f, setF] = useState({ bin: "", qty: String(Number(t.qty)) });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${WMS}/picks/${t.id}/confirm`, { body: { binCode: f.bin, qty: Number(f.qty) } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Pick ${formatQty(t.qty)} × ${t.itemCode}`} description={`From ${t.fromBin}${t.batchNo ? `, batch ${t.batchNo}` : ""}. Scan the bin label, then confirm the quantity taken.`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={!f.bin.trim()} onClick={save}>Confirm</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bin scanned">{(p) => <Input {...p} autoFocus className="font-mono uppercase" placeholder={t.fromBin} value={f.bin} onChange={(e) => setF({ ...f, bin: e.target.value })} />}</Field>
        <Field label="Quantity taken" hint="Less than asked records a short pick">{(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function PackCard({ waveId, order, canPack }: { waveId: string; order: WaveView["orders"][number]; canPack: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [WMS, "packing", order.id], queryFn: () => api<Packing>(`${WMS}/orders/${order.id}/packing`) });
  const [add, setAdd] = useState({ itemKey: "", qty: "" });
  const [weight, setWeight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = q.data?.packages.find((p) => p.status === "open");
  async function run(path: string, payload: unknown) {
    setError(null);
    try {
      await api(path, { body: payload });
      setAdd({ itemKey: "", qty: "" });
      setWeight("");
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const chosen = q.data?.toPack.find((x) => `${x.itemId}|${x.batchId ?? ""}` === add.itemKey);
  return (
    <Card>
      <CardHeader
        title={`Pack ${order.number} · ${order.customer}`}
        action={order.deliveryId ? <Link className="text-sm text-primary hover:underline" href={`${WMS}/loading?delivery=${order.deliveryId}`}>Load {order.deliveryNumber ?? "the delivery"}</Link> : canPack && !open && <Button size="sm" variant="secondary" onClick={() => run(`${WMS}/packages`, { orderId: order.id, waveId })}><PackagePlus className="size-4" aria-hidden /> New carton</Button>}
      />
      <div className="space-y-3 border-t border-border p-4 text-sm">
        {error && <Alert>{error}</Alert>}
        {q.data?.toPack.length ? <p className="text-xs text-muted">Picked, not packed: {q.data.toPack.map((x) => `${x.code} ${formatQty(x.left)}`).join(" · ")}</p> : <p className="text-xs text-muted">Everything picked is packed.</p>}
        {open && canPack && (
          <div className="space-y-2 rounded-lg bg-surface-muted p-3">
            <p className="font-mono text-xs">Open carton {open.sscc} · {open.contents.length} line(s)</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Item">{(p) => <Select {...p} className="w-64" value={add.itemKey} onChange={(e) => { const x = q.data?.toPack.find((t) => `${t.itemId}|${t.batchId ?? ""}` === e.target.value); setAdd({ itemKey: e.target.value, qty: x ? String(Number(x.left)) : "" }); }}><option value="">Choose…</option>{q.data?.toPack.map((x) => <option key={`${x.itemId}|${x.batchId ?? ""}`} value={`${x.itemId}|${x.batchId ?? ""}`}>{x.code} · {formatQty(x.left)} left</option>)}</Select>}</Field>
              <Field label="Qty">{(p) => <Input {...p} className="w-24" inputMode="decimal" value={add.qty} onChange={(e) => setAdd({ ...add, qty: e.target.value })} />}</Field>
              <Button size="sm" disabled={!chosen || !(Number(add.qty) > 0)} onClick={() => run(`${WMS}/packages/${open.id}/items`, { itemId: chosen!.itemId, batchId: chosen!.batchId, qty: Number(add.qty) })}>Add</Button>
              <Field label="Gross kg">{(p) => <Input {...p} className="w-24" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />}</Field>
              <Button size="sm" variant="secondary" disabled={!open.contents.length} onClick={() => run(`${WMS}/packages/${open.id}/close`, { grossWeightKg: weight ? Number(weight) : null })}>Close carton</Button>
            </div>
          </div>
        )}
        <ul className="divide-y divide-border">
          {q.data?.packages.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-1.5">
              <span className="font-mono text-xs">{p.sscc}</span>
              <span className="text-xs text-muted">{p.kind} · {p.contents.length} line(s){p.grossWeightKg && ` · ${Number(p.grossWeightKg)} kg`}</span>
              <Badge tone={p.status === "loaded" ? "success" : p.status === "closed" ? "primary" : "warning"} className="ml-auto">{p.status}</Badge>
              {p.status !== "open" && <Link href={`/print/sscc/${p.id}`} target="_blank" aria-label="Print label"><Printer className="size-4 text-primary" aria-hidden /></Link>}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
