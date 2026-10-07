"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, Info } from "@/components/documents/doc-page";
import { ActivityFeed, AttachmentsPanel } from "@/components/documents/document-parts";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { KIND, MT, STAGE, hours, type MaintenanceOrder } from "@/lib/maintenance";
import { useWarehouses } from "@/lib/masters";

const API = `${MT}/orders`;

export default function MaintenanceOrderPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const key = [MT, "orders", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<MaintenanceOrder>(`${API}/${id}`) });
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function call(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [MT] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: API, label: "Maintenance orders" }}
        badges={<><Badge>{KIND[d.kind]}</Badge>{d.status === "draft" && <Badge tone={STAGE[d.stage].tone}>{STAGE[d.stage].label}</Badge>}{d.machineDown && d.status === "draft" && <Badge tone="danger">Machine down</Badge>}</>}
        subtitle={d.problem}
        actions={
          <>
            {d.canStart && <Button onClick={() => call(() => api(`${API}/${d.id}/start`, { body: { version: d.version } }))}><Play className="size-4" aria-hidden /> Start work</Button>}
            <DocumentActions doc={{ ...d, can: { ...d.can, edit: false, submit: d.can.submit && d.stage === "done" } }} apiBase={API} routeBase={API} queryKey={key} />
          </>
        }
      />
      {error && <Alert>{error}</Alert>}
      {d.status === "approved" && <Alert tone="success">Signed off. Spares issued, cost {formatMoney(d.totalCost)}, downtime {hours(d.downtimeMinutes)}.</Alert>}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Asset" value={d.asset ? <Link className="text-primary hover:underline" href={`${MT}/assets/${d.asset.id}`}>{d.asset.code} {d.asset.name}</Link> : d.tool ? `${d.tool.code} ${d.tool.name} (${d.tool.shotsUsed} shots)` : "–"} />
          <Info label="Reported" value={`${formatDateTime(d.reportedAt)}${d.requestedBy ? ` by ${d.requestedBy}` : ""}`} />
          <Info label="Priority" value={d.priority} />
          {d.plannedDate && <Info label="Planned for" value={formatDate(d.plannedDate)} />}
          {d.schedule && <Info label="PM schedule" value={d.schedule.title} />}
          <Info label="Assigned to" value={d.assignedTo ?? "–"} />
          {d.startedAt && <Info label="Started" value={formatDateTime(d.startedAt)} />}
          {d.finishedAt && <Info label="Finished" value={formatDateTime(d.finishedAt)} />}
          {d.stage === "done" && <Info label="Downtime" value={hours(d.downtimeMinutes)} />}
        </dl>
      </Card>
      {d.canComplete ? <CompleteForm d={d} onDone={() => qc.invalidateQueries({ queryKey: [MT] })} /> : d.stage === "done" && <Findings d={d} />}
      <AttachmentsPanel documentId={d.id} readOnly={d.status === "approved"} />
      <ActivityFeed documentId={d.id} />
    </div>
  );
}

function Findings({ d }: { d: MaintenanceOrder }) {
  return (
    <Card>
      <CardHeader title="What was done" />
      <div className="space-y-3 border-t border-border px-5 py-4 text-sm">
        {d.failureCode && <p><span className="font-medium">Cause:</span> {d.failureCode}</p>}
        <p className="whitespace-pre-line">{d.actionTaken}</p>
        {d.checklist.length > 0 && <ul className="space-y-1">{d.checklist.map((c, i) => <li key={i}><Badge tone={c.ok ? "success" : "danger"}>{c.ok ? "OK" : "Not OK"}</Badge> {c.item}{c.note && <span className="text-muted"> · {c.note}</span>}</li>)}</ul>}
        {d.labour.length > 0 && <p className="text-muted">Labour: {d.labour.map((l) => `${l.person} ${l.hours} h × ₹${l.rate}`).join(", ")} = {formatMoney(d.labourCost)}</p>}
        {d.spares.length > 0 && <p className="text-muted">Spares: {d.spares.map((s) => `${s.code} × ${formatQty(s.qty)} from ${s.warehouse}${Number(s.value) ? ` (${formatMoney(s.value)})` : ""}`).join(", ")}</p>}
        {d.status === "approved" && <p className="font-medium">Total cost {formatMoney(d.totalCost)} (labour {formatMoney(d.labourCost)}, spares {formatMoney(d.sparesCost)}, other {formatMoney(d.otherCost)})</p>}
      </div>
    </Card>
  );
}

