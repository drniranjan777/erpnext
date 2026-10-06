"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker, type PickedItem } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { MFG, type Bom, type Tool, type WorkCenter } from "@/lib/manufacturing";

interface Line { key: string; kind: "component" | "byproduct" | "scrap"; itemId: string; label: string; uom: string; qty: string; scrapPct: string; isPhantom: boolean; alternateGroup: string; priority: string; operationSeq: string; recoveryRate: string }
interface Op { key: string; seq: string; name: string; workCenterId: string; toolId: string; setupMinutes: string; runMinutes: string; isSubcontract: boolean; vendor: PickedParty | null; subcontractRate: string; inspection: boolean }

let n = 0;
const k = () => `b${++n}`;
const B = `${MFG}/boms`;

export function BomForm({ existing }: { existing?: Bom }) {
  const router = useRouter();
  const qc = useQueryClient();
  const wcs = useQuery({ queryKey: [MFG, "wc"], queryFn: () => api<WorkCenter[]>(`${MFG}/work-centers`) });
  const tools = useQuery({ queryKey: [MFG, "tools"], queryFn: () => api<Tool[]>(`${MFG}/tools`) });
  const [parent, setParent] = useState<{ id: string; label: string } | null>(existing ? { id: existing.item.id, label: `${existing.item.code} ${existing.item.name}` } : null);
  const [h, setH] = useState({ quantity: existing ? String(Number(existing.quantity)) : "1", isDefault: existing?.isDefault ?? true, effectiveFrom: existing?.effectiveFrom ?? "", drawingNo: existing?.drawingNo ?? "", drawingRevision: existing?.drawingRevision ?? "", notes: existing?.notes ?? "" });
  const [lines, setLines] = useState<Line[]>(
    existing?.lines.map((l) => ({ key: k(), kind: l.kind, itemId: l.itemId, label: `${l.code} ${l.name}`, uom: l.uom, qty: String(Number(l.qty)), scrapPct: Number(l.scrapPct) ? String(Number(l.scrapPct)) : "", isPhantom: l.isPhantom, alternateGroup: l.alternateGroup ?? "", priority: String(l.priority), operationSeq: l.operationSeq ? String(l.operationSeq) : "", recoveryRate: l.recoveryRate ? String(Number(l.recoveryRate)) : "" })) ?? [],
  );
  const [ops, setOps] = useState<Op[]>(
    existing?.operations.map((o) => ({ key: k(), seq: String(o.seq), name: o.name, workCenterId: o.workCenterId, toolId: o.toolId ?? "", setupMinutes: String(Number(o.setupMinutes)), runMinutes: String(Number(o.runMinutes)), isSubcontract: o.isSubcontract, vendor: o.vendorId ? { id: o.vendorId, code: "", name: o.vendor ?? "", gstin: null, stateCode: null, creditDays: null } : null, subcontractRate: o.subcontractRate ? String(Number(o.subcontractRate)) : "", inspection: o.inspection })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const updL = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const updO = (key: string, p: Partial<Op>) => setOps((os) => os.map((o) => (o.key === key ? { ...o, ...p } : o)));
  const addLine = (it: PickedItem, kind: Line["kind"] = "component") => setLines((ls) => [...ls, { key: k(), kind, itemId: it.id, label: `${it.code} ${it.name}`, uom: it.baseUom, qty: "1", scrapPct: "", isPhantom: false, alternateGroup: "", priority: "1", operationSeq: "", recoveryRate: "" }]);

  async function save(andSubmit: boolean) {
    if (!parent) return setErrors({ itemId: "Choose the item this BOM makes" });
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      itemId: parent.id,
      quantity: h.quantity,
      isDefault: h.isDefault,
      effectiveFrom: h.effectiveFrom || null,
      drawingNo: h.drawingNo || null,
      drawingRevision: h.drawingRevision || null,
      notes: h.notes || null,
      lines: lines.map((l) => ({ kind: l.kind, itemId: l.itemId, qty: l.qty, scrapPct: l.scrapPct || null, isPhantom: l.isPhantom, alternateGroup: l.alternateGroup || null, priority: Number(l.priority) || 1, operationSeq: l.operationSeq ? Number(l.operationSeq) : null, recoveryRate: l.recoveryRate || null })),
      operations: ops.map((o) => ({ seq: Number(o.seq), name: o.name, workCenterId: o.workCenterId, toolId: o.toolId || null, setupMinutes: o.setupMinutes || null, runMinutes: o.runMinutes || null, isSubcontract: o.isSubcontract, vendorId: o.isSubcontract ? (o.vendor?.id ?? null) : null, subcontractRate: o.isSubcontract ? o.subcontractRate || null : null, inspection: o.inspection })),
    };
    try {
      const b = existing ? await api<Bom>(`${B}/${existing.id}`, { method: "PUT", body: { ...body, version: existing.version } }) : await api<Bom>(B, { body });
      if (andSubmit) await api(`${B}/${b.id}/submit`, { body: { version: b.version } });
      qc.invalidateQueries({ queryKey: [B] });
      router.push(`${B}/${b.id}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Item made" required error={errors.itemId} className="sm:col-span-2">
            {() => (parent ? <div className="flex items-center gap-2 pt-2 text-sm">{parent.label}{!existing && <Button size="sm" variant="ghost" onClick={() => setParent(null)}>Change</Button>}</div> : <ItemPicker onPick={(it) => setParent({ id: it.id, label: `${it.code} ${it.name}` })} placeholder="Search the finished / semi-finished item" />)}
          </Field>
          <Field label="Quantity the lines are for" hint="e.g. 100 for a per-100 BOM" error={errors.quantity}>{(p) => <Input {...p} inputMode="decimal" value={h.quantity} onChange={(e) => setH({ ...h, quantity: e.target.value })} />}</Field>
          <Field label="Effective from" hint="Blank = on approval">{(p) => <Input {...p} type="date" value={h.effectiveFrom} onChange={(e) => setH({ ...h, effectiveFrom: e.target.value })} />}</Field>
          <Field label="Drawing no.">{(p) => <Input {...p} value={h.drawingNo} onChange={(e) => setH({ ...h, drawingNo: e.target.value })} />}</Field>
          <Field label="Revision">{(p) => <Input {...p} value={h.drawingRevision} onChange={(e) => setH({ ...h, drawingRevision: e.target.value })} />}</Field>
          <div className="flex items-end pb-2"><Checkbox label="Default BOM for the item" checked={h.isDefault} onChange={(e) => setH({ ...h, isDefault: e.target.checked })} /></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Materials" description="Quantities in each component's base unit, for the BOM quantity above. Same alternate group = alternates (lowest priority used first)." />
        <div className="px-5 pb-3"><ItemPicker onPick={(it) => addLine(it)} placeholder="Add a component" /></div>
        {errors.lines && <p className="px-5 text-sm text-danger">{errors.lines}</p>}
        {lines.length > 0 && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2 font-medium">Item</th><th className="w-28 px-2 py-2 font-medium">Kind</th><th className="w-24 px-2 py-2 text-right font-medium">Qty</th><th className="w-20 px-2 py-2 text-right font-medium">Scrap %</th><th className="w-24 px-2 py-2 font-medium">Alt group</th><th className="w-16 px-2 py-2 font-medium">Prio</th><th className="w-20 px-2 py-2 font-medium">At op</th><th className="w-24 px-2 py-2 font-medium">Recovery ₹</th><th className="w-20 px-2 py-2 font-medium">Phantom</th><th className="w-10" /></tr></thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, i) => {
                  const err = (f: string) => errors[`lines.${i}.${f}`];
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="px-3 py-2">{l.label}<span className="block text-xs text-muted">{l.uom}</span>{(err("itemId") || err("isPhantom") || err("operationSeq")) && <p className="text-xs text-danger">{err("itemId") ?? err("isPhantom") ?? err("operationSeq")}</p>}</td>
                      <td className="px-2 py-2"><Select className="h-9" aria-label={`Line ${i + 1} kind`} value={l.kind} onChange={(e) => updL(l.key, { kind: e.target.value as Line["kind"] })}><option value="component">Component</option><option value="byproduct">By-product</option><option value="scrap">Scrap</option></Select></td>
                      <td className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Line ${i + 1} qty`} value={l.qty} onChange={(e) => updL(l.key, { qty: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Line ${i + 1} scrap`} value={l.scrapPct} onChange={(e) => updL(l.key, { scrapPct: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input className="h-9" aria-label={`Line ${i + 1} alternate group`} value={l.alternateGroup} onChange={(e) => updL(l.key, { alternateGroup: e.target.value.toUpperCase() })} /></td>
                      <td className="px-2 py-2"><Input className="h-9" inputMode="numeric" aria-label={`Line ${i + 1} priority`} value={l.priority} onChange={(e) => updL(l.key, { priority: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input className="h-9" inputMode="numeric" aria-label={`Line ${i + 1} operation`} value={l.operationSeq} onChange={(e) => updL(l.key, { operationSeq: e.target.value })} /></td>
                      <td className="px-2 py-2">{l.kind !== "component" && <Input className="h-9 text-right" inputMode="decimal" aria-label={`Line ${i + 1} recovery`} value={l.recoveryRate} onChange={(e) => updL(l.key, { recoveryRate: e.target.value })} />}</td>
                      <td className="px-2 py-2.5">{l.kind === "component" && <input type="checkbox" aria-label={`Line ${i + 1} phantom`} checked={l.isPhantom} onChange={(e) => updL(l.key, { isPhantom: e.target.checked })} />}</td>
                      <td className="px-2 py-2"><Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4 text-danger" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Routing" description="Operations in order. Setup is per batch; run time per unit made." action={<Button size="sm" variant="secondary" disabled={!wcs.data?.length} onClick={() => setOps((os) => [...os, { key: k(), seq: String((os.length + 1) * 10), name: "", workCenterId: wcs.data?.[0]?.id ?? "", toolId: "", setupMinutes: "", runMinutes: "", isSubcontract: false, vendor: null, subcontractRate: "", inspection: false }])}><Plus className="size-4" aria-hidden /> Operation</Button>} />
        {!wcs.data?.length && <p className="px-5 pb-4 text-sm text-muted">Add work centres first (Manufacturing → Work centres).</p>}
        {ops.length > 0 && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="w-16 px-3 py-2 font-medium">Seq</th><th className="px-2 py-2 font-medium">Operation</th><th className="w-40 px-2 py-2 font-medium">Work centre</th><th className="w-32 px-2 py-2 font-medium">Tool</th><th className="w-24 px-2 py-2 text-right font-medium">Setup min</th><th className="w-24 px-2 py-2 text-right font-medium">Run min / unit</th><th className="w-56 px-2 py-2 font-medium">Outside</th><th className="w-12 px-2 py-2 font-medium">QC</th><th className="w-10" /></tr></thead>
              <tbody className="divide-y divide-border align-top">
                {ops.map((o, i) => {
                  const err = (f: string) => errors[`operations.${i}.${f}`];
                  return (
                    <tr key={o.key}>
                      <td className="px-3 py-2"><Input className="h-9" inputMode="numeric" aria-label={`Operation ${i + 1} sequence`} value={o.seq} onChange={(e) => updO(o.key, { seq: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input className="h-9" aria-label={`Operation ${i + 1} name`} value={o.name} onChange={(e) => updO(o.key, { name: e.target.value })} /></td>
                      <td className="px-2 py-2"><Select className="h-9" aria-label={`Operation ${i + 1} work centre`} value={o.workCenterId} onChange={(e) => updO(o.key, { workCenterId: e.target.value })}>{(wcs.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</Select></td>
                      <td className="px-2 py-2"><Select className="h-9" aria-label={`Operation ${i + 1} tool`} value={o.toolId} onChange={(e) => updO(o.key, { toolId: e.target.value })}><option value="">—</option>{(tools.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</Select></td>
                      <td className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Operation ${i + 1} setup`} value={o.setupMinutes} onChange={(e) => updO(o.key, { setupMinutes: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input className="h-9 text-right" inputMode="decimal" aria-label={`Operation ${i + 1} run`} value={o.runMinutes} onChange={(e) => updO(o.key, { runMinutes: e.target.value })} /></td>
                      <td className="px-2 py-2">
                        <Checkbox label="Job work" checked={o.isSubcontract} onChange={(e) => updO(o.key, { isSubcontract: e.target.checked })} />
                        {o.isSubcontract && <div className="mt-1 space-y-1"><PartyPicker role="vendor" value={o.vendor} onChange={(p) => updO(o.key, { vendor: p })} /><Input className="h-8" inputMode="decimal" placeholder="₹ per unit" aria-label={`Operation ${i + 1} job-work rate`} value={o.subcontractRate} onChange={(e) => updO(o.key, { subcontractRate: e.target.value })} /></div>}
                        {(err("vendorId") || err("subcontractRate")) && <p className="text-xs text-danger">{err("vendorId") ?? err("subcontractRate")}</p>}
                      </td>
                      <td className="px-2 py-2.5"><input type="checkbox" aria-label={`Operation ${i + 1} inspection`} checked={o.inspection} onChange={(e) => updO(o.key, { inspection: e.target.checked })} /></td>
                      <td className="px-2 py-2"><Button variant="ghost" size="sm" aria-label={`Remove operation ${i + 1}`} onClick={() => setOps((os) => os.filter((x) => x.key !== o.key))}><Trash2 className="size-4 text-danger" /></Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button variant="secondary" loading={busy} disabled={!lines.length} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} disabled={!lines.length} onClick={() => save(true)}>Save & approve</Button>
      </div>
    </div>
  );
}
