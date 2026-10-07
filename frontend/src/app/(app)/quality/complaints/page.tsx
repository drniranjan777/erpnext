"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { COMPLAINT_STAGE, QA } from "@/lib/quality";

interface Row { id: string; number: string | null; receivedOn: string; category: string; severity: string; stage: keyof typeof COMPLAINT_STAGE; responseDue: string | null; isFieldFailure: boolean; customer: string; item: { code: string; name: string } | null }
interface Analysis { totals: { count: number; open: number; overdue: number; fieldFailures: number; warrantyCost: string; avgResponseDays: string | null } }

export default function ComplaintsPage() {
  const { can } = useAuth();
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [QA, "complaints", stage, search], queryFn: () => api<{ items: Row[] }>(`${QA}/complaints`, { query: { stage: stage || undefined, q: search || undefined } }) });
  const an = useQuery({ queryKey: [QA, "complaints", "analysis"], queryFn: () => api<Analysis>(`${QA}/complaints/analysis`) });
  const today = todayIST();
  const t = an.data?.totals;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Customer complaints"
        description="Every complaint from a customer, from receipt to response: raise an NCR for the material and an 8D for the cause, answer within the due date, then close."
        actions={can("quality.complaints.manage") && <Link href={`${QA}/complaints/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> Log complaint</Link>}
      />
      {t && (
        <div className="grid gap-3 sm:grid-cols-5">
          {[
            ["This year", String(t.count)],
            ["Open", String(t.open)],
            ["Response overdue", String(t.overdue)],
            ["Field failures", `${t.fieldFailures} · ${formatMoney(t.warrantyCost)}`],
            ["Avg. days to respond", t.avgResponseDays ?? "–"],
          ].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs uppercase tracking-wide text-muted">{l}</p><p className="mt-1 text-xl font-semibold tabular-nums">{v}</p></Card>)}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Input className="h-9 w-64" placeholder="Number, customer or category" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="h-9 w-48" aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">All</option>
          {Object.entries(COMPLAINT_STAGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Complaint</th><th className="px-4 py-2 font-medium">Customer</th><th className="px-4 py-2 font-medium">What</th><th className="px-4 py-2 font-medium">Respond by</th><th className="px-4 py-2 font-medium">Stage</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => {
                const late = r.responseDue && r.responseDue < today && (r.stage === "open" || r.stage === "investigating");
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2"><Link href={`${QA}/complaints/${r.id}`} className="font-medium hover:underline">{r.number}</Link><span className="block text-xs text-muted">{formatDate(r.receivedOn)}</span></td>
                    <td className="px-4 py-2">{r.customer}</td>
                    <td className="px-4 py-2">{r.category}{r.item && <span className="block text-xs text-muted">{r.item.code} {r.item.name}</span>}{r.isFieldFailure && <Badge tone="danger" className="ml-1">Field failure</Badge>}</td>
                    <td className="px-4 py-2">{r.responseDue ? formatDate(r.responseDue) : "–"}{late && <Badge tone="danger" className="ml-2">Overdue</Badge>}</td>
                    <td className="px-4 py-2"><Badge tone={COMPLAINT_STAGE[r.stage].tone}>{COMPLAINT_STAGE[r.stage].label}</Badge></td>
                  </tr>
                );
              })}
              {!q.data.items.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No complaints.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
