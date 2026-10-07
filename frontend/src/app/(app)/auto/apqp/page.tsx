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
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";

interface Row { id: string; code: string; name: string; customer: string | null; item: string | null; sopDate: string | null; status: string; gatesPassed: number; progress: { phase: number; pct: number }[] }

/** APQP projects: five phases of deliverables, each closed by a signed gate. */
export default function ApqpPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/auto/apqp"], queryFn: () => api<Row[]>("/auto/apqp") });
  const [creating, setCreating] = useState(false);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="APQP" description="Advanced product quality planning for new and changed parts: the 24 standard deliverables across five phases, each phase closed by a signed gate. PPAP is the deliverable of phase 4." actions={can("auto.apqp.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New project</Button>} />
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Project</th><th className="px-4 py-2 font-medium">Customer · part</th><th className="px-4 py-2 font-medium">SOP</th><th className="px-4 py-2 font-medium">Phases</th></tr></thead>
          <tbody className="divide-y divide-border">
            {list.data?.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2"><Link className="font-medium text-primary hover:underline" href={`/auto/apqp/${r.id}`}>{r.code}</Link><span className="block text-xs text-muted">{r.name}</span></td>
                <td className="px-4 py-2">{r.customer ?? "–"}<span className="block text-xs text-muted">{r.item ?? ""}</span></td>
                <td className="px-4 py-2">{r.sopDate ? formatDate(r.sopDate) : "–"}</td>
                <td className="px-4 py-2"><div className="flex gap-1">{r.progress.map((p) => <span key={p.phase} title={`Phase ${p.phase}: ${p.pct} %`} className={`h-2 w-8 rounded ${p.phase <= r.gatesPassed ? "bg-success" : p.pct > 0 ? "bg-warning" : "bg-surface-muted"}`} />)}</div><span className="text-xs text-muted">{r.gatesPassed} of 5 gates</span>{r.status !== "active" && <Badge className="ml-1">{r.status}</Badge>}</td>
              </tr>
            ))}
            {list.data && !list.data.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No APQP projects.</td></tr>}
          </tbody>
        </table>
      </Card>
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [customer, setCustomer] = useState<PickedParty | null>(null);
  const [f, setF] = useState({ code: "", name: "", itemId: "", itemLabel: "", customerPartNo: "", program: "", sopDate: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api("/auto/apqp", { body: { code: f.code, name: f.name, customerId: customer?.id ?? null, itemId: f.itemId || null, customerPartNo: f.customerPartNo || null, program: f.program || null, sopDate: f.sopDate || null } });
      qc.invalidateQueries({ queryKey: ["/auto/apqp"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New APQP project" footer={<Button disabled={!f.code || f.name.length < 2} onClick={save}>Create</Button>}>
      <div className="space-y-3 text-sm">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Code" placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <PartyPicker role="customer" value={customer} onChange={setCustomer} />
        {f.itemLabel ? <p>{f.itemLabel}</p> : <ItemPicker placeholder="Part (item)" onPick={(i) => setF({ ...f, itemId: i.id, itemLabel: `${i.code} · ${i.name}` })} />}
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Customer part no." placeholder="Customer part no." value={f.customerPartNo} onChange={(e) => setF({ ...f, customerPartNo: e.target.value })} />
          <Input aria-label="Program" placeholder="Vehicle program" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} />
          <Input type="date" aria-label="SOP date" value={f.sopDate} onChange={(e) => setF({ ...f, sopDate: e.target.value })} />
        </div>
      </div>
    </Dialog>
  );
}
