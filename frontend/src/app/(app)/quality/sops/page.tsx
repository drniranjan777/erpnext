"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, type DocumentStatus } from "@/lib/documents";
import { QMS } from "@/lib/qms";
import { DataTable } from "@/components/ui/data-table";

interface Row { id: string; sopCode: string; sopVersion: number; title: string; department: string | null; effectiveDate: string | null; reviewDue: string | null; supersededAt: string | null; status: DocumentStatus; trainees: number; acknowledged: number; reviewDueSoon: boolean }

export default function SopsPage() {
  const { can } = useAuth();
  const [current, setCurrent] = useState(true);
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [QMS, "sops", current, search], queryFn: () => api<Row[]>(`${QMS}/sops`, { query: { current: current ? "true" : undefined, q: search || undefined } }) });
  const pending = useQuery({ queryKey: [QMS, "sops", "pending"], queryFn: () => api<{ id: string; sopCode: string; sopVersion: number; title: string }[]>(`${QMS}/sops/pending`) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="SOPs"
        description="Standard operating procedures: versioned, released through approval, with a training list. Everyone on the list acknowledges each new version."
        actions={can("quality.sops.manage") && <Link href="/quality/sops/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> New SOP</Link>}
      />
      {!!pending.data?.length && (
        <Alert tone="warning">
          You have {pending.data.length} SOP{pending.data.length === 1 ? "" : "s"} to read: {pending.data.map((p) => <Link key={p.id} className="mr-2 underline" href={`/quality/sops/${p.id}`}>{p.sopCode} v{p.sopVersion}</Link>)}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-64" placeholder="Code or title" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Checkbox label="Current versions only" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            rows={q.data}
            rowKey={(r) => String(r.id)}
            exportName="quality-sops"
            storageKey="quality-sops-0"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No SOPs.</p>}
            columns={[
              { key: "sop", label: "SOP", locked: true, className: "whitespace-normal", render: (r) => <><Link href={`/quality/sops/${r.id}`} className="font-mono font-medium hover:underline">{r.sopCode}</Link> <span className="text-xs text-muted">v{r.sopVersion}</span><span className="block">{r.title}</span></> },
              { key: "effective", label: "Effective", className: "whitespace-normal", render: (r) => <>{r.effectiveDate ? formatDate(r.effectiveDate) : "–"}</> },
              { key: "review-by", label: "Review by", className: "whitespace-normal", render: (r) => <>{r.reviewDue ? formatDate(r.reviewDue) : "–"}{r.reviewDueSoon && <Badge tone="warning" className="ml-2">Review due</Badge>}</> },
              { key: "trained", label: "Trained", className: "whitespace-normal", render: (r) => <>{r.trainees ? `${r.acknowledged} / ${r.trainees}` : "–"}</> },
              { key: "status", label: "Status", className: "whitespace-normal", render: (r) => <>{r.supersededAt ? <Badge>Superseded</Badge> : <StatusBadge status={r.status} />}</> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
