"use client";

import { useQuery } from "@tanstack/react-query";
import { Palette, Scale } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Info } from "@/components/documents/doc-page";
import { Field, Input } from "@/components/ui/field";
import { ItemPicker } from "@/components/item-picker";
import { api, ApiError } from "@/lib/api";
import { formatQty } from "@/lib/documents";
import type { WorkOrder } from "@/lib/manufacturing";
import { BASIS_LABEL, PROC, type BatchView } from "@/lib/process";
import { ErrorBlock, LoadingBlock } from "@/components/ui/page";

/** Formula, dispensing record, stage readings and yield of a process batch. */
export function BatchPanel({ w, onChanged }: { w: WorkOrder; onChanged: (text: string) => void }) {
  const q = useQuery({ queryKey: [PROC, "batch", w.id, w.version], queryFn: () => api<BatchView>(`${PROC}/batches/${w.id}`) });
  const [dispensing, setDispensing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const b = q.data;
  if (!b) return q.isError ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  const ingredients = b.materials.filter((m) => m.kind === "component");
  return (
    <>
      <Card>
        <CardHeader title="Batch" action={w.canProduce && <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setCorrecting(true)}><Palette className="size-4" aria-hidden /> Correction</Button><Button size="sm" onClick={() => setDispensing(true)}><Scale className="size-4" aria-hidden /> Dispense</Button></div>} />
        <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Formula" value={w.formulaId && b.formula ? <Link className="text-primary hover:underline" href={`${PROC}/formulas/${w.formulaId}`}>{b.formula.number} v{b.formula.version}</Link> : null} />
          <Info label="Batch number" value={b.batchNo} />
          <Info label="Input / theoretical output" value={`${formatQty(b.yield.input)} → ${formatQty(b.yield.theoretical)}`} />
          <Info label="Yield" value={Number(b.yield.output) ? <>{b.yield.actualPct}% <span className="text-muted">({formatQty(b.yield.output)} made, {formatQty(b.yield.loss)} lost)</span></> : "Not yet received"} />
        </dl>
        {b.outOfRange.length > 0 && (
          <div className="border-t border-border px-5 py-3">
            <Alert tone="warning">Out of range: {b.outOfRange.map((r) => `${r.stage} ${r.name} ${r.value}`).join("; ")}</Alert>
          </div>
        )}
      </Card>
      {b.dispensings.length > 0 && (
        <Card>
          <CardHeader title="Dispensing record" />
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Ingredient</th><th className="px-4 py-2 font-medium">Lot / assay</th><th className="px-4 py-2 text-right font-medium">Target</th><th className="px-4 py-2 text-right font-medium">Weighed</th><th className="px-4 py-2 font-medium">Check</th></tr></thead>
            <tbody className="divide-y divide-border">
              {b.dispensings.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2">{d.code}</td>
                  <td className="px-4 py-2">{d.batchNo ?? "—"}{d.assayPct && <span className="text-muted"> · {Number(d.assayPct)}%</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(d.targetQty)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(d.qty)}</td>
                  <td className="px-4 py-2">{d.withinTolerance ? <Badge tone="success">In tolerance</Badge> : <Badge tone="warning" >Override</Badge>}{d.overrideReason && <span className="block text-xs text-muted">{d.overrideReason}</span>}{d.checkedBy && <span className="block text-xs text-muted">Checked: {d.checkedBy}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
      {correcting && (
        <CorrectionDialog
          woId={w.id}
          onClose={() => setCorrecting(false)}
          onDone={(t) => {
            setCorrecting(false);
            onChanged(t);
          }}
        />
      )}
      {dispensing && (
        <DispenseDialog
          woId={w.id}
          ingredients={ingredients}
          onClose={() => setDispensing(false)}
          onDone={(t) => {
            setDispensing(false);
            onChanged(t);
          }}
        />
      )}
    </>
  );
}

function DispenseDialog({ woId, ingredients, onClose, onDone }: { woId: string; ingredients: BatchView["materials"]; onClose: () => void; onDone: (text: string) => void }) {
  type Row = { qty: string; batchNo: string; assayPct: string; overrideReason: string };
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(ingredients.map((m) => [m.id, { qty: "", batchNo: "", assayPct: "", overrideReason: "" }])));
  const [checkedBy, setCheckedBy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, p: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...p } }));
  const chosen = ingredients.filter((m) => Number(rows[m.id]?.qty) > 0);
  async function go() {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await api<{ entry: { number: string } }>(`${PROC}/batches/${woId}/dispense`, {
        body: { lines: chosen.map((m) => ({ materialId: m.id, qty: rows[m.id].qty, batchNo: rows[m.id].batchNo || null, assayPct: rows[m.id].assayPct || null, overrideReason: rows[m.id].overrideReason || null, checkedBy: checkedBy || null })) },
      });
      onDone(`${r.entry.number}: ${chosen.length} ingredient${chosen.length === 1 ? "" : "s"} dispensed.`);
    } catch (e) {
      if (e instanceof ApiError) {
        // Map lines.N.* back to material ids.
        const fe = e.fieldErrors;
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(fe)) {
          const m = /^lines\.(\d+)\./.exec(k);
          if (m) mapped[chosen[Number(m[1])]?.id ?? k] = v;
        }
        setErrors(mapped);
        setError(e.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} size="xl" title="Dispense" description="Weigh each ingredient against its target. Potency-dosed ingredients need the lot's assay; the target is adjusted for it." footer={<><Input className="mr-auto h-9 w-56" aria-label="Checked by" placeholder="Checked by" value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)} /><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy} disabled={!chosen.length}>Record weighings</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted"><tr><th className="py-1 font-medium">Ingredient</th><th className="py-1 text-right font-medium">Required</th><th className="py-1 font-medium">Weighed</th><th className="py-1 font-medium">Lot</th><th className="py-1 font-medium">Assay %</th><th className="py-1 font-medium">If outside tolerance</th></tr></thead>
        <tbody>
          {ingredients.map((m) => (
            <tr key={m.id} className="align-top">
              <td className="py-1 pr-2">{m.code} <span className="block text-xs text-muted">{m.basis ? BASIS_LABEL[m.basis] : ""}{m.tolerancePct ? ` · ±${Number(m.tolerancePct)}%` : ""}</span>{errors[m.id] && <span className="block text-xs text-danger">{errors[m.id]}</span>}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatQty(m.requiredQty)} {m.uom}<span className="block text-xs text-muted">{formatQty(m.issuedQty)} issued</span></td>
              <td className="py-1 pr-2"><Input className="h-9 w-24" inputMode="decimal" aria-label={`Weighed ${m.code}`} value={rows[m.id].qty} onChange={(e) => set(m.id, { qty: e.target.value })} /></td>
              <td className="py-1 pr-2"><Input className="h-9 w-24" aria-label={`Lot of ${m.code}`} value={rows[m.id].batchNo} onChange={(e) => set(m.id, { batchNo: e.target.value })} /></td>
              <td className="py-1 pr-2">{m.basis === "potency" ? <Input className="h-9 w-20" inputMode="decimal" aria-label={`Assay of ${m.code}`} value={rows[m.id].assayPct} onChange={(e) => set(m.id, { assayPct: e.target.value })} /> : <span className="text-muted">—</span>}</td>
              <td className="py-1"><Input className="h-9 w-48" aria-label={`Reason for ${m.code}`} placeholder="Reason" value={rows[m.id].overrideReason} onChange={(e) => set(m.id, { overrideReason: e.target.value })} /></td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </Dialog>
  );
}

function CorrectionDialog({ woId, onClose, onDone }: { woId: string; onClose: () => void; onDone: (text: string) => void }) {
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ qty: "", batchNo: "", reason: "", checkedBy: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!item) return setError("Choose what is being added");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ entry: { number: string } }>(`${PROC}/batches/${woId}/correction`, { body: { itemId: item.id, qty: f.qty, batchNo: f.batchNo || null, reason: f.reason, checkedBy: f.checkedBy || null } });
      onDone(`${r.entry.number}: correction of ${f.qty} ${item.label} added.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Correction" description="An addition the formula does not have, such as a shade, viscosity or pH correction. It is issued to the batch and kept in the dispensing record." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy}>Add to batch</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item" className="sm:col-span-2">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} stockOnly />)}</Field>
        <Field label="Quantity">{(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
        <Field label="Lot">{(p) => <Input {...p} value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />}</Field>
        <Field label="Why" className="sm:col-span-2">{(p) => <Input {...p} placeholder="Shade too light against standard" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        <Field label="Checked by">{(p) => <Input {...p} value={f.checkedBy} onChange={(e) => setF({ ...f, checkedBy: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
