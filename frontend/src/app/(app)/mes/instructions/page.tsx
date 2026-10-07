"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Characteristic, Instruction, InstructionStep } from "@/lib/mes";

interface Row { id: string; itemId: string; itemCode: string; itemName: string; operationSeq: number; version: number; status: string; title: string; steps: number; characteristics: number; firstOffRequired: boolean; scanMaterials: boolean; releasedAt: string | null; releasedBy: string | null }
type Draft = Omit<Instruction, "id" | "version" | "status"> & { id: string | null; itemLabel: string };

const STATUS_TONE: Record<string, "neutral" | "success" | "warning"> = { draft: "warning", released: "success", retired: "neutral" };
const blank = (): Draft => ({ id: null, itemId: "", itemLabel: "", operationSeq: 10, title: "", steps: [{ title: "", body: "", confirm: true }], characteristics: [], firstOffRequired: false, scanMaterials: false });

/** Electronic work instructions per item and operation: steps (with pictures and confirmations) and the characteristics to measure. */
export default function InstructionsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("mes.instructions.manage");
  const list = useQuery({ queryKey: ["/mes/instructions"], queryFn: () => api<Row[]>("/mes/instructions") });
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(r: Row) {
    const i = await api<Instruction>(`/mes/instructions/${r.id}`);
    setEdit({ id: i.id, itemId: i.itemId, itemLabel: `${r.itemCode} · ${r.itemName}`, operationSeq: i.operationSeq, title: i.title, steps: i.steps, characteristics: i.characteristics, firstOffRequired: i.firstOffRequired, scanMaterials: i.scanMaterials });
  }
  async function run(fn: () => Promise<unknown>, close = false) {
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/mes/instructions"] });
      if (close) setEdit(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const save = () =>
    edit &&
    run(() => {
      const { id, itemLabel: _l, ...body } = edit;
      const clean = { ...body, characteristics: body.characteristics.map((c) => ({ ...c, min: c.min ?? null, max: c.max ?? null, everyMinutes: c.everyMinutes || null })) };
      return id ? api(`/mes/instructions/${id}`, { method: "PUT", body: clean }) : api("/mes/instructions", { body: clean });
    }, true);
  const setStep = (i: number, p: Partial<InstructionStep>) => edit && setEdit({ ...edit, steps: edit.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const setChar = (i: number, p: Partial<Characteristic>) => edit && setEdit({ ...edit, characteristics: edit.characteristics.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Work instructions" description="Shown at the machine terminal for each item's operation. Editing a released version starts a new draft; releasing it replaces the old one. Steps marked 'confirm' must be ticked before the job can start." actions={manage && <Button onClick={() => setEdit(blank())}><Plus className="size-4" aria-hidden /> New instructions</Button>} />
      {error && !edit && <Alert>{error}</Alert>}
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item · operation</th><th className="px-4 py-2 font-medium">Title</th><th className="px-4 py-2 font-medium">Version</th><th className="px-4 py-2 font-medium">Content</th><th className="px-4 py-2" /></tr></thead>
          <tbody className="divide-y divide-border">
            {list.data?.map((r) => (
              <tr key={r.id} className={r.status === "retired" ? "opacity-60" : ""}>
                <td className="px-4 py-2">{r.itemCode} · {r.itemName}<span className="block text-xs text-muted">operation {r.operationSeq}</span></td>
                <td className="px-4 py-2">{r.title}</td>
                <td className="px-4 py-2"><Badge tone={STATUS_TONE[r.status]}>v{r.version} {r.status}</Badge>{r.releasedAt && <span className="block text-xs text-muted">{r.releasedBy} · {timeAgo(r.releasedAt)}</span>}</td>
                <td className="px-4 py-2 text-xs">{r.steps} steps · {r.characteristics} checks{r.firstOffRequired ? " · first-off" : ""}{r.scanMaterials ? " · scan materials" : ""}</td>
                <td className="px-4 py-2 text-right">
                  <span className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => open(r)}>{manage && r.status !== "retired" ? "Edit" : "View"}</Button>
                    {manage && r.status === "draft" && <Button size="sm" onClick={() => run(() => api(`/mes/instructions/${r.id}/release`, { body: {} }))}>Release</Button>}
                  </span>
                </td>
              </tr>
            ))}
            {list.data && !list.data.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No work instructions yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Dialog open={!!edit} onClose={() => setEdit(null)} size="xl" title={edit?.id ? "Edit work instructions" : "New work instructions"} footer={manage && <Button disabled={!edit?.itemId || (edit?.title.length ?? 0) < 2 || !edit?.steps.every((s) => s.title.trim())} onClick={save}>Save draft</Button>}>
        {edit && (
          <div className="space-y-4 text-sm">
            {error && <Alert>{error}</Alert>}
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_3fr]">
              <div>{edit.itemLabel ? <p className="flex h-10 items-center gap-2">{edit.itemLabel} {!edit.id && <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, itemId: "", itemLabel: "" })}>Change</Button>}</p> : <ItemPicker placeholder="Item made" onPick={(i) => setEdit({ ...edit, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}</div>
              <Input type="number" aria-label="Operation number" min={1} value={edit.operationSeq} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, operationSeq: Number(e.target.value) })} />
              <Input aria-label="Title" placeholder="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.firstOffRequired} onChange={(e) => setEdit({ ...edit, firstOffRequired: e.target.checked })} /> First-off approval needed</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.scanMaterials} onChange={(e) => setEdit({ ...edit, scanMaterials: e.target.checked })} /> Materials must be scanned</label>
            </div>
            <fieldset className="space-y-2">
              <legend className="font-medium">Steps</legend>
              {edit.steps.map((s, i) => (
                <div key={i} className="space-y-1 rounded-lg border border-border p-2">
                  <div className="flex gap-2">
                    <span className="pt-2 font-medium">{i + 1}.</span>
                    <Input className="flex-1" aria-label="Step title" placeholder="What to do" value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} />
                    <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })}>Remove</Button>
                  </div>
                  <textarea aria-label="Details" rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="Details" value={s.body} onChange={(e) => setStep(i, { body: e.target.value })} />
                  <div className="flex flex-wrap items-center gap-3">
                    <Input className="h-8 flex-1" aria-label="Picture link" placeholder="Picture or drawing link (optional)" value={s.imageUrl ?? ""} onChange={(e) => setStep(i, { imageUrl: e.target.value || null })} />
                    <label className="flex items-center gap-1"><input type="checkbox" checked={!!s.confirm} onChange={(e) => setStep(i, { confirm: e.target.checked })} /> Confirm</label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={!!s.caution} onChange={(e) => setStep(i, { caution: e.target.checked })} /> Caution</label>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { title: "", body: "", confirm: false }] })}>Add step</Button>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-medium">Characteristics to measure</legend>
              <p className="text-xs text-muted">Measured on the first-off piece and, with a frequency, as in-line checks while the job runs.</p>
              {edit.characteristics.map((c, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <Input className="w-48" aria-label="Name" placeholder="Name" value={c.name} onChange={(e) => setChar(i, { name: e.target.value })} />
                  <Input className="w-20" aria-label="Unit" placeholder="Unit" value={c.unit ?? ""} onChange={(e) => setChar(i, { unit: e.target.value || null })} />
                  <Input className="w-24" type="number" step="any" aria-label="Minimum" placeholder="Min" value={c.min ?? ""} onChange={(e) => setChar(i, { min: numOrNull(e.target.value) })} />
                  <Input className="w-24" type="number" step="any" aria-label="Maximum" placeholder="Max" value={c.max ?? ""} onChange={(e) => setChar(i, { max: numOrNull(e.target.value) })} />
                  <Input className="w-32" type="number" min={1} aria-label="Every minutes" placeholder="Every … min" value={c.everyMinutes ?? ""} onChange={(e) => setChar(i, { everyMinutes: numOrNull(e.target.value) })} />
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, characteristics: edit.characteristics.filter((_, j) => j !== i) })}>Remove</Button>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => setEdit({ ...edit, characteristics: [...edit.characteristics, { name: "", unit: null, min: null, max: null, everyMinutes: null }] })}>Add characteristic</Button>
            </fieldset>
          </div>
        )}
      </Dialog>
    </div>
  );
}
