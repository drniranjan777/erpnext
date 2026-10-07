"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, type DocumentStatus } from "@/lib/documents";
import { CHANGE_KIND, ENG, STAGE, type ChangeKind } from "@/lib/engineering";

interface Row { id: string; number: string | null; status: DocumentStatus; docDate: string; title: string | null; kind: ChangeKind; priority: string; stage: keyof typeof STAGE; effectiveDate: string | null; items: number }

export default function ChangesPage() {
  const { can } = useAuth();
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [ENG, "changes", stage, search], queryFn: () => api<{ items: Row[] }>(`${ENG}/changes`, { query: { stage: stage || undefined, q: search || undefined } }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Engineering changes"
        description="Change requests for BOMs, formulas, drawings and routings. Approval turns a request into a change notice, with its impact on stock and open orders recorded; it is implemented once the new versions are approved."
        actions={can("manufacturing.engineering.manage") && <Link href={`${ENG}/changes/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> New change</Link>}
      />
      <div className="flex flex-wrap gap-3">
        <Input className="h-9 w-64" placeholder="Search number or item" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="h-9 w-48" aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">All stages</option>
          {Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Change</th><th className="px-4 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">Stage</th><th className="px-4 py-2 font-medium">Effective</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><Link href={`${ENG}/changes/${r.id}`} className="font-medium hover:underline">{r.number ?? "Draft"}</Link><span className="block text-xs text-muted">{formatDate(r.docDate)} · {r.title}</span></td>
                  <td className="px-4 py-2">{CHANGE_KIND[r.kind]}<span className="block text-xs text-muted">{r.items} item{r.items === 1 ? "" : "s"}{r.priority !== "normal" ? ` · ${r.priority}` : ""}</span></td>
                  <td className="px-4 py-2"><Badge tone={STAGE[r.stage].tone}>{STAGE[r.stage].label}</Badge></td>
                  <td className="px-4 py-2">{r.effectiveDate ? formatDate(r.effectiveDate) : "–"}</td>
                  <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No engineering changes.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
