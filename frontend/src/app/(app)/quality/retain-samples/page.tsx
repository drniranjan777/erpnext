"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty, todayIST } from "@/lib/documents";
import { QA } from "@/lib/quality";
import { DataTable } from "@/components/ui/data-table";

interface Sample { id: string; batchNo: string; qty: string; location: string; drawnOn: string; retainUntil: string; disposedOn: string | null; notes: string | null; itemId: string; code: string; name: string; uom: string }

export default function RetainSamplesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("quality.inspections.manage");
  const [due, setDue] = useState(false);
  const q = useQuery({ queryKey: [QA, "retains", due], queryFn: () => api<Sample[]>(`${QA}/retain-samples`, { query: { due: due ? "true" : undefined } }) });
  const [adding, setAdding] = useState(false);
  const today = todayIST();
  async function dispose(s: Sample) {
    await api(`${QA}/retain-samples/${s.id}/dispose`, { method: "POST" });
    qc.invalidateQueries({ queryKey: [QA, "retains"] });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Retain samples" description="Reference samples kept from each lot for the retention period, for complaints and stability checks. Samples past their retention date are listed for disposal." actions={manage && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add sample</Button>} />
      <Checkbox label="Only samples due for disposal" checked={due} onChange={(e) => setDue(e.target.checked)} />
      {adding && <AddSample onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: [QA, "retains"] }); }} onCancel={() => setAdding(false)} />}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            rows={q.data}
            rowKey={(s) => String(s.id)}
            rowClassName={(s) => s.disposedOn ? "text-muted" : undefined}
            exportName="quality-retain-samples"
            storageKey="quality-retain-samples-0"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No retain samples.</p>}
            columns={[
              { key: "lot", label: "Lot", locked: true, className: "whitespace-normal", render: (s) => <><span className="font-mono font-medium">{s.batchNo}</span><span className="block text-xs text-muted">{s.code} {s.name}</span></> },
              { key: "qty", label: "Qty", align: "right", render: (s) => <>{formatQty(s.qty)} {s.uom}</> },
              { key: "where", label: "Where", className: "whitespace-normal", render: (s) => <>{s.location}</> },
              { key: "drawn", label: "Drawn", className: "whitespace-normal", render: (s) => <>{formatDate(s.drawnOn)}</> },
              { key: "keep-until", label: "Keep until", className: "whitespace-normal", render: (s) => <>{formatDate(s.retainUntil)}{!s.disposedOn && s.retainUntil <= today && <Badge tone="warning" className="ml-2">Due</Badge>}</> },
              { key: "col5", label: "", align: "right", noSort: true, render: (s) => <>{s.disposedOn ? <span className="text-xs">Disposed {formatDate(s.disposedOn)}</span> : manage && <Button size="sm" variant="ghost" onClick={() => dispose(s)}>Dispose</Button>}</> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

function AddSample({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ batchNo: "", qty: "", location: "", retainUntil: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!item) return setError("Choose the item");
    setBusy(true);
    setError(null);
    try {
      await api(`${QA}/retain-samples`, { body: { itemId: item.id, ...f, notes: f.notes || null } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="New retain sample" />
      <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-3">
        {error && <div className="sm:col-span-3"><Alert>{error}</Alert></div>}
        <Field label="Item" required className="sm:col-span-2">{() => (item ? <div className="flex items-center gap-2 text-sm">{item.label}<Button size="sm" variant="ghost" onClick={() => setItem(null)}>Change</Button></div> : <ItemPicker onPick={(it) => setItem({ id: it.id, label: `${it.code} ${it.name}` })} />)}</Field>
        <Field label="Lot" required>{(p) => <Input {...p} className="font-mono uppercase" value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />}</Field>
        <Field label="Quantity" required>{(p) => <Input {...p} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />}</Field>
        <Field label="Where it is kept" required>{(p) => <Input {...p} placeholder="Cabinet, shelf" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />}</Field>
        <Field label="Keep until" required>{(p) => <Input {...p} type="date" value={f.retainUntil} onChange={(e) => setF({ ...f, retainUntil: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2 sm:col-span-3">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save</Button>
        </div>
      </div>
    </Card>
  );
}
