"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, type DocumentStatus } from "@/lib/documents";
import { CAPA_STAGE, QA } from "@/lib/quality";

interface Row { id: string; number: string | null; status: DocumentStatus; docDate: string; title: string | null; kind: string; source: string; isScar: boolean; stage: keyof typeof CAPA_STAGE; responseDue: string | null; effectivenessDue: string | null; party: string | null; openActions: number; overdueActions: number }

export default function CapasPage() {
  const { can } = useAuth();
  const [stage, setStage] = useState("");
  const [scar, setScar] = useState(false);
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [QA, "capas", stage, scar, search], queryFn: () => api<{ items: Row[] }>(`${QA}/capas`, { query: { stage: stage || undefined, scar: scar ? "true" : undefined, q: search || undefined } }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="CAPA"
        description="Corrective and preventive actions, and supplier corrective action requests: root cause by 5-Why, fishbone or 8D, actions with owners and dates, and an effectiveness check before closing."
        actions={can("quality.capa.manage") && <Link href={`${QA}/capas/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> New CAPA</Link>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-64" placeholder="Number or problem" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="h-9 w-48" aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">All stages</option>
          {Object.entries(CAPA_STAGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Checkbox label="SCARs only" checked={scar} onChange={(e) => setScar(e.target.checked)} />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">CAPA</th><th className="px-4 py-2 font-medium">Problem</th><th className="px-4 py-2 font-medium">Actions</th><th className="px-4 py-2 font-medium">Stage</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><Link href={`${QA}/capas/${r.id}`} className="font-medium hover:underline">{r.number ?? "Draft"}</Link><span className="block text-xs text-muted">{formatDate(r.docDate)} · {r.isScar ? `SCAR to ${r.party}` : r.source}</span></td>
                  <td className="px-4 py-2">{r.title}</td>
                  <td className="px-4 py-2">{r.openActions ? `${r.openActions} open` : "–"}{r.overdueActions > 0 && <Badge tone="danger" className="ml-2">{r.overdueActions} overdue</Badge>}</td>
                  <td className="px-4 py-2">{r.status === "approved" ? <Badge tone={CAPA_STAGE[r.stage].tone}>{CAPA_STAGE[r.stage].label}</Badge> : <StatusBadge status={r.status} />}</td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">No CAPAs.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
