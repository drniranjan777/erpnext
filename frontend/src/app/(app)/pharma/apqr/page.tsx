"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";

type Rec = Record<string, unknown>;
interface Apqr { item: string; from: string; to: string; batches: { count: number; completed: number; rejectedReviews: number; list: { number: string | null; qty: number; produced: number; stage: string; review: string | null; date: string }[] }; yieldPct: { mean: number; min: number; max: number } | null; deviations: Rec[]; capas: Rec[]; complaints: Rec[]; ncrs: Rec[]; inspections: { result: string; n: number }[]; changes: Rec[]; stability: { code: string; batchNo: string; kind: string; condition: string; status: string; oos: number; supportedShelfLifeMonths: number | null; claimed: number | null }[] }

/** Annual product quality review: batches, yields, deviations, CAPAs, complaints, changes and stability in one report. */
export default function ApqrPage() {
  const [item, setItem] = useState<{ id: string; label: string } | null>(null);
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year - 1}-04-01`);
  const [to, setTo] = useState(`${year}-03-31`);
  const [run, setRun] = useState(0);
  const q = useQuery({ queryKey: ["/pharma/apqr", item?.id, from, to, run], queryFn: () => api<Apqr>("/pharma/apqr", { query: { itemId: item!.id, from, to } }), enabled: !!item && run > 0 });
  const r = q.data;
  const list = (title: string, rows: Rec[], f: (x: Rec) => string) => (
    <Card>
      <CardHeader title={`${title} (${rows.length})`} />
      <ul className="divide-y divide-border border-t border-border text-sm">{rows.map((x, i) => <li key={i} className="px-4 py-1.5">{f(x)}</li>)}{!rows.length && <li className="px-4 py-3 text-muted">None.</li>}</ul>
    </Card>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Annual product quality review" description="Everything the APQR needs for one product over a period, from the system's records. Print the page for the review file." actions={r && <Button variant="ghost" onClick={() => window.print()}>Print</Button>} />
      <Card className="flex flex-wrap items-center gap-2 p-4 print:hidden">
        <div className="min-w-64 flex-1">{item ? <p>{item.label} <button type="button" className="ml-2 text-xs text-primary" onClick={() => setItem(null)}>change</button></p> : <ItemPicker placeholder="Product" onPick={(i) => setItem({ id: i.id, label: `${i.code} · ${i.name}` })} />}</div>
        <Input className="h-9 w-40" type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input className="h-9 w-40" type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button disabled={!item} onClick={() => setRun(run + 1)}>Compile</Button>
      </Card>
      {r && (
        <>
          <Card className="p-4">
            <h2 className="text-lg font-semibold">{r.item}</h2>
            <p className="text-sm text-muted">{r.from} to {r.to}</p>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-muted">Batches</p><p className="text-xl font-semibold">{r.batches.count}</p><p className="text-xs">{r.batches.completed} completed</p></div>
              <div><p className="text-muted">Yield</p><p className="text-xl font-semibold">{r.yieldPct ? `${r.yieldPct.mean} %` : "–"}</p>{r.yieldPct && <p className="text-xs">{r.yieldPct.min}–{r.yieldPct.max} %</p>}</div>
              <div><p className="text-muted">Batch records rejected</p><p className="text-xl font-semibold">{r.batches.rejectedReviews}</p></div>
              <div><p className="text-muted">Inspections</p><p className="text-xs">{r.inspections.map((i) => `${i.result} ${i.n}`).join(" · ") || "–"}</p></div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Batches" />
            <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm"><tbody className="divide-y divide-border">{r.batches.list.map((b, i) => <tr key={i}><td className="px-4 py-1.5">{b.number}</td><td className="px-4 py-1.5">{b.date}</td><td className="px-4 py-1.5 text-right">{b.produced} of {b.qty}</td><td className="px-4 py-1.5">{b.stage}</td><td className="px-4 py-1.5">{b.review ?? "not reviewed"}</td></tr>)}</tbody></table></div>
          </Card>
          {list("Deviations", r.deviations, (x) => `${x.number ?? ""} · ${x.kind} · ${x.category}: ${x.description}${x.closed ? " (closed)" : ""}`)}
          {list("CAPAs", r.capas, (x) => `${x.number ?? ""} · ${x.kind}: ${x.problem} (${x.status})`)}
          {list("Complaints", r.complaints, (x) => `${x.number ?? ""} · ${x.category}: ${x.description}`)}
          {list("Non-conformances", r.ncrs, (x) => `${x.number ?? ""}: ${x.description} (${x.qty})`)}
          {list("Changes", r.changes, (x) => `${x.number ?? ""} · ${x.kind}: ${x.reason}`)}
          <Card>
            <CardHeader title="Stability" />
            <ul className="divide-y divide-border border-t border-border text-sm">{r.stability.map((s) => <li key={s.code} className="px-4 py-1.5">{s.code} · batch {s.batchNo} · {s.condition} · {s.status}: {s.oos} OOS; supports {s.supportedShelfLifeMonths ?? "–"} months{s.claimed ? ` (claimed ${s.claimed})` : ""}</li>)}{!r.stability.length && <li className="px-4 py-3 text-muted">No studies.</li>}</ul>
          </Card>
        </>
      )}
    </div>
  );
}
