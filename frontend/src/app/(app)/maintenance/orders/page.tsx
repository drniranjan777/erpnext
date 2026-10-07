"use client";

import { useQuery } from "@tanstack/react-query";
import { Siren } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, type DocumentStatus } from "@/lib/documents";
import { KIND, MT, STAGE, hours } from "@/lib/maintenance";

interface Row { id: string; number: string | null; status: DocumentStatus; kind: keyof typeof KIND; problem: string; priority: string; stage: keyof typeof STAGE; machineDown: boolean; reportedAt: string; plannedDate: string | null; assignedTo: string | null; downtimeMinutes: number | null; totalCost: string; asset: { id: string; code: string; name: string } | null; tool: { id: string; code: string; name: string } | null }

export default function MaintenanceOrdersPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [MT, "orders", open, kind, search], queryFn: () => api<{ items: Row[] }>(`${MT}/orders`, { query: { open: open ? "true" : undefined, kind: kind || undefined, q: search || undefined } }), refetchInterval: 60_000 });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Maintenance orders"
        description="Breakdowns, preventive and corrective jobs: reported, started, completed with findings, labour and spares, then signed off. Sign-off issues the spares and fixes the cost and downtime."
        actions={can("maintenance.requests.create") && <Link href={`${MT}/orders/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-danger px-4 text-sm font-medium text-white hover:opacity-90"><Siren className="size-4" aria-hidden /> Report a breakdown</Link>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-64" placeholder="Number or problem" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="h-9 w-44" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All kinds</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Checkbox label="Open only" checked={open} onChange={(e) => setOpen(e.target.checked)} />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Order</th><th className="px-4 py-2 font-medium">Asset</th><th className="px-4 py-2 font-medium">Problem</th><th className="px-4 py-2 font-medium">Downtime · cost</th><th className="px-4 py-2 font-medium">Stage</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => (
                <tr key={r.id} className={r.machineDown && r.status === "draft" ? "bg-danger-soft/40" : undefined}>
                  <td className="px-4 py-2"><Link href={`${MT}/orders/${r.id}`} className="font-medium hover:underline">{r.number ?? "Request"}</Link><span className="block text-xs text-muted">{KIND[r.kind]} · {formatDateTime(r.reportedAt)}</span></td>
                  <td className="px-4 py-2">{r.asset ? <><span className="font-mono text-xs">{r.asset.code}</span> {r.asset.name}</> : r.tool ? <><span className="font-mono text-xs">{r.tool.code}</span> {r.tool.name}</> : "–"}</td>
                  <td className="px-4 py-2">{r.problem}{r.priority === "urgent" || r.priority === "high" ? <Badge tone="danger" className="ml-2">{r.priority}</Badge> : null}{r.assignedTo && <span className="block text-xs text-muted">{r.assignedTo}</span>}</td>
                  <td className="px-4 py-2">{hours(r.downtimeMinutes)}{Number(r.totalCost) > 0 && <span className="block text-xs text-muted">{formatMoney(r.totalCost)}</span>}</td>
                  <td className="px-4 py-2">{r.status === "draft" ? <Badge tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Badge> : <StatusBadge status={r.status} />}{r.machineDown && r.status === "draft" && <Badge tone="danger" className="ml-1">Machine down</Badge>}</td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">Nothing here.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
