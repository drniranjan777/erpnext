"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatMoney, todayIST } from "@/lib/documents";
import { NCR_SOURCE, QA, type NcrSource } from "@/lib/quality";

interface Row { key: string; count: number; copq: string | null; scrap: string | null; rework: string | null; other: string | null; recovered: string | null }
interface Copq { from: string; to: string; totals: Row; byMonth: Row[]; byCategory: Row[]; bySource: Row[]; byParty: Row[] }

function Breakdown({ title, rows, label }: { title: string; rows: Row[]; label?: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.copq) || 0));
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-border border-t border-border text-sm">
        {rows.map((r) => (
          <li key={r.key} className="px-5 py-2">
            <div className="flex justify-between gap-3"><span>{label ? label(r.key) : r.key} <span className="text-xs text-muted">· {r.count} NCR{r.count === 1 ? "" : "s"}</span></span><span className="tabular-nums">{formatMoney(r.copq ?? "0")}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-muted"><div className="h-full rounded-full bg-danger" style={{ width: `${((Number(r.copq) || 0) / max) * 100}%` }} /></div>
          </li>
        ))}
        {!rows.length && <li className="px-5 py-4 text-center text-muted">Nothing in this period.</li>}
      </ul>
    </Card>
  );
}

export default function CopqPage() {
  const to0 = todayIST();
  const [range, setRange] = useState({ from: `${Number(to0.slice(0, 4)) - (Number(to0.slice(5, 7)) < 4 ? 1 : 0)}-04-01`, to: to0 });
  const q = useQuery({ queryKey: [QA, "copq", range], queryFn: () => api<Copq>(`${QA}/copq`, { query: range }) });
  const t = q.data?.totals;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Cost of poor quality" description="From approved non-conformance reports: scrap at stock value, rework, sorting and other costs, less what was recovered from vendors." />
      <Card className="flex flex-wrap gap-4 p-4">
        <Field label="From">{(p) => <Input {...p} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
        <Field label="To">{(p) => <Input {...p} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
      </Card>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {t && (
        <div className="grid gap-3 sm:grid-cols-5">
          {[
            ["Cost of poor quality", t.copq],
            ["Scrap", t.scrap],
            ["Rework", t.rework],
            ["Sorting and other", t.other],
            ["Recovered", t.recovered],
          ].map(([l, v]) => (
            <Card key={l} className="p-4"><p className="text-xs uppercase tracking-wide text-muted">{l}</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(v ?? "0")}</p></Card>
          ))}
        </div>
      )}
      {q.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown title="By defect" rows={q.data.byCategory} />
          <Breakdown title="By vendor / customer" rows={q.data.byParty} />
          <Breakdown title="Where found" rows={q.data.bySource} label={(k) => NCR_SOURCE[k as NcrSource] ?? k} />
          <Breakdown title="By month" rows={q.data.byMonth} label={(k) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} />
        </div>
      )}
    </div>
  );
}
