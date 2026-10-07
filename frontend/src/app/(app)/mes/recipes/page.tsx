"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { RecipeParameter } from "@/lib/mes";

interface Row { id: string; itemId: string; itemCode: string; itemName: string; machineId: string | null; machineCode: string | null; version: number; status: string; parameters: RecipeParameter[]; notes: string | null; releasedAt: string | null; releasedBy: string | null }
interface Machine { id: string; code: string; name: string }
type Param = { name: string; unit: string; value: string; min: string; max: string; signalCode: string; protocol: "" | "modbus-tcp" | "mqtt"; endpoint: string; address: string; dataType: string };
interface Draft { id: string | null; itemId: string; itemLabel: string; machineId: string; notes: string; parameters: Param[] }

const toParam = (p: RecipeParameter): Param => ({ name: p.name, unit: p.unit ?? "", value: String(p.value), min: p.min == null ? "" : String(p.min), max: p.max == null ? "" : String(p.max), signalCode: p.signalCode ?? "", protocol: (p.target?.protocol as Param["protocol"]) ?? "", endpoint: String(p.target?.endpoint ?? ""), address: String(p.target?.address ?? ""), dataType: String(p.target?.dataType ?? "uint16") });
const emptyParam = (): Param => ({ name: "", unit: "", value: "", min: "", max: "", signalCode: "", protocol: "", endpoint: "", address: "", dataType: "uint16" });
const STATUS_TONE: Record<string, "neutral" | "success" | "warning"> = { draft: "warning", released: "success", retired: "neutral" };

