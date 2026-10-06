"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AQLS, LEVELS, QA, STAGE, type Plan, type Stage } from "@/lib/quality";

const KEY = [QA, "plans"];

export default function PlansPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Plan[]>(`${QA}/plans`) });
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const manage = can("quality.inspections.manage");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Inspection plans"
        description="What to check on an item at each stage, with limits, and how many to sample (ISO 2859-1 AQL, a fixed sample or 100%)."
        actions={manage ? <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> New plan</Button> : undefined}
      />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.length && <EmptyState title="No plans yet" description="Add a plan for incoming raw materials or finished goods to start inspecting automatically." />}
      <div className="grid gap-4 md:grid-cols-2">
        {q.data?.map((p) => (
          <Card key={p.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium"><span className="font-mono text-xs text-muted">{p.code}</span> {p.name}</p>
                <p className="text-sm text-muted">{p.item.code} {p.item.name}</p>
              </div>
              <div className="flex items-center gap-1">
                <Badge>{STAGE[p.stage]}{p.operationSeq ? ` · op ${p.operationSeq}` : ""}</Badge>
                {!p.isActive && <Badge tone="warning">Inactive</Badge>}
                {manage && <Button size="sm" variant="ghost" aria-label={`Edit ${p.code}`} onClick={() => setEditing(p)}><Pencil className="size-4" aria-hidden /></Button>}
              </div>
            </div>
            <p className="text-xs text-muted">{p.sampling === "aql" ? `AQL ${p.aql}, general level ${p.inspectionLevel}` : p.sampling === "fixed" ? `Fixed sample of ${p.fixedSampleSize}` : "100% inspection"}</p>
            <ul className="space-y-1 text-sm">
              {p.parameters.map((x) => (
                <li key={x.id} className="flex justify-between gap-2">
                  <span>{x.name}{x.isCritical && <Badge tone="danger" className="ml-1">Critical</Badge>}{x.method && <span className="text-xs text-muted"> · {x.method}</span>}</span>
                  <span className="tabular-nums text-muted">{x.kind === "attribute" ? "Pass / fail" : `${x.lowerLimit !== null ? Number(x.lowerLimit) : "…"} – ${x.upperLimit !== null ? Number(x.upperLimit) : "…"} ${x.unit ?? ""}`}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {editing && <PlanDialog plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

interface ParamRow { key: string; name: string; kind: "numeric" | "attribute"; unit: string; nominal: string; lowerLimit: string; upperLimit: string; isCritical: boolean; method: string }
let n = 0;
const k = () => `p${++n}`;
const num = (v: string | null) => (v === null ? "" : String(Number(v)));

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [item, setItem] = useState<{ id: string; label: string } | null>(plan ? { id: plan.item.id, label: `${plan.item.code} ${plan.item.name}` } : null);
  const [f, setF] = useState({
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    stage: plan?.stage ?? ("incoming" as Stage),
    operationSeq: plan?.operationSeq ? String(plan.operationSeq) : "",
    sampling: plan?.sampling ?? ("aql" as Plan["sampling"]),
    inspectionLevel: plan?.inspectionLevel ?? "II",
    aql: plan?.aql ?? "2.5",
    fixedSampleSize: plan?.fixedSampleSize ? String(plan.fixedSampleSize) : "",
    isActive: plan?.isActive ?? true,
    instructions: plan?.instructions ?? "",
  });
  const [params, setParams] = useState<ParamRow[]>(
    plan?.parameters.map((p) => ({ key: k(), name: p.name, kind: p.kind, unit: p.unit ?? "", nominal: num(p.nominal), lowerLimit: num(p.lowerLimit), upperLimit: num(p.upperLimit), isCritical: p.isCritical, method: p.method ?? "" })) ?? [{ key: k(), name: "", kind: "numeric", unit: "mm", nominal: "", lowerLimit: "", upperLimit: "", isCritical: false, method: "" }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upd = (key: string, p: Partial<ParamRow>) => setParams((ps) => ps.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function save() {
    if (!item) return setErrors({ itemId: "Choose the item" });
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      ...f,
      itemId: item.id,
      operationSeq: f.stage === "in_process" && f.operationSeq ? Number(f.operationSeq) : null,
      fixedSampleSize: f.sampling === "fixed" ? Number(f.fixedSampleSize) || null : null,
      instructions: f.instructions || null,
      parameters: params.map((p) => ({ name: p.name, kind: p.kind, unit: p.unit || null, nominal: p.kind === "numeric" ? p.nominal || null : null, lowerLimit: p.kind === "numeric" ? p.lowerLimit || null : null, upperLimit: p.kind === "numeric" ? p.upperLimit || null : null, isCritical: p.isCritical, method: p.method || null })),
    };
    try {
      await api(plan ? `${QA}/plans/${plan.id}` : `${QA}/plans`, { method: plan ? "PUT" : "POST", body });
      qc.invalidateQueries({ queryKey: KEY });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fieldErrors);
        setError(e.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} size="xl" title={plan ? `Edit ${plan.code}` : "New inspection plan"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Code" required error={errors.code}>{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name" required error={errors.name} className="sm:col-span-3">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Item" required error={errors.itemId} className="sm:col-span-2">
          {() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />)}
        </Field>
        <Field label="Stage" error={errors.stage}>
          {(p) => (
            <Select {...p} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>
              <option value="incoming">Incoming</option>
              <option value="in_process">In-process</option>
              <option value="final">Final</option>
            </Select>
          )}
        </Field>
        {f.stage === "in_process" ? (
          <Field label="After operation" hint="Blank = any flagged operation" error={errors.operationSeq}>{(p) => <Input {...p} inputMode="numeric" value={f.operationSeq} onChange={(e) => setF({ ...f, operationSeq: e.target.value })} />}</Field>
        ) : <div />}
        <Field label="Sampling" error={errors.sampling}>
          {(p) => (
            <Select {...p} value={f.sampling} onChange={(e) => setF({ ...f, sampling: e.target.value as Plan["sampling"] })}>
              <option value="aql">AQL (ISO 2859-1)</option>
              <option value="fixed">Fixed sample</option>
              <option value="full">100%</option>
            </Select>
          )}
        </Field>
        {f.sampling === "aql" && (
          <>
            <Field label="AQL" error={errors.aql}>{(p) => <Select {...p} value={f.aql} onChange={(e) => setF({ ...f, aql: e.target.value })}>{AQLS.map((a) => <option key={a} value={a}>{a}</option>)}</Select>}</Field>
            <Field label="Inspection level" error={errors.inspectionLevel}>{(p) => <Select {...p} value={f.inspectionLevel} onChange={(e) => setF({ ...f, inspectionLevel: e.target.value })}>{LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</Select>}</Field>
          </>
        )}
        {f.sampling === "fixed" && <Field label="Sample size" error={errors.fixedSampleSize}>{(p) => <Input {...p} inputMode="numeric" value={f.fixedSampleSize} onChange={(e) => setF({ ...f, fixedSampleSize: e.target.value })} />}</Field>}
        <div className="flex items-end pb-2"><Checkbox label="Active" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /></div>
        <Field label="Instructions for the inspector" className="sm:col-span-4">{(p) => <Input {...p} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />}</Field>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-sm font-medium">Characteristics</p>
        {params.map((p, i) => (
          <div key={p.key} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]">
            <Field label="Name" error={errors[`parameters.${i}.name`]}>{(a) => <Input {...a} value={p.name} onChange={(e) => upd(p.key, { name: e.target.value })} />}</Field>
            <Field label="Type">{(a) => <Select {...a} value={p.kind} onChange={(e) => upd(p.key, { kind: e.target.value as ParamRow["kind"] })}><option value="numeric">Measured</option><option value="attribute">Pass / fail</option></Select>}</Field>
            {p.kind === "numeric" ? (
              <>
                <Field label="Lower" error={errors[`parameters.${i}.lowerLimit`]}>{(a) => <Input {...a} inputMode="decimal" value={p.lowerLimit} onChange={(e) => upd(p.key, { lowerLimit: e.target.value })} />}</Field>
                <Field label="Upper" error={errors[`parameters.${i}.upperLimit`]}>{(a) => <Input {...a} inputMode="decimal" value={p.upperLimit} onChange={(e) => upd(p.key, { upperLimit: e.target.value })} />}</Field>
                <Field label="Unit">{(a) => <Input {...a} value={p.unit} onChange={(e) => upd(p.key, { unit: e.target.value })} />}</Field>
              </>
            ) : (
              <div className="sm:col-span-3" />
            )}
            <Field label="Method">{(a) => <Input {...a} value={p.method} onChange={(e) => upd(p.key, { method: e.target.value })} />}</Field>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox label="Critical" checked={p.isCritical} onChange={(e) => upd(p.key, { isCritical: e.target.checked })} />
              <Button size="sm" variant="ghost" aria-label="Remove characteristic" onClick={() => setParams((ps) => ps.filter((x) => x.key !== p.key))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          </div>
        ))}
        {errors.parameters && <p className="text-xs text-danger">{errors.parameters}</p>}
        <Button size="sm" variant="secondary" onClick={() => setParams((ps) => [...ps, { key: k(), name: "", kind: "numeric", unit: "mm", nominal: "", lowerLimit: "", upperLimit: "", isCritical: false, method: "" }])}><Plus className="size-4" aria-hidden /> Add characteristic</Button>
      </div>
    </Dialog>
  );
}
