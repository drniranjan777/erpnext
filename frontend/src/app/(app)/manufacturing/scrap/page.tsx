"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lightbulb } from "lucide-react";
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/documents";
import { MFG } from "@/lib/manufacturing";

interface Group { key: string; processed: number; rejected: number; cost: number; rate: number }
interface Report {
  period: { from: string; to: string };
  totals: { processed: number; rejected: number; rate: number; cost: number };
  byWorkCenter: Group[];
  byItem: Group[];
  byReason: { reason: string; qty: number; share: number; cumulative: number }[];
  weekly: Group[];
  supplier: { vendor: string; inspected: number; rejected: number; lots: number; rate: number }[];
  alerts: { severity: "warning" | "info"; message: string }[];
}

const n = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function Bars<T extends { key: string }>({ rows, value, label, suffix = "" }: { rows: T[]; value: (r: T) => number; label: (r: T) => React.ReactNode; suffix?: string }) {
  const max = Math.max(1, ...rows.map((r) => value(r)));
  return (
    <ul className="space-y-2 px-5 py-4 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
          <span className="truncate">{label(r)}</span>
          <span className="h-3 rounded-full bg-surface-muted"><span className="block h-3 rounded-full bg-primary" style={{ width: `${(value(r) / max) * 100}%` }} /></span>
          <span className="w-16 text-right tabular-nums">{n(value(r))}{suffix}</span>
        </li>
      ))}
      {!rows.length && <li className="text-muted">Nothing in this period.</li>}
    </ul>
  );
}

export default function ScrapPage() {
  const [range, setRange] = useState({ from: "", to: "" });
  const q = useQuery({ queryKey: [MFG, "scrap", range], queryFn: () => api<Report>(`${MFG}/insights/scrap`, { query: { from: range.from || undefined, to: range.to || undefined } }) });
  const r = q.data;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Scrap and rejects"
        description="Rejects booked on job cards and found at inspection: where, on what and why, and what they cost at standard. Supplier rejects come from incoming inspection."
        actions={
          <div className="flex items-end gap-2">
            <Field label="From">{(p) => <Input {...p} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
            <Field label="To">{(p) => <Input {...p} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
          </div>
        }
      />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {r && (
        <>
          <p className="text-sm text-muted">{formatDate(r.period.from)} – {formatDate(r.period.to)}</p>
          <div className="grid gap-4 sm:grid-cols-4">
            {[
              ["Processed", n(r.totals.processed)],
              ["Rejected", n(r.totals.rejected)],
              ["Reject rate", `${r.totals.rate}%`],
              ["Cost at standard", formatMoney(String(r.totals.cost))],
            ].map(([k, v]) => (
              <Card key={k} className="p-4">
                <p className="text-xs text-muted">{k}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
              </Card>
            ))}
          </div>
          {r.alerts.length > 0 && (
            <Card>
              <CardHeader title="What stands out" />
              <ul className="space-y-2 border-t border-border px-5 py-4 text-sm">
                {r.alerts.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    {a.severity === "warning" ? <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden /> : <Lightbulb className="size-4 shrink-0 text-primary" aria-hidden />}
                    {a.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Reject rate by week" />
              <Bars rows={r.weekly} value={(w: Group) => w.rate} label={(w: Group) => `Week of ${formatDate(w.key)}`} suffix="%" />
            </Card>
            <Card>
              <CardHeader title="Reasons (Pareto)" />
              <ul className="space-y-2 border-t border-border px-5 py-4 text-sm">
                {r.byReason.map((x) => (
                  <li key={x.reason} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
                    <span className="truncate">{x.reason}</span>
                    <span className="h-3 rounded-full bg-surface-muted"><span className="block h-3 rounded-full bg-danger" style={{ width: `${x.share}%` }} /></span>
                    <span className="w-24 text-right tabular-nums">{n(x.qty)} · {x.cumulative}%</span>
                  </li>
                ))}
                {!r.byReason.length && <li className="text-muted">No rejects in this period.</li>}
              </ul>
            </Card>
            <Card>
              <CardHeader title="By work centre" description="Reject rate" />
              <Bars rows={r.byWorkCenter} value={(w: Group) => w.rate} label={(w: Group) => w.key} suffix="%" />
            </Card>
            <Card>
              <CardHeader title="By item" description="Rejected quantity" />
              <Bars rows={r.byItem} value={(w: Group) => w.rejected} label={(w: Group) => w.key} />
            </Card>
          </div>
          {r.supplier.length > 0 && (
            <Card>
              <CardHeader title="Suppliers" description="Incoming inspection" />
              <table className="w-full border-t border-border text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Vendor</th><th className="px-4 py-2 text-right font-medium">Lots</th><th className="px-4 py-2 text-right font-medium">Inspected</th><th className="px-4 py-2 text-right font-medium">Rejected</th><th className="px-4 py-2 text-right font-medium">Rate</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {r.supplier.map((s) => (
                    <tr key={s.vendor}><td className="px-4 py-2">{s.vendor}</td><td className="px-4 py-2 text-right tabular-nums">{s.lots}</td><td className="px-4 py-2 text-right tabular-nums">{n(s.inspected)}</td><td className="px-4 py-2 text-right tabular-nums">{n(s.rejected)}</td><td className={`px-4 py-2 text-right tabular-nums ${s.rate > 5 ? "font-semibold text-danger" : ""}`}>{s.rate}%</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
