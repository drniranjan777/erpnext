"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/documents";

interface Why { metric: string; answer: string; current: { label: string }; previous: { label: string }; bridge: { effects: Record<string, number>; previousPct: number; currentPct: number } | null }
interface Collections { buckets: { week: number; from: string; to: string; amount: number; invoices: number }[]; later: number; total: number; overallDelay: number; paidInvoicesLearned: number; rows: { id: string; number: string; customer: string; dueDate: string; expected: string; outstanding: number; typicalDelay: number; basis: string; atRisk: boolean }[] }
interface Price { itemId: string; code: string; name: string; lastRate: number; changePct: number | null; method: string; forecast: { period: string; rate: number; low?: number; high?: number }[] }

const EXAMPLES = ["Why did margin drop this month?", "Why are sales down last month?", "Why did margin fall in Q2?"];

export default function InsightsPage() {
  const { can } = useAuth();
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState<Why | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const col = useQuery({ queryKey: ["/insights/collections"], queryFn: () => api<Collections>("/insights/collections", { query: { weeks: 8 } }), enabled: can("sales.invoices.read") });
  const prices = useQuery({ queryKey: ["/insights/prices"], queryFn: () => api<Price[]>("/insights/prices"), enabled: can("purchase.orders.read") });
  async function ask(q: string) {
    setQuestion(q);
    setError(null);
    setBusy(true);
    try {
      setWhy(await api<Why>("/insights/why", { body: { question: q } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  const maxWeek = Math.max(1, ...(col.data?.buckets.map((b) => b.amount) ?? [1]));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Predictions and why" description="Ask why sales or margin moved, see when customers are likely to pay, and where purchase prices are heading. Demand forecasts are under Planning." actions={<Link className="text-sm text-primary hover:underline" href="/planning/forecast">Demand forecasts</Link>} />
      <Card>
        <CardHeader title="Ask why" description="Margin is split into selling-price, cost and product-mix effects; sales into price, volume and new or lost items." />
        <form className="flex gap-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask(question.trim()); }}>
          <Input className="h-10 flex-1" placeholder="Why did margin drop in Q2?" aria-label="Question" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Button type="submit" loading={busy}><Sparkles className="size-4" aria-hidden /> Ask</Button>
        </form>
        <div className="flex flex-wrap gap-2 px-4 pb-3">{EXAMPLES.map((e) => <button key={e} type="button" className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-surface-muted" onClick={() => ask(e)}>{e}</button>)}</div>
        {error && <div className="px-4 pb-4"><Alert>{error}</Alert></div>}
        {why && (
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <p className="font-medium">{why.answer}</p>
            {why.bridge && (
              <div className="flex flex-wrap gap-2">{Object.entries(why.bridge.effects).map(([k, v]) => <Badge key={k} tone={v < 0 ? "danger" : v > 0 ? "success" : "neutral"}>{k}: {v > 0 ? "+" : ""}{v} pts</Badge>)}</div>
            )}
            <p className="text-xs text-muted">{why.previous.label} → {why.current.label}</p>
          </div>
        )}
      </Card>
      {col.data && (
        <Card>
          <CardHeader title="Expected collections" description={`From ${col.data.paidInvoicesLearned} paid invoices: customers usually pay ${col.data.overallDelay} days after the due date. ${formatMoney(col.data.total)} is outstanding.`} />
          <div className="grid grid-cols-8 items-end gap-2 border-t border-border p-4" style={{ height: 160 }}>
            {col.data.buckets.map((b) => (
              <div key={b.week} className="flex h-full flex-col justify-end text-center text-[10px]" title={`${formatDate(b.from)}–${formatDate(b.to)}: ${formatMoney(b.amount)} from ${b.invoices} invoice(s)`}>
                <span className="mb-1 tabular-nums">{b.amount ? `${Math.round(b.amount / 1000)}k` : ""}</span>
                <div className="rounded-t bg-primary" style={{ height: `${(b.amount / maxWeek) * 100}%`, minHeight: b.amount ? 2 : 0 }} />
                <span className="mt-1 text-muted">W{b.week}</span>
              </div>
            ))}
          </div>
          <ul className="max-h-64 divide-y divide-border overflow-auto border-t border-border text-sm">
            {col.data.rows.slice(0, 30).map((r) => (
              <li key={r.id} className="flex flex-wrap gap-3 px-5 py-1.5">
                <span className="font-mono text-xs">{r.number}</span>
                <span>{r.customer}</span>
                <span className="text-xs text-muted">due {formatDate(r.dueDate)} · expected {formatDate(r.expected)} ({r.basis === "customer" ? `pays ~${r.typicalDelay} days late` : "typical"})</span>
                {r.atRisk && <Badge tone="danger">at risk</Badge>}
                <span className="ml-auto tabular-nums">{formatMoney(r.outstanding)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {prices.data && (
        <Card>
          <CardHeader title="Purchase price outlook" description="Monthly average price paid for the biggest-spend items, with the next three months forecast (80 % range)." />
          <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 text-right font-medium">Last</th><th className="px-4 py-2 font-medium">Next months</th><th className="px-4 py-2 text-right font-medium">Change</th></tr></thead>
            <tbody className="divide-y divide-border">
              {prices.data.map((p) => (
                <tr key={p.itemId}>
                  <td className="px-4 py-2">{p.code} · {p.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.lastRate)}</td>
                  <td className="px-4 py-2 text-xs">{p.forecast.map((f) => `${f.period}: ${formatMoney(f.rate)}`).join(" · ")}</td>
                  <td className="px-4 py-2 text-right">{p.changePct === null ? "–" : <Badge tone={p.changePct > 3 ? "danger" : p.changePct < -3 ? "success" : "neutral"}>{p.changePct > 0 ? "+" : ""}{p.changePct} %</Badge>}</td>
                </tr>
              ))}
              {!prices.data.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">Needs purchase orders in at least two months.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