/** Recipes: the set-points for making an item on a machine, sent to the PLC through the edge gateway when a job starts. */
export default function RecipesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("mes.instructions.manage");
  const list = useQuery({ queryKey: ["/mes/recipes"], queryFn: () => api<Row[]>("/mes/recipes") });
  const machines = useQuery({ queryKey: ["/manufacturing/machines"], queryFn: () => api<Machine[]>("/manufacturing/machines") });
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, close = false) {
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/mes/recipes"] });
      if (close) setEdit(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const n = (v: string) => (v.trim() === "" ? null : Number(v));
  const save = () =>
    edit &&
    run(() => {
      const body = {
        itemId: edit.itemId,
        machineId: edit.machineId || null,
        notes: edit.notes || null,
        parameters: edit.parameters.map((p) => ({ name: p.name, unit: p.unit || null, value: Number(p.value), min: n(p.min), max: n(p.max), signalCode: p.signalCode || null, target: p.protocol ? { protocol: p.protocol, endpoint: p.endpoint, address: p.address, ...(p.protocol === "modbus-tcp" ? { dataType: p.dataType } : {}) } : null })),
      };
      return edit.id ? api(`/mes/recipes/${edit.id}`, { method: "PUT", body }) : api("/mes/recipes", { body });
    }, true);
  const setP = (i: number, p: Partial<Param>) => edit && setEdit({ ...edit, parameters: edit.parameters.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Recipes" description="Set-points with their limits. Parameters with a PLC address are written by the edge gateway when the job starts; the batch record compares each with the signal that measures it." actions={manage && <Button onClick={() => setEdit({ id: null, itemId: "", itemLabel: "", machineId: "", notes: "", parameters: [emptyParam()] })}><Plus className="size-4" aria-hidden /> New recipe</Button>} />
      {error && !edit && <Alert>{error}</Alert>}
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">Machine</th><th className="px-4 py-2 font-medium">Version</th><th className="px-4 py-2 font-medium">Set-points</th><th className="px-4 py-2" /></tr></thead>
          <tbody className="divide-y divide-border">
            {list.data?.map((r) => (
              <tr key={r.id} className={r.status === "retired" ? "opacity-60" : ""}>
                <td className="px-4 py-2">{r.itemCode} · {r.itemName}</td>
                <td className="px-4 py-2">{r.machineCode ?? "Any"}</td>
                <td className="px-4 py-2"><Badge tone={STATUS_TONE[r.status]}>v{r.version} {r.status}</Badge>{r.releasedAt && <span className="block text-xs text-muted">{r.releasedBy} · {timeAgo(r.releasedAt)}</span>}</td>
                <td className="px-4 py-2 text-xs">{r.parameters.map((p) => `${p.name} ${p.value}${p.unit ? ` ${p.unit}` : ""}`).join(" · ")}</td>
                <td className="px-4 py-2 text-right">
                  <span className="flex justify-end gap-1">
                    {manage && r.status !== "retired" && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, itemId: r.itemId, itemLabel: `${r.itemCode} · ${r.itemName}`, machineId: r.machineId ?? "", notes: r.notes ?? "", parameters: r.parameters.map(toParam) })}>Edit</Button>}
                    {manage && r.status === "draft" && <Button size="sm" onClick={() => run(() => api(`/mes/recipes/${r.id}/release`, { body: {} }))}>Release</Button>}
                  </span>
                </td>
              </tr>
            ))}
            {list.data && !list.data.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No recipes yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Dialog open={!!edit} onClose={() => setEdit(null)} size="xl" title={edit?.id ? "Edit recipe" : "New recipe"} footer={<Button disabled={!edit?.itemId || !edit?.parameters.every((p) => p.name && p.value !== "")} onClick={save}>Save draft</Button>}>
        {edit && (
          <div className="space-y-3 text-sm">
            {error && <Alert>{error}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              {edit.itemLabel ? <p className="flex h-10 items-center">{edit.itemLabel}</p> : <ItemPicker placeholder="Item made" onPick={(i) => setEdit({ ...edit, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}
              <Select aria-label="Machine" value={edit.machineId} onChange={(e) => setEdit({ ...edit, machineId: e.target.value })}><option value="">Any machine</option>{machines.data?.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</Select>
            </div>
            {edit.parameters.map((p, i) => (
              <div key={i} className="space-y-1 rounded-lg border border-border p-2">
                <div className="flex flex-wrap gap-2">
                  <Input className="w-44" aria-label="Parameter" placeholder="Parameter" value={p.name} onChange={(e) => setP(i, { name: e.target.value })} />
                  <Input className="w-24" type="number" step="any" aria-label="Set-point" placeholder="Set-point" value={p.value} onChange={(e) => setP(i, { value: e.target.value })} />
                  <Input className="w-16" aria-label="Unit" placeholder="Unit" value={p.unit} onChange={(e) => setP(i, { unit: e.target.value })} />
                  <Input className="w-20" type="number" step="any" aria-label="Minimum" placeholder="Min" value={p.min} onChange={(e) => setP(i, { min: e.target.value })} />
                  <Input className="w-20" type="number" step="any" aria-label="Maximum" placeholder="Max" value={p.max} onChange={(e) => setP(i, { max: e.target.value })} />
                  <Input className="w-40" aria-label="Measured by signal" placeholder="Measured by (tag)" value={p.signalCode} onChange={(e) => setP(i, { signalCode: e.target.value })} />
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, parameters: edit.parameters.filter((_, j) => j !== i) })}>Remove</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select className="w-40" aria-label="Write to" value={p.protocol} onChange={(e) => setP(i, { protocol: e.target.value as Param["protocol"] })}><option value="">Set by hand</option><option value="modbus-tcp">Modbus register</option><option value="mqtt">MQTT topic</option></Select>
                  {p.protocol && <Input className="w-48" aria-label="PLC or broker" placeholder={p.protocol === "mqtt" ? "mqtt://host:1883" : "host:502"} value={p.endpoint} onChange={(e) => setP(i, { endpoint: e.target.value })} />}
                  {p.protocol && <Input className="w-40" aria-label="Register or topic" placeholder={p.protocol === "mqtt" ? "topic" : "register"} value={p.address} onChange={(e) => setP(i, { address: e.target.value })} />}
                  {p.protocol === "modbus-tcp" && <Select className="w-28" aria-label="Data type" value={p.dataType} onChange={(e) => setP(i, { dataType: e.target.value })}>{["uint16", "int16", "uint32", "int32", "float32"].map((d) => <option key={d}>{d}</option>)}</Select>}
                </div>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setEdit({ ...edit, parameters: [...edit.parameters, emptyParam()] })}>Add parameter</Button>
            <textarea aria-label="Notes" rows={2} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="Notes" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
          </div>
        )}
      </Dialog>
    </div>
  );
}
