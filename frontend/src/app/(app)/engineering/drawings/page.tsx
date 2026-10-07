"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, type DocumentStatus } from "@/lib/documents";
import { ENG } from "@/lib/engineering";

interface Row { id: string; status: DocumentStatus; drawingNo: string; revision: string; title: string; sheetSize: string | null; releasedAt: string | null; supersededAt: string | null; item: { id: string; code: string; name: string } | null }

export default function DrawingsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [current, setCurrent] = useState(true);
  const q = useQuery({ queryKey: [ENG, "drawings", search, current], queryFn: () => api<{ items: Row[] }>(`${ENG}/drawings`, { query: { q: search || undefined, current: current ? "true" : undefined, limit: 100 } }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Drawing register"
        description="Every drawing and its revisions. Approving a revision releases it, supersedes the one before and puts its number and revision on the item's BOM."
        actions={can("manufacturing.engineering.manage") && <Link href={`${ENG}/drawings/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> New drawing</Link>}
      />
      <div className="flex flex-wrap items-center gap-4">
        <Input className="h-9 w-64" placeholder="Number, title or item" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Checkbox label="Current revisions only" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Drawing</th><th className="px-4 py-2 font-medium">Rev</th><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">Released</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><Link href={`${ENG}/drawings/${r.id}`} className="font-mono font-medium hover:underline">{r.drawingNo}</Link><span className="block text-xs text-muted">{r.title}{r.sheetSize ? ` · ${r.sheetSize}` : ""}</span></td>
                  <td className="px-4 py-2 font-mono">{r.revision}</td>
                  <td className="px-4 py-2">{r.item ? <><span className="font-mono text-xs text-muted">{r.item.code}</span> {r.item.name}</> : "–"}</td>
                  <td className="px-4 py-2">{r.releasedAt ? formatDate(r.releasedAt.slice(0, 10)) : "–"}</td>
                  <td className="px-4 py-2">{r.supersededAt ? <Badge>Superseded</Badge> : <StatusBadge status={r.status} />}</td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No drawings.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