function CompleteForm({ d, onDone }: { d: MaintenanceOrder; onDone: () => void }) {
  const whs = useWarehouses();
  const [f, setF] = useState({ failureCode: d.failureCode ?? "", actionTaken: d.actionTaken ?? "", otherCost: Number(d.otherCost) ? String(Number(d.otherCost)) : "", meterReading: d.meterReading ? String(Number(d.meterReading)) : "" });
  const [checklist, setChecklist] = useState(d.checklist.map((c) => ({ ...c, ok: c.ok ?? true })));
  const [labour, setLabour] = useState(d.labour.length ? d.labour : [{ person: d.assignedTo ?? "", hours: "", rate: "" }]);
  const [spares, setSpares] = useState<{ itemId: string; label: string; warehouseId: string; qty: string }[]>(d.spares.map((s) => ({ itemId: s.itemId, label: `${s.code} ${s.name}`, warehouseId: s.warehouseId, qty: String(Number(s.qty)) })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`${API}/${d.id}/complete`, { body: { version: d.version, failureCode: f.failureCode || null, actionTaken: f.actionTaken, otherCost: f.otherCost || "0", meterReading: f.meterReading || null, checklist, labour: labour.filter((l) => l.person && l.hours), spares: spares.filter((s) => s.qty).map((s) => ({ itemId: s.itemId, warehouseId: s.warehouseId, qty: s.qty })) } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title={d.stage === "done" ? "Findings (you can still correct them before sign-off)" : "Complete the job"} />
      <div className="space-y-4 border-t border-border p-5">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Cause / failure code">{(p) => <Input {...p} value={f.failureCode} onChange={(e) => setF({ ...f, failureCode: e.target.value })} />}</Field>
          {d.asset?.meterUnit && <Field label={`Meter (${d.asset.meterUnit})`}>{(p) => <Input {...p} inputMode="decimal" value={f.meterReading} onChange={(e) => setF({ ...f, meterReading: e.target.value })} />}</Field>}
          <Field label="Other cost (₹)" hint="Outside service, consumables">{(p) => <Input {...p} inputMode="decimal" value={f.otherCost} onChange={(e) => setF({ ...f, otherCost: e.target.value })} />}</Field>
          <Field label="What was done" required className="sm:col-span-3">{(p) => <Input {...p} value={f.actionTaken} onChange={(e) => setF({ ...f, actionTaken: e.target.value })} />}</Field>
        </div>
        {checklist.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Checklist</p>
            {checklist.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Select className="h-8 w-28" aria-label={c.item} value={c.ok ? "ok" : "nok"} onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? { ...x, ok: e.target.value === "ok" } : x)))}><option value="ok">OK</option><option value="nok">Not OK</option></Select>
                <span className="flex-1">{c.item}</span>
                <Input className="h-8 w-56" aria-label="Note" placeholder="Note" value={c.note ?? ""} onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? { ...x, note: e.target.value || null } : x)))} />
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium">Labour</p>
          {labour.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="h-8 w-48" aria-label="Person" placeholder="Person" value={l.person} onChange={(e) => setLabour(labour.map((x, j) => (j === i ? { ...x, person: e.target.value } : x)))} />
              <Input className="h-8 w-24" aria-label="Hours" placeholder="Hours" inputMode="decimal" value={l.hours} onChange={(e) => setLabour(labour.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} />
              <Input className="h-8 w-28" aria-label="Rate per hour" placeholder="₹ / hour" inputMode="decimal" value={l.rate} onChange={(e) => setLabour(labour.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setLabour(labour.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setLabour([...labour, { person: "", hours: "", rate: "" }])}><Plus className="size-4" aria-hidden /> Person</Button>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Spares used (issued at sign-off)</p>
          {spares.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-56 truncate">{s.label}</span>
              <Select className="h-8 w-40" aria-label="From store" value={s.warehouseId} onChange={(e) => setSpares(spares.map((x, j) => (j === i ? { ...x, warehouseId: e.target.value } : x)))}>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}</Select>
              <Input className="h-8 w-24" aria-label="Quantity" inputMode="decimal" value={s.qty} onChange={(e) => setSpares(spares.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setSpares(spares.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <div className="w-80"><ItemPicker placeholder="Add a spare…" stockOnly onPick={(it) => setSpares([...spares, { itemId: it.id, label: `${it.code} ${it.name}`, warehouseId: whs.data?.[0]?.id ?? "", qty: "1" }])} /></div>
        </div>
        <div className="flex justify-end"><Button onClick={save} loading={busy} disabled={f.actionTaken.trim().length < 3}>{d.stage === "done" ? "Update findings" : "Mark done"}</Button></div>
      </div>
    </Card>
  );
}
