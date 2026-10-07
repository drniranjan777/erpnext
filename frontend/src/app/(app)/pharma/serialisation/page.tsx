"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Ceiling { id: string; itemCode: string; itemName: string; mrp: number | null; ceilingPrice: number; notification: string | null; effectiveFrom: string }
interface Check { sales: { invoice: string; date: string; item: string; unitPrice: number; ceiling: number; excess: number }[]; mrp: { item: string; mrp: number; ceiling: number; notification: string | null }[] }

/** Serialisation (GS1 SGTIN, aggregation to SSCC), API label QR codes and DPCO ceiling prices. */
export default function SerialisationPage() {
  const { can } = useAuth();
  const manage = can("pharma.serials.manage");
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [c, setC] = useState({ itemId: "", itemLabel: "", gtin: "", batchNo: "", expiryDate: "", count: "100" });
  const [agg, setAgg] = useState({ level: "carton", codes: "" });
  const [look, setLook] = useState("");
  const [found, setFound] = useState<Record<string, unknown> | null>(null);
  const [made, setMade] = useState<{ serial: string; hri: string }[]>([]);
  async function run<T>(fn: () => Promise<T>, done: (r: T) => string) {
    setMsg(null);
    try {
      setMsg({ tone: "success", text: done(await fn()) });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Serialisation" description="Unique random serial numbers per pack (GS1 GTIN + serial, printed as a DataMatrix with batch and expiry), packed into cartons and SSCC-numbered shippers and pallets, with an export of the hierarchy for the regulator's portal." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {manage && (
        <Card>
          <CardHeader title="Commission serial numbers" />
          <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
            <div className="min-w-56 flex-1">{c.itemLabel ? <p className="flex h-9 items-center">{c.itemLabel}</p> : <ItemPicker placeholder="Product" onPick={(i) => setC({ ...c, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}</div>
            <Input className="h-9 w-40" aria-label="GTIN" placeholder="GTIN" value={c.gtin} onChange={(e) => setC({ ...c, gtin: e.target.value })} />
            <Input className="h-9 w-28" aria-label="Batch" placeholder="Batch" value={c.batchNo} onChange={(e) => setC({ ...c, batchNo: e.target.value })} />
            <Input className="h-9 w-40" type="date" aria-label="Expiry" value={c.expiryDate} onChange={(e) => setC({ ...c, expiryDate: e.target.value })} />
            <Input className="h-9 w-24" type="number" min={1} max={10000} aria-label="How many" value={c.count} onChange={(e) => setC({ ...c, count: e.target.value })} />
            <Button disabled={!c.itemId || !c.gtin || !c.batchNo || !c.expiryDate} onClick={() => run(() => api<{ count: number; units: { serial: string; hri: string }[] }>("/pharma/serials/commission", { body: { itemId: c.itemId, gtin: c.gtin, batchNo: c.batchNo, expiryDate: c.expiryDate, count: Number(c.count) } }), (r) => { setMade(r.units); return `${r.count} serial numbers commissioned.`; })}>Commission</Button>
          </div>
          {made.length > 0 && <pre className="max-h-40 overflow-auto border-t border-border p-4 text-xs">{made.map((u) => u.hri).join("\n")}</pre>}
        </Card>
      )}
      {manage && (
        <Card>
          <CardHeader title="Pack (aggregate)" description="Scan the units (or cartons, for a shipper; shippers, for a pallet), one per line." />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <Select className="h-9 w-40" aria-label="Into a" value={agg.level} onChange={(e) => setAgg({ ...agg, level: e.target.value })}><option value="carton">Carton</option><option value="shipper">Shipper (SSCC)</option><option value="pallet">Pallet (SSCC)</option></Select>
            <textarea aria-label="Codes" rows={5} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" value={agg.codes} onChange={(e) => setAgg({ ...agg, codes: e.target.value })} />
            <Button disabled={!agg.codes.trim()} onClick={() => run(() => api<{ code: string; units: number; containers: number; mixedBatches: boolean }>("/pharma/serials/aggregate", { body: { level: agg.level, children: agg.codes.split("\n").map((x) => x.trim()).filter(Boolean) } }), (r) => { setAgg({ ...agg, codes: "" }); return `${agg.level} ${r.code}: ${r.units || r.containers} packed${r.mixedBatches ? " (mixed batches)" : ""}.`; })}>Pack</Button>
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Verify a code" description="A pack's DataMatrix, a carton code or an SSCC." />
        <div className="flex gap-2 border-t border-border p-4">
          <Input className="h-9 flex-1 font-mono" aria-label="Code" value={look} onChange={(e) => setLook(e.target.value)} />
          <Button variant="secondary" disabled={!look.trim()} onClick={async () => { setMsg(null); try { setFound(await api<Record<string, unknown>>("/pharma/serials/lookup", { query: { code: look.trim() } })); } catch (err) { setFound(null); setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." }); } }}>Verify</Button>
        </div>
        {found && (
          <div className="border-t border-border p-4 text-sm">
            {found.kind === "unit" ? (
              <>
                <Badge tone={found.genuine ? "success" : "danger"}>{found.genuine ? "Genuine" : "Not valid"}</Badge>
                {"message" in found ? <p className="mt-1">{String(found.message)}</p> : <p className="mt-1">{String(found.hri)} · {String(found.status)}{found.reason ? ` (${String(found.reason)})` : ""}{Array.isArray(found.parents) && found.parents.length ? ` · in ${(found.parents as { code: string; level: string }[]).map((p) => `${p.level} ${p.code}`).join(" › ")}` : ""}</p>}
              </>
            ) : (
              <p>{String(found.level)} {String(found.code)}: {String(found.units)} unit(s), batch {String(found.batchNo ?? "mixed")}</p>
            )}
          </div>
        )}
      </Card>
      <ExportCard />
      <p className="text-sm"><Link className="text-primary hover:underline" href="/print/api-labels">Print API labels with QR codes</Link></p>
      <DpcoCard />
    </div>
  );
}

function ExportCard() {
  const [f, setF] = useState({ itemId: "", itemLabel: "", batchNo: "" });
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setError(null);
    try {
      const r = await api<unknown>("/pharma/serials/export", { query: { itemId: f.itemId, batchNo: f.batchNo } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `serialisation-${f.batchNo}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="Export a batch" description="Units within cartons, shippers and pallets, as JSON for the export portal." />
      <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
        {error && <div className="w-full"><Alert>{error}</Alert></div>}
        <div className="min-w-56 flex-1">{f.itemLabel ? <p className="flex h-9 items-center">{f.itemLabel}</p> : <ItemPicker placeholder="Product" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}</div>
        <Input className="h-9 w-32" aria-label="Batch" placeholder="Batch" value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />
        <Button variant="secondary" disabled={!f.itemId || !f.batchNo} onClick={download}>Download</Button>
      </div>
    </Card>
  );
}

function DpcoCard() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const ceilings = useQuery({ queryKey: ["/pharma/dpco/ceilings"], queryFn: () => api<Ceiling[]>("/pharma/dpco/ceilings") });
  const check = useQuery({ queryKey: ["/pharma/dpco/check"], queryFn: () => api<Check>("/pharma/dpco/check") });
  const [f, setF] = useState({ itemId: "", itemLabel: "", ceilingPrice: "", notification: "", effectiveFrom: "" });
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setError(null);
    try {
      await api("/pharma/dpco/ceilings", { body: { itemId: f.itemId, ceilingPrice: Number(f.ceilingPrice), notification: f.notification || null, effectiveFrom: f.effectiveFrom } });
      setF({ itemId: "", itemLabel: "", ceilingPrice: "", notification: "", effectiveFrom: "" });
      qc.invalidateQueries({ queryKey: ["/pharma/dpco"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="DPCO ceiling prices" description="Ceiling prices notified by NPPA for scheduled formulations (per unit, before GST). Sales and MRPs above the ceiling in force are listed." />
      {error && <div className="px-4 pb-2"><Alert>{error}</Alert></div>}
      {check.data && (check.data.mrp.length > 0 || check.data.sales.length > 0) && (
        <div className="space-y-1 border-t border-border p-4 text-sm text-danger">
          {check.data.mrp.map((m) => <p key={m.item}>{m.item}: MRP ₹{m.mrp} is above the ceiling ₹{m.ceiling}{m.notification ? ` (${m.notification})` : ""}</p>)}
          {check.data.sales.map((s) => <p key={`${s.invoice}${s.item}`}>{s.invoice} {s.date}: {s.item} sold at ₹{s.unitPrice} per unit, ₹{s.excess} above the ceiling</p>)}
        </div>
      )}
      <ul className="divide-y divide-border border-t border-border text-sm">
        {ceilings.data?.map((x) => <li key={x.id} className="flex gap-3 px-4 py-1.5"><span className="flex-1">{x.itemCode} · {x.itemName}</span><span>₹{x.ceilingPrice} from {x.effectiveFrom}</span><span className="text-xs text-muted">{x.notification}</span></li>)}
        {ceilings.data && !ceilings.data.length && <li className="px-4 py-3 text-muted">No ceilings recorded.</li>}
      </ul>
      {can("pharma.pricing.manage") && (
        <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
          <div className="min-w-56 flex-1">{f.itemLabel ? <p className="flex h-9 items-center">{f.itemLabel}</p> : <ItemPicker placeholder="Formulation" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}</div>
          <Input className="h-9 w-28" type="number" step="0.01" aria-label="Ceiling price" placeholder="Ceiling ₹" value={f.ceilingPrice} onChange={(e) => setF({ ...f, ceilingPrice: e.target.value })} />
          <Input className="h-9 w-40" aria-label="Notification" placeholder="S.O. number" value={f.notification} onChange={(e) => setF({ ...f, notification: e.target.value })} />
          <Input className="h-9 w-40" type="date" aria-label="Effective from" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
          <Button disabled={!f.itemId || !f.ceilingPrice || !f.effectiveFrom} onClick={add}>Add</Button>
        </div>
      )}
    </Card>
  );
}
