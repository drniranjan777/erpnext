"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PROC } from "@/lib/process";

interface Equipment { id: string; code: string; name: string; workCenter: string; cleanStatus: "clean" | "in_use" | "dirty"; lastItem: string | null; lastCleaning: { kind: string; cleanedBy: string; verifiedBy: string | null; cleanedAt: string; result: string | null } | null }
const TONE = { clean: "success", in_use: "warning", dirty: "danger" } as const;
const LABEL = { clean: "Clean", in_use: "In use", dirty: "Needs cleaning" } as const;
const KIND = { minor: "Minor (same product)", major: "Major", product_change: "Product change" } as const;

export default function EquipmentPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: [PROC, "equipment"], queryFn: () => api<Equipment[]>(`${PROC}/equipment`), refetchInterval: 30_000 });
  const [cleaning, setCleaning] = useState<Equipment | null>(null);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Process equipment" description="Vessels and machines that must be cleaned before the next batch. A batch cannot start on dirty equipment, and a change of product needs a product-change clean." />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.length && <EmptyState title="No process equipment" description="Tick “must be cleaned before each batch” on a machine under Work centres & tools." />}
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.map((e) => (
          <Card key={e.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium"><span className="font-mono text-xs text-muted">{e.code}</span> {e.name}</p>
                <p className="text-xs text-muted">{e.workCenter}{e.lastItem && ` · last made ${e.lastItem}`}</p>
              </div>
              <Badge tone={TONE[e.cleanStatus]}>{LABEL[e.cleanStatus]}</Badge>
            </div>
            {e.lastCleaning && <p className="text-xs text-muted">Last cleaned {formatDateTime(e.lastCleaning.cleanedAt)} ({KIND[e.lastCleaning.kind as keyof typeof KIND] ?? e.lastCleaning.kind}) by {e.lastCleaning.cleanedBy}{e.lastCleaning.verifiedBy && `, verified by ${e.lastCleaning.verifiedBy}`}</p>}
            {can("manufacturing.shopfloor.record") && e.cleanStatus !== "in_use" && <Button size="sm" variant={e.cleanStatus === "dirty" ? "primary" : "secondary"} onClick={() => setCleaning(e)}><Sparkles className="size-4" aria-hidden /> Record cleaning</Button>}
          </Card>
        ))}
      </div>
      {cleaning && <CleanDialog e={cleaning} onClose={() => setCleaning(null)} onDone={() => { setCleaning(null); qc.invalidateQueries({ queryKey: [PROC, "equipment"] }); }} />}
    </div>
  );
}

function CleanDialog({ e, onClose, onDone }: { e: Equipment; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ kind: "minor", cleanedBy: "", verifiedBy: "", result: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api(`${PROC}/equipment/${e.id}/clean`, { body: { kind: f.kind, cleanedBy: f.cleanedBy, verifiedBy: f.verifiedBy || null, result: f.result || null, notes: f.notes || null } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Clean ${e.code}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy}>Record</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cleaning" className="sm:col-span-2">{(p) => <Select {...p} value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Cleaned by" required>{(p) => <Input {...p} value={f.cleanedBy} onChange={(x) => setF({ ...f, cleanedBy: x.target.value })} />}</Field>
        <Field label="Verified by">{(p) => <Input {...p} value={f.verifiedBy} onChange={(x) => setF({ ...f, verifiedBy: x.target.value })} />}</Field>
        <Field label="Swab / rinse result" className="sm:col-span-2">{(p) => <Input {...p} value={f.result} onChange={(x) => setF({ ...f, result: x.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
