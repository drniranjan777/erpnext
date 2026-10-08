"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

interface Row { id: string; code: string; name: string; customer: string | null; contractValue: number; startDate: string; endDate: string; status: string; bac: number; ac: number; cpi: number | null; spi: number | null; percentComplete: number; billed: number }

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const tone = (x: number | null) => (x === null ? "neutral" : x >= 1 ? "success" : x >= 0.9 ? "warning" : "danger");

/** Projects with cost and schedule performance. */
export default function ProjectsPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/projects"], queryFn: () => api<Row[]>("/projects") });
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader title="Projects" description="Engineer-to-order and EPC projects: WBS with budgets, costs charged from purchasing, stores and time sheets, milestone billing, and earned value (CPI below 1 is over cost, SPI below 1 is behind schedule)." actions={<span className="flex gap-2"><Link className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-muted" href="/projects/resources">Resource load</Link>{can("projects.plan.manage") && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New project</Button>}</span>} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-muted text-left text-xs text-muted"><tr><th className="px-3 py-2">Project</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Contract</th><th className="px-3 py-2 text-right">Budget</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Billed</th><th className="px-3 py-2 text-right">Done</th><th className="px-3 py-2">CPI / SPI</th><th className="px-3 py-2">End</th></tr></thead>
          <tbody className="divide-y divide-border">
            {list.data?.map((r) => (
              <tr key={r.id} className="hover:bg-surface-muted">
                <td className="px-3 py-2"><Link className="font-medium text-primary hover:underline" href={`/projects/${r.id}`}>{r.code}</Link> {r.name} <Badge>{r.status}</Badge></td>
                <td className="px-3 py-2">{r.customer ?? ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(r.contractValue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(r.bac)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(r.ac)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(r.billed)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.percentComplete} %</td>
                <td className="px-3 py-2"><Badge tone={tone(r.cpi)}>{r.cpi ?? "–"}</Badge> <Badge tone={tone(r.spi)}>{r.spi ?? "–"}</Badge></td>
                <td className="px-3 py-2">{formatDate(r.endDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !list.data.length && <p className="p-8 text-center text-muted">No projects.</p>}
      </Card>
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProject({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedParty | null>(null);
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const [f, setF] = useState({ code: "", name: "", contractValue: "", startDate: "", endDate: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const r = await api<{ id: string }>("/projects", { body: { code: f.code, name: f.name, customerId: customer?.id ?? null, contractValue: Number(f.contractValue || 0), billingItemId: item?.id ?? null, startDate: f.startDate, endDate: f.endDate } });
      router.push(`/projects/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New project" footer={<Button disabled={!f.code || f.name.length < 2 || !f.startDate || !f.endDate} onClick={save}>Create</Button>}>
      <div className="space-y-2 text-sm">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Code" placeholder="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <PartyPicker role="customer" value={customer} onChange={setCustomer} />
        {item ? <p>Billing item: {item.label}</p> : <ItemPicker placeholder="Service item for milestone invoices" onPick={(i) => setItem({ id: i.id, label: `${i.code} · ${i.name}` })} />}
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Contract value" type="number" min={0} placeholder="Contract value ₹" value={f.contractValue} onChange={(e) => setF({ ...f, contractValue: e.target.value })} />
          <label className="text-xs text-muted">Start<Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="text-xs text-muted">End<Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
        </div>
      </div>
    </Dialog>
  );
}
