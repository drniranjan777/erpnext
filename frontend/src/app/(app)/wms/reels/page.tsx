"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty } from "@/lib/documents";
import { WMS } from "@/lib/wms";
import { askText } from "@/components/ui/ask";
import { DataTable } from "@/components/ui/data-table";

interface Reel { id: string; openedAt: string | null; code: string; itemCode: string; itemName: string; batchNo: string | null; warehouse: string | null; bin: string | null; qty: string; mslLevel: string | null; status: string; bakeCount: number; usedMinutes: number; remainingMinutes: number | null; expired: boolean }
const TONE = { sealed: "neutral", open: "warning", expired: "danger", empty: "neutral" } as const;
const hm = (m: number) => `${Math.floor(m / 60)} h ${m % 60} min`;

/** Moisture-sensitive reels: open (clock runs), seal into dry pack (clock stops), bake (clock resets), use. */
export default function ReelsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: [WMS, "reels", status], queryFn: () => api<Reel[]>(`${WMS}/reels`, { query: { status: status || undefined } }), refetchInterval: 60_000 });
  const [nr, setNr] = useState({ code: "", qty: "", batchNo: "", mslLevel: "" });
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const exec = can("wms.tasks.execute");
  async function event(r: Reel, kind: string) {
    setMsg(null);
    let qty: number | undefined;
    if (kind === "use") {
      const v = await askText(`Parts taken from ${r.code}?`);
      if (!v) return;
      qty = Number(v);
    }
    try {
      await api(`${WMS}/reels/${r.id}/events`, { body: { kind, qty } });
      qc.invalidateQueries({ queryKey: [WMS, "reels"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  async function create() {
    setMsg(null);
    try {
      await api(`${WMS}/reels`, { body: { code: nr.code, itemId: item?.id, qty: Number(nr.qty), batchNo: nr.batchNo || null, mslLevel: nr.mslLevel || null } });
      setNr({ code: "", qty: "", batchNo: "", mslLevel: "" });
      setItem(null);
      qc.invalidateQueries({ queryKey: [WMS, "reels"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Reels and floor life" description="Moisture-sensitive parts (J-STD-033): floor life runs while a reel is out of dry pack; level 3 allows 168 hours, level 5a 24. Expired reels must be baked." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">In use</option><option value="open">Open</option><option value="sealed">Sealed</option><option value="expired">Expired</option><option value="empty">Empty</option></Select>
      <Card>
        <DataTable
          rows={q.data ?? []}
          rowKey={(r) => String(r.id)}
          exportName="wms-reels"
          storageKey="wms-reels-0"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No reels.</p>}
          columns={[
            { key: "reel", label: "Reel", locked: true, className: "font-mono whitespace-normal", render: (r) => <>{r.code}</> },
            { key: "part", label: "Part", className: "whitespace-normal", render: (r) => <>{r.itemCode}{r.batchNo && <span className="block text-xs text-muted">{r.batchNo}</span>}</> },
            { key: "where", label: "Where", className: "text-xs whitespace-normal", render: (r) => <>{[r.warehouse, r.bin].filter(Boolean).join(" · ") || "–"}</> },
            { key: "qty", label: "Qty", align: "right", render: (r) => <>{formatQty(r.qty)}</> },
            { key: "msl", label: "MSL", className: "whitespace-normal", render: (r) => <>{r.mslLevel ?? "–"}</> },
            { key: "floor-life-left", label: "Floor life left", className: "whitespace-normal", render: (r) => <>{r.remainingMinutes === null ? "no limit" : hm(r.remainingMinutes)}{r.bakeCount > 0 && <span className="block text-xs text-muted">baked {r.bakeCount}×</span>}</> },
            { key: "col6", label: "", align: "right", noSort: true, render: (r) => <><Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge>
                            {exec && r.openedAt && !r.expired && <Button size="sm" variant="ghost" onClick={() => event(r, "use")}>Use</Button>}
                            {exec && r.openedAt && <Button size="sm" variant="ghost" onClick={() => event(r, "seal")}>Seal</Button>}
                            {exec && !r.openedAt && r.status === "sealed" && !r.expired && <Button size="sm" variant="ghost" onClick={() => event(r, "open")}>Open</Button>}
                            {exec && !r.openedAt && r.status !== "empty" && r.expired && <Button size="sm" variant="ghost" onClick={() => event(r, "bake")}>Baked</Button>}</> },
          ]}
        />
      </Card>
      {exec && (
        <Card>
          <CardHeader title="Register a reel" />
          <div className="space-y-3 border-t border-border p-4">
            {item ? <p className="text-sm">{item.label} <button type="button" className="text-primary" onClick={() => setItem(null)}>change</button></p> : <ItemPicker stockOnly onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />}
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Reel ID">{(p) => <Input {...p} className="w-40 font-mono" value={nr.code} onChange={(e) => setNr({ ...nr, code: e.target.value })} />}</Field>
              <Field label="Qty">{(p) => <Input {...p} className="w-24" inputMode="decimal" value={nr.qty} onChange={(e) => setNr({ ...nr, qty: e.target.value })} />}</Field>
              <Field label="Batch / lot">{(p) => <Input {...p} className="w-32" value={nr.batchNo} onChange={(e) => setNr({ ...nr, batchNo: e.target.value })} />}</Field>
              <Field label="MSL" hint="Blank: from the item">{(p) => <Select {...p} value={nr.mslLevel} onChange={(e) => setNr({ ...nr, mslLevel: e.target.value })}><option value="">Item&apos;s</option>{["1", "2", "2a", "3", "4", "5", "5a", "6"].map((l) => <option key={l} value={l}>{l}</option>)}</Select>}</Field>
              <Button disabled={!item || nr.code.length < 3 || !(Number(nr.qty) > 0)} onClick={create}>Register</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
