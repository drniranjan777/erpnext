"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanLine } from "lucide-react";
import { Suspense, useState } from "react";
import { OfflineBanner } from "@/components/wms/offline-banner";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty } from "@/lib/documents";
import { sendOrQueue } from "@/lib/offline-queue";
import { useWarehouseParam, WMS, type Task } from "@/lib/wms";

export default function TasksPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Tasks />
    </Suspense>
  );
}

function Tasks() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { wh, loading, current } = useWarehouseParam();
  const [status, setStatus] = useState("open");
  const [doing, setDoing] = useState<Task | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const q = useQuery({ queryKey: [WMS, "tasks", wh, status], queryFn: () => api<Task[]>(`${WMS}/tasks`, { query: { warehouseId: wh ?? undefined, status: status || undefined } }), enabled: !!wh });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  const exec = can("wms.tasks.execute");
  async function plan() {
    setMsg(null);
    try {
      const r = await api<{ created: number }>(`${WMS}/warehouses/${wh}/putaway`, { body: {} });
      setMsg({ tone: "success", text: r.created ? `${r.created} put-away task(s) planned.` : "Nothing is waiting in the receiving bin." });
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  async function cancel(t: Task) {
    if (!window.confirm(`Cancel ${t.number}?`)) return;
    await api(`${WMS}/tasks/${t.id}/cancel`, { body: {} }).catch(() => null);
    qc.invalidateQueries({ queryKey: [WMS] });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Floor tasks · ${current.code}`} description="Put-away suggested by the rules (fixed bin, same batch, storage condition, hazard segregation, capacity, nearest empty). Confirm each by scanning the bin used." actions={<><WarehouseSelect />{exec && <Button onClick={plan}>Plan put-away</Button>}</>} />
      <OfflineBanner />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="done">Done</option><option value="cancelled">Cancelled</option><option value="">All</option></Select>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Task</th><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 text-right font-medium">Qty</th><th className="px-4 py-2 font-medium">From</th><th className="px-4 py-2 font-medium">To</th><th className="px-4 py-2 font-medium">Why</th><th className="px-4 py-2 font-medium" /></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2"><span className="font-mono text-xs">{t.number}</span> <Badge>{t.kind}</Badge></td>
                  <td className="px-4 py-2">{t.itemCode} · {t.itemName}{t.batchNo && <span className="block text-xs text-muted">batch {t.batchNo}</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(t.doneQty ?? t.qty)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{t.fromBin ?? "–"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{t.status === "done" ? t.doneBin : t.toBin ?? <span className="font-sans text-warning">choose</span>}{t.status === "done" && t.toBin && t.doneBin !== t.toBin && <span className="block font-sans text-muted">suggested {t.toBin}</span>}</td>
                  <td className="px-4 py-2 text-xs text-muted">{t.reason}{t.overrideReason && ` · override: ${t.overrideReason}`}</td>
                  <td className="px-4 py-2 text-right">
                    {t.status === "open" && exec && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => setDoing(t)}><ScanLine className="size-4" aria-hidden /> Confirm</Button>
                        <Button size="sm" variant="ghost" onClick={() => cancel(t)}>Cancel</Button>
                      </span>
                    )}
                    {t.status !== "open" && <Badge tone={t.status === "done" ? "success" : "neutral"}>{t.status}</Badge>}
                  </td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No tasks.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {doing && <ConfirmDialog t={doing} onClose={() => { setDoing(null); qc.invalidateQueries({ queryKey: [WMS] }); }} />}
    </div>
  );
}

function ConfirmDialog({ t, onClose }: { t: Task; onClose: () => void }) {
  const [f, setF] = useState({ binCode: "", qty: String(Number(t.qty)), overrideReason: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setError(null);
    setBusy(true);
    try {
      await sendOrQueue(`${WMS}/tasks/${t.id}/confirm`, { binCode: f.binCode, qty: Number(f.qty), overrideReason: f.overrideReason || null }, `${t.number} to ${f.binCode.toUpperCase()}`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={`${t.number}: ${t.itemCode}`} description={`Take ${formatQty(t.qty)} from ${t.fromBin ?? "?"}${t.toBin ? ` to ${t.toBin}` : ""}. Scan the bin label where you put it.`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} disabled={!f.binCode.trim() || !(Number(f.qty) > 0)} onClick={save}>Confirm</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Bin scanned">{(p) => <Input {...p} autoFocus autoCapitalize="characters" placeholder={t.toBin ?? "Scan or type the bin code"} value={f.binCode} onChange={(e) => setF({ ...f, binCode: e.target.value })} onKeyDown={(e) => e.key === "Enter" && f.binCode && save()} />}</Field>
        <Field label="Quantity put away" hint="Less than the task leaves the rest in the receiving bin for the next plan">{(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
        <Field label="Reason, if overfilling the bin">{(p) => <Input {...p} value={f.overrideReason} onChange={(e) => setF({ ...f, overrideReason: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
