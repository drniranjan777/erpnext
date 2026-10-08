"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { QMS, RISK_TONE, textarea, type Deviation } from "@/lib/qms";

/** Same bands as the server: severity 5 or RPN ≥ 45 high, ≥ 18 medium. */
function riskLevel(s: number, o: number, d: number) {
  const rpn = s * o * d;
  return { rpn, level: (s >= 5 || rpn >= 45 ? "high" : rpn >= 18 ? "medium" : "low") as keyof typeof RISK_TONE };
}

export function RiskInputs({ value, onChange }: { value: { severity: number; occurrence: number; detection: number }; onChange: (v: { severity: number; occurrence: number; detection: number }) => void }) {
  const r = riskLevel(value.severity, value.occurrence, value.detection);
  const pick = (k: keyof typeof value, label: string, hint: string) => (
    <Field label={label} hint={hint}>{(p) => <Select {...p} value={value[k]} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}</Field>
  );
  return (
    <div className="grid items-end gap-4 sm:grid-cols-4">
      {pick("severity", "Severity", "1 none … 5 safety / regulatory")}
      {pick("occurrence", "Occurrence", "1 remote … 5 frequent")}
      {pick("detection", "Detection", "1 certain … 5 undetectable")}
      <div className="pb-2 text-sm">RPN <span className="font-semibold tabular-nums">{r.rpn}</span> <Badge tone={RISK_TONE[r.level]}>{r.level}</Badge></div>
    </div>
  );
}

export function DeviationForm({ deviation }: { deviation?: Deviation }) {
  const router = useRouter();
  const [item, setItem] = useState<{ id: string; label: string } | null>(deviation?.item ? { id: deviation.item.id, label: `${deviation.item.code} ${deviation.item.name}` } : null);
  const [f, setF] = useState({
    kind: deviation?.kind ?? "unplanned",
    category: deviation?.category ?? "process",
    description: deviation?.description ?? "",
    batchNo: deviation?.batchNo ?? "",
    impact: deviation?.impact ?? "",
    proposedAction: deviation?.proposedAction ?? "",
    validUntil: deviation?.validUntil ?? "",
    productImpact: deviation?.productImpact ?? false,
  });
  const [risk, setRisk] = useState({ severity: deviation?.severity ?? 3, occurrence: deviation?.occurrence ?? 2, detection: deviation?.detection ?? 2 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    setError(null);
    const body = { ...f, ...risk, itemId: item?.id ?? null, workOrderId: deviation?.workOrder?.id ?? null, batchNo: f.batchNo || null, impact: f.impact || null, proposedAction: f.proposedAction || null, validUntil: f.kind === "planned" ? f.validUntil || null : null };
    try {
      const r = await api<Deviation>(deviation ? `${QMS}/deviations/${deviation.id}` : `${QMS}/deviations`, { method: deviation ? "PUT" : "POST", body: deviation ? { ...body, version: deviation.version } : body });
      router.push(`/quality/deviations/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={set("kind")}><option value="unplanned">Unplanned (found)</option><option value="planned">Planned (asked for in advance)</option></Select>}</Field>
        <Field label="Category">{(p) => <Select {...p} value={f.category} onChange={set("category")}>{["process", "material", "equipment", "document", "environment", "other"].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</Select>}</Field>
        {f.kind === "planned" ? <Field label="Applies until" required>{(p) => <Input {...p} type="date" value={f.validUntil} onChange={set("validUntil")} />}</Field> : <div />}
        <Field label="Item" className="sm:col-span-2">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />)}</Field>
        <Field label="Batch / lot">{(p) => <Input {...p} className="font-mono uppercase" value={f.batchNo} onChange={set("batchNo")} />}</Field>
        <Field label="What happened (or what is proposed)" required className="sm:col-span-3">{(p) => <textarea {...p} rows={3} className={textarea} value={f.description} onChange={set("description")} />}</Field>
        <Field label="Impact assessment" className="sm:col-span-2">{(p) => <textarea {...p} rows={2} className={textarea} value={f.impact} onChange={set("impact")} />}</Field>
        <div className="flex items-end pb-2"><Checkbox label="Affects the product" checked={f.productImpact} onChange={(e) => setF({ ...f, productImpact: e.target.checked })} /></div>
        <Field label="Proposed action" className="sm:col-span-3">{(p) => <textarea {...p} rows={2} className={textarea} value={f.proposedAction} onChange={set("proposedAction")} />}</Field>
      </Card>
      <Card>
        <CardHeader title="Risk assessment" />
        <div className="border-t border-border p-5"><RiskInputs value={risk} onChange={setRisk} /></div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy}>Save</Button>
      </div>
    </div>
  );
}
