"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ACC } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/documents";

interface Anomalies {
  from: string;
  to: string;
  reviewed: number;
  journals: { voucherId: string; number: string | null; postingDate: string; createdAt: string; createdBy: string | null; accountCode: string; accountName: string; amount: number; reasons: string[]; score: number }[];
  cashPayments: { voucherId: string; number: string | null; date: string; party: string | null; amount: string; reason: string }[];
}
interface Forecast { opening: string; weeks: { week: number; from: string; inflow: string; outflow: string; closing: string }[]; beyond: { inflow: string; outflow: string }; lowest: { week: number; closing: string }; note: string }

export default function InsightsPage() {
  const a = useQuery({ queryKey: [ACC, "anomalies"], queryFn: () => api<Anomalies>(`${ACC}/anomalies`) });
  const f = useQuery({ queryKey: [ACC, "forecast"], queryFn: () => api<Forecast>(`${ACC}/cash-forecast`, { query: { weeks: 13 } }) });
  const max = Math.max(1, ...(f.data?.weeks ?? []).map((w) => Math.abs(Number(w.closing))));
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Finance insights" description="Journals worth a second look, and a 13-week cash forecast from open bills." />
      <Card>
        <CardHeader title="Cash forecast" description={f.data?.note} />
        {f.isLoading && <LoadingBlock />}
        {f.error && <div className="p-5"><ErrorBlock error={f.error} /></div>}
        {f.data && (
          <div className="overflow-x-auto border-t border-border">
            <p className="px-5 py-3 text-sm">Bank and cash today: <strong className="tabular-nums">{formatMoney(f.data.opening)}</strong> · lowest point: week {f.data.lowest.week} at <strong className={`tabular-nums ${Number(f.data.lowest.closing) < 0 ? "text-danger" : ""}`}>{formatMoney(f.data.lowest.closing)}</strong></p>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Week of</th><th className="px-4 py-2 text-right font-medium">Receipts</th><th className="px-4 py-2 text-right font-medium">Payments</th><th className="px-4 py-2 text-right font-medium">Closing</th><th className="w-1/3 px-4 py-2" /></tr></thead>
              <tbody className="divide-y divide-border">
                {f.data.weeks.map((w) => (
                  <tr key={w.week}>
                    <td className="px-4 py-1.5">{formatDate(w.from)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{Number(w.inflow) ? formatMoney(w.inflow) : "—"}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{Number(w.outflow) ? formatMoney(w.outflow) : "—"}</td>
                    <td className={`px-4 py-1.5 text-right tabular-nums ${Number(w.closing) < 0 ? "text-danger" : ""}`}>{formatMoney(w.closing)}</td>
                    <td className="px-4 py-1.5"><div className={`h-2 rounded ${Number(w.closing) < 0 ? "bg-danger" : "bg-primary/70"}`} style={{ width: `${(Math.abs(Number(w.closing)) / max) * 100}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(Number(f.data.beyond.inflow) > 0 || Number(f.data.beyond.outflow) > 0) && <p className="px-5 py-2 text-xs text-muted">Later than 13 weeks: receipts {formatMoney(f.data.beyond.inflow)}, payments {formatMoney(f.data.beyond.outflow)}.</p>}
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Journals to review" description={a.data ? `${a.data.reviewed} manual journal lines from ${formatDate(a.data.from)} to ${formatDate(a.data.to)}` : undefined} />
        {a.isLoading && <LoadingBlock />}
        {a.data && !a.data.journals.length && <EmptyState title="Nothing unusual" description="No manual journal stood out." />}
        <ul className="divide-y divide-border border-t border-border text-sm">
          {a.data?.journals.map((j, i) => (
            <li key={`${j.voucherId}${i}`} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <Link href={`${ACC}/journals/${j.voucherId}`} className="font-mono text-primary hover:underline">{j.number}</Link>
              <div className="min-w-0 flex-1">
                <p>{j.accountCode} {j.accountName} · <span className="tabular-nums">{formatMoney(j.amount)}</span></p>
                <p className="text-xs text-muted">Dated {formatDate(j.postingDate)} · entered {formatDateTime(j.createdAt)}{j.createdBy && ` by ${j.createdBy}`}</p>
                <div className="mt-1 flex flex-wrap gap-1">{j.reasons.map((r) => <Badge key={r} tone="warning">{r}</Badge>)}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {!!a.data?.cashPayments.length && (
        <Card>
          <CardHeader title="Cash payments above ₹10,000" description="Not deductible under s.40A(3) unless an exception applies." />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {a.data.cashPayments.map((c) => <li key={c.voucherId} className="flex justify-between gap-3 px-5 py-2"><Link href={`${ACC}/payments/${c.voucherId}`} className="font-mono text-primary hover:underline">{c.number}</Link><span className="text-muted">{formatDate(c.date)} · {c.party ?? "—"}</span><span className="tabular-nums">{formatMoney(c.amount)}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
