"use client";

import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { ACC } from "@/lib/accounting";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { DataTable } from "@/components/ui/data-table";

interface Ageing {
  labels: string[];
  parties: { partyId: string; name: string; msme: string | null; bills: number; oldestDue: string | null; buckets: string[]; total: string; advance: string; net: string }[];
  totals: { buckets: string[]; total: string; advance: string };
}
interface Interest { bills: { id: string; number: string; party: string; dueDate: string; outstanding: string; days: number; interest: string }[]; total: string }

export default function AgeingPage() {
  const { can } = useAuth();
  const [side, setSide] = useState<"receivable" | "payable">("receivable");
  const [asOf, setAsOf] = useState(todayIST());
  const [buckets, setBuckets] = useState("30,60,90");
  const [rate, setRate] = useState("18");
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const valid = /^\d{1,3}(,\d{1,3}){0,6}$/.test(buckets);
  const q = useQuery({ queryKey: [ACC, "ageing", side, asOf, buckets], queryFn: () => api<Ageing>(`${ACC}/ageing`, { query: { side, asOf, buckets } }), enabled: valid });
  const interest = useQuery({ queryKey: [ACC, "interest", asOf, rate], queryFn: () => api<Interest>(`${ACC}/interest`, { query: { asOf, ratePct: rate } }), enabled: side === "receivable" });
  async function remind() {
    setMsg(null);
    try {
      const r = await api<{ sent: number; skipped: { name: string; reason: string }[] }>(`${ACC}/dunning`, { body: { minDaysOverdue: 1 } });
      setMsg({ tone: r.skipped.length ? "warning" : "success", text: `${r.sent} reminder(s) emailed.${r.skipped.length ? ` Skipped: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.` : ""}` });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    }
  }
  const d = q.data;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={side === "receivable" ? "Receivables ageing" : "Payables ageing"}
        description="Outstanding bills by days past their due date, with advances not yet adjusted."
        actions={side === "receivable" && can("accounting.money.manage") ? <Button variant="secondary" onClick={remind}><Mail className="size-4" aria-hidden /> Email overdue reminders</Button> : undefined}
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-5 py-4">
          <Field label="Show">
            {(f) => (
              <Select {...f} value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
                <option value="receivable">Customers (receivable)</option>
                <option value="payable">Vendors (payable)</option>
              </Select>
            )}
          </Field>
          <Field label="As of">{(f) => <Input {...f} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />}</Field>
          <Field label="Buckets (days)" error={valid ? undefined : "e.g. 30,60,90"}>{(f) => <Input {...f} className="w-36" value={buckets} onChange={(e) => setBuckets(e.target.value.replace(/[^\d,]/g, ""))} />}</Field>
        </div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {d && !d.parties.length && <EmptyState title="Nothing outstanding" />}
        {d && d.parties.length > 0 && (
          <DataTable
            rows={d.parties}
            rowKey={(p) => p.partyId}
            exportName={`ageing-${side}`}
            storageKey="accounting-ageing"
            totals={{ ...Object.fromEntries(d.totals.buckets.map((b, i) => [`b${i}`, formatMoney(b)])), total: formatMoney(d.totals.total), advance: formatMoney(d.totals.advance) }}
            columns={[
              {
                key: "party",
                label: side === "receivable" ? "Customer" : "Vendor",
                locked: true,
                value: (p) => p.name,
                render: (p) => (
                  <>
                    <Link href={`${ACC}/statement/${p.partyId}`} className="font-medium hover:underline">{p.name}</Link>
                    {p.msme && ["micro", "small"].includes(p.msme) && <Badge tone="warning" className="ml-2">MSME {p.msme}</Badge>}
                    <p className="text-xs text-muted">{p.bills} bill(s){p.oldestDue && ` · oldest due ${formatDate(p.oldestDue)}`}</p>
                  </>
                ),
              },
              ...d.labels.map((l, i) => ({
                key: `b${i}`,
                label: l,
                align: "right" as const,
                value: (p: (typeof d.parties)[number]) => Number(p.buckets[i]),
                render: (p: (typeof d.parties)[number]) => <span className={i >= 2 && Number(p.buckets[i]) ? "text-danger" : undefined}>{Number(p.buckets[i]) ? formatMoney(p.buckets[i]) : "—"}</span>,
              })),
              { key: "total", label: "Total", align: "right", className: "font-medium", value: (p) => Number(p.total), render: (p) => formatMoney(p.total) },
              { key: "advance", label: "Advance", align: "right", className: "text-muted", value: (p) => Number(p.advance), render: (p) => (Number(p.advance) ? formatMoney(p.advance) : "—") },
            ]}
          />
        )}
      </Card>
      {side === "receivable" && (
        <Card>
          <CardHeader title="Interest on overdue invoices" description="Simple interest from the due date, at the rate you set (for follow-up or a debit note)." />
          <div className="flex items-end gap-4 px-5 pb-3">
            <Field label="Rate % a year">{(f) => <Input {...f} className="w-24" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />}</Field>
            {interest.data && <p className="pb-2 text-sm">Total <strong className="tabular-nums">{formatMoney(interest.data.total)}</strong></p>}
          </div>
          {!!interest.data?.bills.length && (
            <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
              <tbody className="divide-y divide-border">
                {interest.data.bills.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2"><Link href={`/sales/invoices/${b.id}`} className="font-mono text-primary hover:underline">{b.number}</Link> <span className="text-muted">{b.party}</span></td>
                    <td className="px-4 py-2 text-muted">due {formatDate(b.dueDate)} · {b.days} days</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(b.outstanding)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(b.interest)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}
