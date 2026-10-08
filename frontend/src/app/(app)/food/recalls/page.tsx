"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { askText } from "@/components/ui/ask";

interface Recall { id: string; code: string; kind: string; batchNo: string; reason: string; recallClass: string | null; startedAt: string; traceCompletedAt: string | null; status: string; conclusion: string | null; trace: { customers: { party: string; documents: string[]; qty: number }[]; lotsMadeFrom: { item: string; batchNo: string | null }[]; usedIn: { item: string; batchNo: string | null }[]; onHand: { warehouse: string; qty: number }[]; dispatchedQty: number } | null; recovered: { party: string; qty: number; note: string | null; at: string }[]; metrics: { traceMinutes: number | null; recoveredQty: number; recoveredPct: number | null } }

/** Recalls and mock-recall drills: the lot traced to every customer at once; trace time and recovery measured. */
export default function RecallsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("food.recalls.manage");
  const list = useQuery({ queryKey: ["/food/recalls"], queryFn: () => api<Recall[]>("/food/recalls") });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rec, setRec] = useState({ party: "", qty: "", note: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const r = list.data?.find((x) => x.id === open);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/food/recalls"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Recalls and mock recalls" description="Start a recall or a drill for a lot: it is traced at once through the lot genealogy to every customer who received it (and the products made from it). Confirm when every customer is contacted, and record what comes back." actions={manage && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Start</Button>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
        <Card>
          <ul className="divide-y divide-border text-sm">
            {list.data?.map((x) => (
              <li key={x.id}>
                <button type="button" className={`w-full px-4 py-2 text-left hover:bg-surface-muted ${open === x.id ? "bg-surface-muted" : ""}`} onClick={() => setOpen(x.id)}>
                  <p className="flex items-center gap-2"><Badge tone={x.kind === "real" ? "danger" : "neutral"}>{x.kind}</Badge><span className="font-medium">{x.code}</span><span className="text-xs">batch {x.batchNo}</span><Badge className="ml-auto" tone={x.status === "open" ? "warning" : "success"}>{x.status}</Badge></p>
                  <p className="text-xs text-muted">{formatDateTime(x.startedAt)} · {x.metrics.recoveredPct ?? 0} % recovered{x.metrics.traceMinutes !== null ? ` · traced in ${x.metrics.traceMinutes} min` : ""}</p>
                </button>
              </li>
            ))}
            {list.data && !list.data.length && <li className="px-4 py-6 text-center text-muted">No recalls or drills yet.</li>}
          </ul>
        </Card>
        {r && (
          <Card>
            <CardHeader title={`${r.code}: ${r.reason}`} description={`${r.recallClass ? `Class ${r.recallClass} · ` : ""}${r.trace?.dispatchedQty ?? 0} dispatched · ${r.metrics.recoveredQty} recovered`} action={manage && r.status === "open" && <span className="flex gap-1">{!r.traceCompletedAt && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/food/recalls/${r.id}/trace-done`, { body: {} }), "Trace confirmed.")}>All customers contacted</Button>}<Button size="sm" onClick={async () => { const c = await askText("Conclusion"); if (c) run(() => api(`/food/recalls/${r.id}/close`, { body: { conclusion: c } }), "Closed."); }}>Close</Button></span>} />
            <div className="space-y-3 border-t border-border p-4 text-sm">
              <div><p className="font-medium">Customers</p>{r.trace?.customers.map((c) => <p key={c.party}>{c.party}: {c.qty} ({c.documents.join(", ")})</p>)}{!r.trace?.customers.length && <p className="text-muted">None: nothing left the company.</p>}</div>
              <div><p className="font-medium">Still in stock</p>{r.trace?.onHand.map((h, i) => <p key={i}>{h.warehouse}: {h.qty}</p>)}{!r.trace?.onHand.length && <p className="text-muted">None.</p>}</div>
              {r.trace && r.trace.usedIn.length > 0 && <div><p className="font-medium">Used in</p><p>{r.trace.usedIn.map((u) => `${u.item} ${u.batchNo ?? ""}`).join("; ")}</p></div>}
              {r.trace && r.trace.lotsMadeFrom.length > 0 && <div><p className="font-medium">Made from</p><p>{r.trace.lotsMadeFrom.map((u) => `${u.item} ${u.batchNo ?? ""}`).join("; ")}</p></div>}
              <div><p className="font-medium">Recovered</p>{r.recovered.map((x, i) => <p key={i}>{x.party}: {x.qty}{x.note ? ` — ${x.note}` : ""} <span className="text-xs text-muted">{formatDateTime(x.at)}</span></p>)}</div>
              {manage && r.status === "open" && (
                <div className="flex flex-wrap gap-2">
                  <Select className="h-9 w-48" aria-label="From" value={rec.party} onChange={(e) => setRec({ ...rec, party: e.target.value })}><option value="">From…</option>{r.trace?.customers.map((c) => <option key={c.party}>{c.party}</option>)}<option value="Own stock">Own stock</option></Select>
                  <Input className="h-9 w-24" type="number" min={0} aria-label="Quantity" value={rec.qty} onChange={(e) => setRec({ ...rec, qty: e.target.value })} />
                  <Input className="h-9 flex-1" aria-label="Note" placeholder="Note" value={rec.note} onChange={(e) => setRec({ ...rec, note: e.target.value })} />
                  <Button size="sm" disabled={!rec.party || !Number(rec.qty)} onClick={() => run(() => api(`/food/recalls/${r.id}/recovered`, { body: { party: rec.party, qty: Number(rec.qty), note: rec.note || null } }), "Recorded.").then(() => setRec({ party: "", qty: "", note: "" }))}>Record</Button>
                </div>
              )}
              {r.conclusion && <p className="text-xs">Conclusion: {r.conclusion}</p>}
            </div>
          </Card>
        )}
      </div>
      {creating && <StartRecall onClose={() => setCreating(false)} onStarted={(id) => { setCreating(false); setOpen(id); qc.invalidateQueries({ queryKey: ["/food/recalls"] }); }} />}
    </div>
  );
}

function StartRecall({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const [f, setF] = useState({ code: "", kind: "mock", itemId: "", itemLabel: "", batchNo: "", reason: "", recallClass: "" });
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setError(null);
    try {
      const r = await api<{ id: string }>("/food/recalls", { body: { code: f.code, kind: f.kind, itemId: f.itemId, batchNo: f.batchNo, reason: f.reason, recallClass: f.recallClass || null } });
      onStarted(r.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Start a recall or a drill" footer={<Button disabled={!f.code || !f.itemId || !f.batchNo || f.reason.length < 3} onClick={start}>Start and trace</Button>}>
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Code" placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="mock">Mock recall (drill)</option><option value="real">Real recall</option></Select>
          <Select aria-label="Class" value={f.recallClass} onChange={(e) => setF({ ...f, recallClass: e.target.value })}><option value="">Class…</option><option value="I">Class I (serious risk)</option><option value="II">Class II</option><option value="III">Class III</option></Select>
        </div>
        {f.itemLabel ? <p>{f.itemLabel}</p> : <ItemPicker placeholder="Product or material" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}
        <Input aria-label="Batch" placeholder="Batch" value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />
        <Input aria-label="Reason" placeholder="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </div>
    </Dialog>
  );
}
