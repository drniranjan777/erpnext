"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CRM, type Opportunity, type Stage } from "@/lib/crm";
import { formatDate } from "@/lib/documents";
import { inr, monthLabel } from "@/lib/payroll";

interface Forecast { byMonth: { month: string; count: number; total: number; weighted: number }[]; winRate: number | null }

/** The pipeline as a board: drag a card to another stage (or onto Won / Lost). */
export default function PipelinePage() {
  const { can } = useAuth();
  const manage = can("crm.opportunities.manage");
  const qc = useQueryClient();
  const stages = useQuery({ queryKey: [CRM, "stages"], queryFn: () => api<Stage[]>(`${CRM}/stages`) });
  const opps = useQuery({ queryKey: [CRM, "opportunities", "open"], queryFn: () => api<Opportunity[]>(`${CRM}/opportunities`, { query: { status: "open" } }) });
  const forecast = useQuery({ queryKey: [CRM, "forecast"], queryFn: () => api<Forecast>(`${CRM}/forecast`) });
  const [dragging, setDragging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function move(id: string, stage: Stage) {
    setError(null);
    const lostReason = stage.kind === "lost" ? window.prompt("Why was it lost?") : null;
    if (stage.kind === "lost" && !lostReason) return;
    try {
      await api(`${CRM}/opportunities/${id}/move`, { body: { stageId: stage.id, lostReason } });
      qc.invalidateQueries({ queryKey: [CRM] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  if (stages.isLoading || opps.isLoading) return <LoadingBlock />;
  if (stages.error) return <ErrorBlock error={stages.error} />;
  const active = stages.data!.filter((s) => s.isActive);
  const columns = active.filter((s) => s.kind === "open");
  const closers = active.filter((s) => s.kind !== "open");
  const drop = (s: Stage) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: () => { if (dragging) move(dragging, s); setDragging(null); },
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Pipeline" description={forecast.data ? `Weighted forecast ${inr(forecast.data.byMonth.reduce((s, m) => s + m.weighted, 0))} over six months${forecast.data.winRate !== null ? ` · win rate ${forecast.data.winRate} %` : ""}` : undefined} actions={manage && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Opportunity</Button>} />
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((s) => {
          const cards = opps.data!.filter((o) => o.stageId === s.id);
          return (
            <div key={s.id} className="w-72 shrink-0 rounded-lg bg-surface-muted p-2" {...drop(s)}>
              <p className="mb-2 flex items-baseline justify-between px-1 text-sm font-medium">{s.name}<span className="text-xs font-normal text-muted">{s.probability} % · {inr(cards.reduce((t, o) => t + Number(o.amount), 0))}</span></p>
              <div className="space-y-2">
                {cards.map((o) => (
                  <Card key={o.id} draggable={manage} onDragStart={() => setDragging(o.id)} className="cursor-grab px-3 py-2 text-sm">
                    <Link className="font-medium hover:underline" href={`${CRM}/opportunities/${o.id}`}>{o.title}</Link>
                    <p className="text-xs text-muted">{o.party}</p>
                    <p className="mt-1 flex items-center justify-between text-xs"><span className="tabular-nums font-medium">{inr(o.amount)}</span><span className={o.overdue ? "text-danger" : "text-muted"}>{o.closeDate ? formatDate(o.closeDate) : "no date"}</span></p>
                    {!o.nextActivity && <p className="mt-1 text-xs text-warning">No next step planned</p>}
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {manage && (
        <div className="flex gap-3">
          {closers.map((s) => <div key={s.id} {...drop(s)} className={`flex-1 rounded-lg border-2 border-dashed px-4 py-3 text-center text-sm ${s.kind === "won" ? "border-success text-success" : "border-danger text-danger"}`}>Drop here: {s.name}</div>)}
        </div>
      )}
      {forecast.data && forecast.data.byMonth.length > 0 && (
        <Card>
          <CardHeader title="Forecast by expected close" />
          <table className="w-full border-t border-border text-sm">
            <tbody className="divide-y divide-border">{forecast.data.byMonth.map((m) => <tr key={m.month}><td className="px-5 py-2">{monthLabel(m.month)}</td><td className="px-5 py-2 text-right tabular-nums">{m.count} deals</td><td className="px-5 py-2 text-right tabular-nums">{inr(m.total)}</td><td className="px-5 py-2 text-right font-medium tabular-nums">{inr(m.weighted)} weighted</td></tr>)}</tbody>
          </table>
        </Card>
      )}
      {adding && <NewOpportunity onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewOpportunity({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }) });
  const [f, setF] = useState({ title: "", partyId: "", amount: "", closeDate: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${CRM}/opportunities`, { body: { title: f.title, partyId: f.partyId, amount: Number(f.amount) || 0, closeDate: f.closeDate || null } });
      await qc.invalidateQueries({ queryKey: [CRM] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New opportunity" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.partyId || f.title.trim().length < 2}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Customer" className="sm:col-span-2">{(p) => <Select {...p} value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}><option value="">Choose…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</Select>}</Field>
        <Field label="Value (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Expected close">{(p) => <Input {...p} type="date" value={f.closeDate} onChange={(e) => setF({ ...f, closeDate: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
