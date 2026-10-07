"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty, type DocumentStatus } from "@/lib/documents";
import { NCR_SOURCE, QA, type NcrSource } from "@/lib/quality";

interface Row { id: string; number: string | null; status: DocumentStatus; docDate: string; source: NcrSource; severity: string; defectCategory: string; qtyAffected: string; batchNo: string | null; copq: string; closedAt: string | null; item: { id: string; code: string; name: string }; party: string | null }

export default function NcrsPage() {
  const { can } = useAuth();
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [QA, "ncrs", source, search], queryFn: () => api<{ items: Row[] }>(`${QA}/ncrs`, { query: { source: source || undefined, q: search || undefined } }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Non-conformance"
        description="What went wrong, how much, and what the material review board decided: use as is, rework, scrap, return or sort. The cost of poor quality is fixed when the MRB approves."
        actions={
          <span className="flex gap-2">
            <Link href={`${QA}/copq`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"><BarChart3 className="size-4" aria-hidden /> Cost of poor quality</Link>
            {can("quality.ncr.manage") && <Link href={`${QA}/ncrs/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> New NCR</Link>}
          </span>
        }
      />
      <div className="flex flex-wrap gap-3">
        <Input className="h-9 w-64" placeholder="Number, item, defect or batch" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="h-9 w-48" aria-label="Found at" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Found anywhere</option>
          {Object.entries(NCR_SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">NCR</th><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">Defect</th><th className="px-4 py-2 text-right font-medium">Qty</th><th className="px-4 py-2 text-right font-medium">COPQ</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><Link href={`${QA}/ncrs/${r.id}`} className="font-medium hover:underline">{r.number ?? "Draft"}</Link><span className="block text-xs text-muted">{formatDate(r.docDate)} · {NCR_SOURCE[r.source]}{r.party ? ` · ${r.party}` : ""}</span></td>
                  <td className="px-4 py-2"><span className="font-mono text-xs text-muted">{r.item.code}</span> {r.item.name}{r.batchNo && <span className="block font-mono text-xs text-muted">{r.batchNo}</span>}</td>
                  <td className="px-4 py-2">{r.defectCategory}{r.severity !== "major" && <Badge tone={r.severity === "critical" ? "danger" : "neutral"} className="ml-2">{r.severity}</Badge>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(r.qtyAffected)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(r.copq) ? formatMoney(r.copq) : "–"}</td>
                  <td className="px-4 py-2">{r.closedAt ? <Badge tone="success">Closed</Badge> : <StatusBadge status={r.status} />}</td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No non-conformance reports.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
