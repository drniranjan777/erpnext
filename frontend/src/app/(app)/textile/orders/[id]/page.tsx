"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { PageHeader, ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";

interface Milestone { key: string; label: string; sample: string | null; due: string; doneOn: string | null; state: string; daysLate: number }
interface Order { id: string; poNo: string; buyer: string; currency: string; price: number; poDate: string; exFactory: string; incoterm: string | null; status: string; breakdown: Record<string, Record<string, number>>; totals: { bySize: Record<string, number>; byColour: Record<string, number>; total: number }; value: number; style: { id: string; styleNo: string; description: string; version: number; status: string }; tna: Milestone[]; late: number; missingCertificates: string[] }

const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "primary"> = { done: "success", done_late: "warning", late: "danger", due_soon: "primary", pending: "neutral" };

/** A buyer order: breakdown and time and action. */
export default function BuyerOrderPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["/textile/orders", id], queryFn: () => api<Order>(`/textile/orders/${id}`) });
  const [msg, setMsg] = useState<string | null>(null);
  const o = q.data;
  if (!o) return q.isError ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  async function mark(key: string, date: string | null) {
    setMsg(null);
    try {
      await api(`/textile/orders/${id}/milestones`, { body: { key, date } });
      qc.invalidateQueries({ queryKey: ["/textile/orders"] });
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const sizes = Object.keys(o.totals.bySize);
  const today = new Date(q.dataUpdatedAt).toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title={`${o.poNo} · ${o.buyer}`} description={`Style ${o.style.styleNo} (v${o.style.version} ${o.style.status}) · PO ${formatDate(o.poDate)} · ex-factory ${formatDate(o.exFactory)} · ${o.incoterm ?? ""} · ${o.status}`} actions={<Link className="text-sm text-primary hover:underline" href={`/textile/tech-packs/${o.style.id}`}>Tech pack</Link>} />
      {msg && <Alert>{msg}</Alert>}
      {o.missingCertificates.length > 0 && <Alert tone="warning">The buyer requires {o.missingCertificates.map((c) => c.toUpperCase()).join(", ")}: no valid certificate on the ex-factory date. Add it under Certificates.</Alert>}
      <Card>
        <CardHeader title="Breakdown" description={`${o.totals.total.toLocaleString("en-IN")} pieces × ${o.currency} ${o.price} = ${o.currency} ${o.value.toLocaleString("en-IN")}`} />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-xs text-muted"><tr><th className="px-3 py-1.5 text-left">Colour</th>{sizes.map((z) => <th key={z} className="px-3 py-1.5 text-right">{z}</th>)}<th className="px-3 py-1.5 text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-border">
            {Object.entries(o.breakdown).map(([c, s]) => <tr key={c}><td className="px-3 py-1.5">{c}</td>{sizes.map((z) => <td key={z} className="px-3 py-1.5 text-right tabular-nums">{s[z] ?? ""}</td>)}<td className="px-3 py-1.5 text-right font-medium tabular-nums">{o.totals.byColour[c]}</td></tr>)}
            <tr className="font-medium"><td className="px-3 py-1.5">Total</td>{sizes.map((z) => <td key={z} className="px-3 py-1.5 text-right tabular-nums">{o.totals.bySize[z]}</td>)}<td className="px-3 py-1.5 text-right tabular-nums">{o.totals.total}</td></tr>
          </tbody>
        </table></div>
      </Card>
      <Card>
        <CardHeader title="Time and action" description={o.late ? `${o.late} milestone(s) late` : "On track"} />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {o.tna.map((m) => (
            <li key={m.key} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Badge tone={TONE[m.state]}>{m.state.replace("_", " ")}</Badge>
              <span className="w-64 font-medium">{m.label}</span>
              <span className="text-xs text-muted">due {formatDate(m.due)}{m.doneOn ? ` · done ${formatDate(m.doneOn)}` : ""}{m.daysLate ? ` · ${m.daysLate} day(s) late` : ""}{m.sample ? " · from sample approval" : ""}</span>
              {can("textile.orders.manage") && !m.sample && (m.doneOn ? <Button size="sm" variant="secondary" className="ml-auto" onClick={() => mark(m.key, null)}>Undo</Button> : <Button size="sm" variant="secondary" className="ml-auto" onClick={() => mark(m.key, today)}>Done today</Button>)}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
