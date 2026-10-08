"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty } from "@/lib/documents";
import { WMS } from "@/lib/wms";
import { askConfirm } from "@/components/ui/ask";

interface Line { id: string; binId: string; bin: string; itemId: string; itemCode: string; itemName: string; batchNo: string | null; systemQty: string | null; countedQty: string | null }
interface CountView { id: string; number: string; status: string; blind: boolean; warehouseId: string; accuracyPct: string | null; lines: Line[] }

export default function CountPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const q = useQuery({ queryKey: [WMS, "count", id], queryFn: () => api<CountView>(`${WMS}/counts/${id}`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const c = q.data!;
  const open = c.status === "open" && can("wms.tasks.execute");
  const bins = [...new Map(c.lines.map((l) => [l.binId, l.bin])).entries()];
  async function save(line: Line, value: string) {
    if (value === "" || Number(value) === Number(line.countedQty ?? NaN)) return;
    await api(`${WMS}/counts/${id}/lines/${line.id}`, { body: { countedQty: Number(value) } }).catch((err) => setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not save" }));
    qc.invalidateQueries({ queryKey: [WMS, "count", id] });
  }
  async function act(path: string, done: string) {
    setMsg(null);
    try {
      const r = await api<{ accuracyPct?: string; adjusted?: number }>(path, { body: {} });
      setMsg({ tone: "success", text: r.accuracyPct ? `${done} ${r.adjusted} difference(s) posted; ${r.accuracyPct} % of lines matched.` : done });
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href={`${WMS}/counts?wh=${c.warehouseId}`} className="text-sm text-primary hover:underline">← Counts</Link>
      <PageHeader
        title={`Count ${c.number}`}
        description={c.blind && c.status === "open" ? "Blind count: book quantities show after posting. Enter 0 where nothing is found." : undefined}
        actions={
          <span className="flex gap-2">
            <Badge tone={c.status === "posted" ? "success" : "primary"}>{c.status}</Badge>
            {open && can("inventory.entries.manage") && <Button onClick={() => act(`${WMS}/counts/${id}/post`, "Posted.")}>Post differences</Button>}
            {open && <Button variant="ghost" onClick={async () => await askConfirm("Cancel this count?") && act(`${WMS}/counts/${id}/cancel`, "Cancelled.")}>Cancel</Button>}
          </span>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {bins.map(([binId, code]) => (
        <Card key={binId}>
          <CardHeader title={`Bin ${code}`} />
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <tbody className="divide-y divide-border">
              {c.lines.filter((l) => l.binId === binId).map((l) => {
                const diff = l.systemQty !== null && l.countedQty !== null ? Number(l.countedQty) - Number(l.systemQty) : null;
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{l.itemCode}</span> {l.itemName}{l.batchNo && <span className="block text-xs text-muted">batch {l.batchNo}</span>}</td>
                    {l.systemQty !== null && <td className="px-4 py-2 text-right text-xs text-muted tabular-nums">book {formatQty(l.systemQty)}</td>}
                    <td className="w-36 px-4 py-2 text-right">{open ? <Input aria-label="Counted" className="text-right tabular-nums" inputMode="decimal" defaultValue={l.countedQty === null ? "" : String(Number(l.countedQty))} onBlur={(e) => save(l, e.target.value)} /> : <span className="tabular-nums">{l.countedQty === null ? "–" : formatQty(l.countedQty)}</span>}</td>
                    {diff !== null && <td className={`px-4 py-2 text-right tabular-nums ${diff ? "text-danger" : "text-muted"}`}>{diff > 0 ? "+" : ""}{formatQty(diff)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </Card>
      ))}
      {open && <Found countId={id} bins={bins} />}
    </div>
  );
}

function Found({ countId, bins }: { countId: string; bins: [string, string][] }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ binId: bins[0]?.[0] ?? "", batchNo: "", qty: "" });
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setError(null);
    try {
      await api(`${WMS}/counts/${countId}/found`, { body: { binId: f.binId, itemId: item!.id, batchNo: f.batchNo || null, countedQty: Number(f.qty) } });
      setF({ ...f, batchNo: "", qty: "" });
      setItem(null);
      qc.invalidateQueries({ queryKey: [WMS, "count", countId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="Found something else in a bin?" />
      <div className="space-y-3 border-t border-border p-4">
        {error && <Alert>{error}</Alert>}
        {item ? <p className="text-sm">{item.label} <button type="button" className="text-primary" onClick={() => setItem(null)}>change</button></p> : <ItemPicker stockOnly onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Bin">{(p) => <Select {...p} value={f.binId} onChange={(e) => setF({ ...f, binId: e.target.value })}>{bins.map(([id, code]) => <option key={id} value={id}>{code}</option>)}</Select>}</Field>
          <Field label="Batch">{(p) => <Input {...p} className="w-36" value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />}</Field>
          <Field label="Counted">{(p) => <Input {...p} className="w-28" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
          <Button disabled={!item || f.qty === ""} onClick={add}>Add</Button>
        </div>
      </div>
    </Card>
  );
}
