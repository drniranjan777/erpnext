"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { MFG, type WorkCenter } from "@/lib/manufacturing";
import { BASIS_LABEL, PROC, type Basis, type Formula, type StageParameter } from "@/lib/process";

interface Line { key: string; kind: "ingredient" | "coproduct" | "byproduct"; itemId: string; label: string; uom: string; basis: Basis; qty: string; stdPotency: string; tolerancePct: string; costSharePct: string; recoveryRate: string; stageSeq: string }
interface Stage { key: string; seq: string; name: string; workCenterId: string; minutes: string; parameters: StageParameter[]; instructions: string }

let n = 0;
const k = () => `f${++n}`;
const F = `${PROC}/formulas`;
const num = (v: string | null) => (v === null || v === undefined ? "" : String(Number(v)));

export function FormulaForm({ existing }: { existing?: Formula }) {
  const router = useRouter();
  const qc = useQueryClient();
  const wcs = useQuery({ queryKey: [MFG, "wc"], queryFn: () => api<WorkCenter[]>(`${MFG}/work-centers`) });
  const [product, setProduct] = useState<{ id: string; label: string } | null>(existing ? { id: existing.item.id, label: `${existing.item.code} ${existing.item.name}` } : null);
  const [h, setH] = useState({ kind: existing?.kind ?? "bulk", batchSize: existing ? num(existing.batchSize) : "", batchMultiple: num(existing?.batchMultiple ?? null), yieldPct: existing ? num(existing.yieldPct) : "100", isDefault: existing?.isDefault ?? true, declaration: existing?.declaration ?? "", notes: existing?.notes ?? "" });
  const [lines, setLines] = useState<Line[]>(existing?.lines.map((l) => ({ key: k(), kind: l.kind, itemId: l.itemId, label: `${l.code} ${l.name}`, uom: l.uom, basis: l.basis, qty: num(l.qty), stdPotency: num(l.stdPotency), tolerancePct: num(l.tolerancePct), costSharePct: num(l.costSharePct), recoveryRate: num(l.recoveryRate), stageSeq: l.stageSeq ? String(l.stageSeq) : "" })) ?? []);
  const [stages, setStages] = useState<Stage[]>(existing?.stages.map((s) => ({ key: k(), seq: String(s.seq), name: s.name, workCenterId: s.workCenterId, minutes: num(s.minutes), parameters: s.parameters, instructions: s.instructions ?? "" })) ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const updL = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const updS = (key: string, p: Partial<Stage>) => setStages((ss) => ss.map((s) => (s.key === key ? { ...s, ...p } : s)));
  const addLine = (it: PickedItem) => setLines((ls) => [...ls, { key: k(), kind: "ingredient", itemId: it.id, label: `${it.code} ${it.name}`, uom: it.baseUom, basis: "percent", qty: "", stdPotency: "", tolerancePct: "1", costSharePct: "", recoveryRate: "", stageSeq: "" }]);
  const pctTotal = lines.filter((l) => l.kind === "ingredient" && l.basis === "percent").reduce((s, l) => s + (Number(l.qty) || 0), 0);

  async function save() {
    if (!product) return setErrors({ itemId: "Choose the product" });
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      itemId: product.id,
      kind: h.kind,
      batchSize: h.batchSize,
      batchMultiple: h.batchMultiple || null,
      yieldPct: h.yieldPct || null,
      isDefault: h.isDefault,
      declaration: h.declaration || null,
      notes: h.notes || null,
      lines: lines.map((l) => ({ kind: l.kind, itemId: l.itemId, basis: l.basis, qty: l.qty, stdPotency: l.basis === "potency" ? l.stdPotency || "100" : null, tolerancePct: l.tolerancePct || null, costSharePct: l.kind === "coproduct" ? l.costSharePct || null : null, recoveryRate: l.kind === "byproduct" ? l.recoveryRate || null : null, stageSeq: l.stageSeq ? Number(l.stageSeq) : null })),
      stages: stages.map((s) => ({ seq: Number(s.seq), name: s.name, workCenterId: s.workCenterId, minutes: s.minutes || null, parameters: s.parameters.filter((p) => p.name.trim()).map((p) => ({ ...p, unit: p.unit || null, min: p.min || null, max: p.max || null })), instructions: s.instructions || null })),
    };
    try {
      const f = existing ? await api<Formula>(`${F}/${existing.id}`, { method: "PUT", body: { ...body, version: existing.version } }) : await api<Formula>(F, { body });
      qc.invalidateQueries({ queryKey: [F] });
      router.push(`${F}/${f.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Product" required error={errors.itemId} className="sm:col-span-2">
            {() => (product ? <div className="flex items-center gap-2 text-sm">{product.label}{!existing && <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>Change</Button>}</div> : <ItemPicker onPick={(it) => setProduct({ id: it.id, label: `${it.code} ${it.name}` })} />)}
          </Field>
          <Field label="Kind">{(p) => <Select {...p} value={h.kind} onChange={(e) => setH({ ...h, kind: e.target.value as "bulk" })}><option value="bulk">Bulk (makes the product)</option><option value="packing">Packing (bulk into packs)</option></Select>}</Field>
          <div className="flex items-end pb-2"><Checkbox label="Default version" checked={h.isDefault} onChange={(e) => setH({ ...h, isDefault: e.target.checked })} /></div>
          <Field label="Standard batch" required error={errors.batchSize} hint="In the product's base unit">{(p) => <Input {...p} inputMode="decimal" value={h.batchSize} onChange={(e) => setH({ ...h, batchSize: e.target.value })} />}</Field>
          <Field label="Batch multiple" hint="Blank = any size" error={errors.batchMultiple}>{(p) => <Input {...p} inputMode="decimal" value={h.batchMultiple} onChange={(e) => setH({ ...h, batchMultiple: e.target.value })} />}</Field>
          <Field label="Theoretical yield %" error={errors.yieldPct}>{(p) => <Input {...p} inputMode="decimal" value={h.yieldPct} onChange={(e) => setH({ ...h, yieldPct: e.target.value })} />}</Field>
          <div />
          <Field label="Ingredient declaration" hint="INCI / label declaration, nutrition, SDS reference" className="sm:col-span-4">{(p) => <Input {...p} value={h.declaration} onChange={(e) => setH({ ...h, declaration: e.target.value })} />}</Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Ingredients and outputs" description={pctTotal ? `Percent ingredients add up to ${pctTotal.toFixed(2)}%` : "Percent lines are of the batch size; potency lines are pure active per standard batch."} action={<div className="w-72"><ItemPicker onPick={addLine} placeholder="Add an item…" /></div>} />
        {errors.lines && <p className="px-5 pb-2 text-sm text-danger">{errors.lines}</p>}
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Kind</th><th className="px-3 py-2 font-medium">Basis</th><th className="px-3 py-2 font-medium">Qty / %</th><th className="px-3 py-2 font-medium">Std potency</th><th className="px-3 py-2 font-medium">Tolerance ±%</th><th className="px-3 py-2 font-medium">Cost share / recovery</th><th className="px-3 py-2 font-medium">Stage</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l, i) => (
                <tr key={l.key}>
                  <td className="px-3 py-1.5">{l.label} <span className="text-xs text-muted">{l.uom}</span>{errors[`lines.${i}.itemId`] && <span className="block text-xs text-danger">{errors[`lines.${i}.itemId`]}</span>}</td>
                  <td className="px-3 py-1.5"><Select className="h-9 w-32" aria-label="Kind" value={l.kind} onChange={(e) => updL(l.key, { kind: e.target.value as Line["kind"] })}><option value="ingredient">Ingredient</option><option value="coproduct">Co-product</option><option value="byproduct">By-product</option></Select></td>
                  <td className="px-3 py-1.5"><Select className="h-9 w-32" aria-label="Basis" value={l.basis} onChange={(e) => updL(l.key, { basis: e.target.value as Basis })}>{(Object.keys(BASIS_LABEL) as Basis[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}</Select></td>
                  <td className="px-3 py-1.5"><Input className="h-9 w-24" aria-label="Quantity" inputMode="decimal" value={l.qty} onChange={(e) => updL(l.key, { qty: e.target.value })} />{errors[`lines.${i}.qty`] && <span className="block text-xs text-danger">{errors[`lines.${i}.qty`]}</span>}</td>
                  <td className="px-3 py-1.5">{l.basis === "potency" ? <Input className="h-9 w-20" aria-label="Standard potency" inputMode="decimal" placeholder="100" value={l.stdPotency} onChange={(e) => updL(l.key, { stdPotency: e.target.value })} /> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-1.5">{l.kind === "ingredient" ? <Input className="h-9 w-20" aria-label="Tolerance" inputMode="decimal" value={l.tolerancePct} onChange={(e) => updL(l.key, { tolerancePct: e.target.value })} /> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-1.5">
                    {l.kind === "coproduct" ? <Input className="h-9 w-20" aria-label="Cost share %" placeholder="%" inputMode="decimal" value={l.costSharePct} onChange={(e) => updL(l.key, { costSharePct: e.target.value })} /> : l.kind === "byproduct" ? <Input className="h-9 w-20" aria-label="Recovery rate" placeholder="₹/unit" inputMode="decimal" value={l.recoveryRate} onChange={(e) => updL(l.key, { recoveryRate: e.target.value })} /> : <span className="text-muted">—</span>}
                    {errors[`lines.${i}.costSharePct`] && <span className="block text-xs text-danger">{errors[`lines.${i}.costSharePct`]}</span>}
                  </td>
                  <td className="px-3 py-1.5"><Input className="h-9 w-16" aria-label="Stage" inputMode="numeric" value={l.stageSeq} onChange={(e) => updL(l.key, { stageSeq: e.target.value })} /></td>
                  <td className="px-3 py-1.5"><Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4" aria-hidden /></Button></td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted">Add the ingredients.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Process stages" description="Minutes are per standard batch and scale with the batch. Parameters are recorded on each job card." action={<Button size="sm" variant="secondary" onClick={() => setStages((ss) => [...ss, { key: k(), seq: String((ss.length + 1) * 10), name: "", workCenterId: wcs.data?.[0]?.id ?? "", minutes: "", parameters: [], instructions: "" }])}><Plus className="size-4" aria-hidden /> Add stage</Button>} />
        <div className="space-y-3 border-t border-border p-4">
          {stages.map((s, i) => (
            <div key={s.key} className="space-y-2 rounded-lg border border-border p-3">
              <div className="grid items-end gap-2 sm:grid-cols-[5rem_1fr_12rem_7rem_auto]">
                <Field label="Stage">{(p) => <Input {...p} inputMode="numeric" value={s.seq} onChange={(e) => updS(s.key, { seq: e.target.value })} />}</Field>
                <Field label="Name" error={errors[`stages.${i}.name`]}>{(p) => <Input {...p} value={s.name} onChange={(e) => updS(s.key, { name: e.target.value })} />}</Field>
                <Field label="Work centre" error={errors[`stages.${i}.workCenterId`]}>{(p) => <Select {...p} value={s.workCenterId} onChange={(e) => updS(s.key, { workCenterId: e.target.value })}>{wcs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</Select>}</Field>
                <Field label="Minutes">{(p) => <Input {...p} inputMode="decimal" value={s.minutes} onChange={(e) => updS(s.key, { minutes: e.target.value })} />}</Field>
                <Button size="sm" variant="ghost" aria-label="Remove stage" onClick={() => setStages((ss) => ss.filter((x) => x.key !== s.key))}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
              {s.parameters.map((p, j) => (
                <div key={j} className="grid items-center gap-2 pl-4 sm:grid-cols-[1fr_6rem_6rem_6rem_auto]">
                  <Input aria-label="Parameter" placeholder="Parameter (e.g. Viscosity)" value={p.name} onChange={(e) => updS(s.key, { parameters: s.parameters.map((x, m) => (m === j ? { ...x, name: e.target.value } : x)) })} />
                  <Input aria-label="Unit" placeholder="Unit" value={p.unit ?? ""} onChange={(e) => updS(s.key, { parameters: s.parameters.map((x, m) => (m === j ? { ...x, unit: e.target.value } : x)) })} />
                  <Input aria-label="Minimum" placeholder="Min" inputMode="decimal" value={p.min ?? ""} onChange={(e) => updS(s.key, { parameters: s.parameters.map((x, m) => (m === j ? { ...x, min: e.target.value } : x)) })} />
                  <Input aria-label="Maximum" placeholder="Max" inputMode="decimal" value={p.max ?? ""} onChange={(e) => updS(s.key, { parameters: s.parameters.map((x, m) => (m === j ? { ...x, max: e.target.value } : x)) })} />
                  <Button size="sm" variant="ghost" aria-label="Remove parameter" onClick={() => updS(s.key, { parameters: s.parameters.filter((_, m) => m !== j) })}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => updS(s.key, { parameters: [...s.parameters, { name: "", unit: null, min: null, max: null }] })}><Plus className="size-4" aria-hidden /> In-process check</Button>
            </div>
          ))}
          {!stages.length && <p className="text-sm text-muted">No stages: the batch is made in one step.</p>}
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy}>{existing ? "Save" : "Create draft"}</Button>
      </div>
    </div>
  );
}
