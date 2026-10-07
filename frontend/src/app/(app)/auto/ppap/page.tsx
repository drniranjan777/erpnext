"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Row { id: string; code: string; itemCode: string; itemName: string; customer: string | null; level: number; reason: string; status: string; submittedAt: string | null; complete: number }
const TONE: Record<string, "neutral" | "warning" | "success" | "danger"> = { draft: "neutral", submitted: "warning", approved: "success", interim: "warning", rejected: "danger" };

/** PPAP submissions (AIAG 4th edition): the 18 elements by level, the PSW and the customer's decision. */
export default function PpapPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/auto/ppap"], queryFn: () => api<Row[]>("/auto/ppap") });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="PPAP" description="Production part approval: what to submit depends on the level (1 PSW only … 3 everything, 4 as the customer says, 5 reviewed at your site)." actions={can("auto.apqp.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New PPAP</Button>} />
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.id}>
              <Link href={`/auto/ppap/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-muted">
                <Badge tone={TONE[r.status]}>{r.status}</Badge>
                <span className="font-medium">{r.code}</span>
                <span>{r.itemCode} · {r.itemName}</span>
                <span className="text-xs text-muted">{r.customer ?? ""} · level {r.level} · {r.reason.replace("_", " ")}</span>
                <span className="ml-auto text-xs">{r.complete} of 18 elements{r.submittedAt ? ` · submitted ${formatDateTime(r.submittedAt)}` : ""}</span>
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">No PPAP submissions.</li>}
        </ul>
      </Card>
      {creating && <NewPpap onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewPpap({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [customer, setCustomer] = useState<PickedParty | null>(null);
  const [f, setF] = useState({ code: "", itemId: "", itemLabel: "", customerPartNo: "", drawingRev: "", level: "3", reason: "initial" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api("/auto/ppap", { body: { code: f.code, itemId: f.itemId, customerId: customer?.id ?? null, customerPartNo: f.customerPartNo || null, drawingRev: f.drawingRev || null, level: Number(f.level), reason: f.reason } });
      qc.invalidateQueries({ queryKey: ["/auto/ppap"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New PPAP submission" footer={<Button disabled={!f.code || !f.itemId} onClick={save}>Create</Button>}>
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        <Input aria-label="Code" placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        {f.itemLabel ? <p>{f.itemLabel}</p> : <ItemPicker placeholder="Part" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}
        <PartyPicker role="customer" value={customer} onChange={setCustomer} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Customer part no." placeholder="Customer part no." value={f.customerPartNo} onChange={(e) => setF({ ...f, customerPartNo: e.target.value })} />
          <Input aria-label="Drawing revision" placeholder="Drawing revision" value={f.drawingRev} onChange={(e) => setF({ ...f, drawingRev: e.target.value })} />
          <Select aria-label="Level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Level {l}</option>)}</Select>
          <Select aria-label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}><option value="initial">Initial submission</option><option value="engineering_change">Engineering change</option><option value="tooling">Tooling transfer or change</option><option value="correction">Correction of discrepancy</option><option value="other">Other</option></Select>
        </div>
      </div>
    </Dialog>
  );
}
