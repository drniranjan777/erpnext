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
import { formatDate, todayIST, type DocumentStatus } from "@/lib/documents";
import { QMS, RISK_TONE, type RiskLevel } from "@/lib/qms";

interface Row { id: string; number: string | null; status: DocumentStatus; docDate: string; title: string | null; kind: string; category: string; rpn: number; riskLevel: RiskLevel; validUntil: string | null; closedAt: string | null; productImpact: boolean }

export default function DeviationsPage() {
  const { can } = useAuth();
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [QMS, "deviations", kind, open, search], queryFn: () => api<{ items: Row[] }>(`${QMS}/deviations`, { query: { kind: kind || undefined, open: open ? "true" : undefined, q: search || undefined } }) });
  const today = todayIST();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Deviations"
        description="Departures from an approved procedure or specification: planned ones approved in advance for a limited time, unplanned ones found after the fact. Each is risk-rated (severity × occurrence × detection) and approved by QA."
        actions={can("quality.deviations.manage") && <Link href="/quality/deviations/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> New deviation</Link>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-64" placeholder="Number, description or batch" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="h-9 w-40" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All kinds</option><option value="planned">Planned</option><option value="unplanned">Unplanned</option></Select>
        <Checkbox label="Open only" checked={open} onChange={(e) => setOpen(e.target.checked)} />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Deviation</th><th className="px-4 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">Risk</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><Link href={`/quality/deviations/${r.id}`} className="font-medium hover:underline">{r.number ?? "Draft"}</Link><span className="block text-xs text-muted">{formatDate(r.docDate)} · {r.kind}{r.validUntil && ` until ${formatDate(r.validUntil)}`}</span></td>
                  <td className="px-4 py-2">{r.title}{r.productImpact && <Badge tone="warning" className="ml-2">Product impact</Badge>}</td>
                  <td className="px-4 py-2"><Badge tone={RISK_TONE[r.riskLevel]}>{r.riskLevel} · {r.rpn}</Badge></td>
                  <td className="px-4 py-2">{r.closedAt ? <Badge tone="success">Closed</Badge> : r.validUntil && r.validUntil < today && r.status === "approved" ? <Badge tone="danger">Expired</Badge> : <StatusBadge status={r.status} />}</td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">No deviations.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
