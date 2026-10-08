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
import { DataTable } from "@/components/ui/data-table";

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
        <DataTable
          rows={list.data ?? []}
          rowKey={(r) => String(r.id)}
          exportName="projects"
          storageKey="projects-0"
          columns={[
            { key: "project", label: "Project", locked: true, className: "whitespace-normal", render: (r) => <><Link className="font-medium text-primary hover:underline" href={`/projects/${r.id}`}>{r.code}</Link> {r.name} <Badge>{r.status}</Badge></> },
            { key: "customer", label: "Customer", className: "whitespace-normal", render: (r) => <>{r.customer ?? ""}</> },
            { key: "contract", label: "Contract", align: "right", render: (r) => <>{inr(r.contractValue)}</> },
            { key: "budget", label: "Budget", align: "right", render: (r) => <>{inr(r.bac)}</> },
            { key: "actual", label: "Actual", align: "right", render: (r) => <>{inr(r.ac)}</> },
            { key: "billed", label: "Billed", align: "right", render: (r) => <>{inr(r.billed)}</> },
            { key: "done", label: "Done", align: "right", render: (r) => <>{r.percentComplete} %</> },
            { key: "cpi-spi", label: "CPI / SPI", className: "whitespace-normal", render: (r) => <><Badge tone={tone(r.cpi)}>{r.cpi ?? "–"}</Badge> <Badge tone={tone(r.spi)}>{r.spi ?? "–"}</Badge></> },
            { key: "end", label: "End", className: "whitespace-normal", render: (r) => <>{formatDate(r.endDate)}</> },
          ]}
        />
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
