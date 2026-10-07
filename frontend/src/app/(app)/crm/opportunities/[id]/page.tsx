"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Info } from "@/components/documents/doc-page";
import { ActivityTimeline } from "@/components/crm/activity-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CRM, type Activity, type Stage } from "@/lib/crm";
import { formatDate } from "@/lib/documents";
import { inr } from "@/lib/payroll";

interface OppView { id: string; number: string; title: string; amount: string; closeDate: string | null; status: "open" | "won" | "lost"; stageId: string; stage: string; stageProbability: number; probability: number | null; partyId: string; party: string; owner: string | null; leadId: string | null; leadNumber: string | null; competitor: string | null; lostReason: string | null; quotationId: string | null; quotationNumber: string | null; quotationStatus: string | null; activities: Activity[] }

export default function OpportunityPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [CRM, "opportunities", id], queryFn: () => api<OppView>(`${CRM}/opportunities/${id}`) });
  const stages = useQuery({ queryKey: [CRM, "stages"], queryFn: () => api<Stage[]>(`${CRM}/stages`) });
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function move(stageId: string) {
    const s = stages.data?.find((x) => x.id === stageId);
    const lostReason = s?.kind === "lost" ? window.prompt("Why was it lost?") : null;
    if (s?.kind === "lost" && !lostReason) return;
    setError(null);
    try {
      await api(`${CRM}/opportunities/${id}/move`, { body: { stageId, lostReason } });
      qc.invalidateQueries({ queryKey: [CRM] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const o = q.data!;
  const manage = can("crm.opportunities.manage");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={o.title}
        description={`${o.number} · ${o.party}`}
        actions={
          manage && (
            <span className="flex flex-wrap gap-2">
              <Select className="h-10 w-48" aria-label="Stage" value={o.stageId} onChange={(e) => move(e.target.value)}>{stages.data?.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              {o.status === "open" && !o.quotationId && can("sales.quotations.manage") && <Button onClick={() => setQuoting(true)}><FileText className="size-4" aria-hidden /> Quote</Button>}
            </span>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={o.status === "won" ? "success" : o.status === "lost" ? "danger" : "primary"}>{o.status === "open" ? o.stage : o.status}</Badge>
        {o.quotationId && <Link href={`/sales/quotations/${o.quotationId}`}><Badge tone="primary">Quotation {o.quotationNumber ?? "(draft)"}{o.quotationStatus ? ` · ${o.quotationStatus}` : ""}</Badge></Link>}
        {o.leadId && <Link href={`${CRM}/leads/${o.leadId}`}><Badge>From lead {o.leadNumber}</Badge></Link>}
      </div>
      {error && <Alert>{error}</Alert>}
      {o.lostReason && <Alert tone="warning">Lost: {o.lostReason}</Alert>}
      <Card>
        <CardHeader title="Deal" />
        <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Value" value={inr(o.amount)} />
          <Info label="Probability" value={`${o.probability ?? o.stageProbability} %`} />
          <Info label="Expected close" value={o.closeDate ? formatDate(o.closeDate) : "–"} />
          <Info label="Owner" value={o.owner ?? "–"} />
          <Info label="Customer" value={<Link className="text-primary hover:underline" href={`/masters/parties/${o.partyId}`}>{o.party}</Link>} />
          <Info label="Competitor" value={o.competitor ?? "–"} />
        </dl>
      </Card>
      <ActivityTimeline activities={o.activities} link={{ opportunityId: o.id }} canManage={can("crm.leads.manage") && o.status === "open"} />
      {quoting && <QuoteDialog id={o.id} onClose={() => setQuoting(false)} />}
    </div>
  );
}

function QuoteDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["/masters/items", "sellable"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/items`, { query: { limit: 200 } }) });
  const [lines, setLines] = useState([{ itemId: "", qty: "1", rate: "" }]);
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${CRM}/opportunities/${id}/quote`, { body: { lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate || null })), validUntil: validUntil || null } });
      await qc.invalidateQueries({ queryKey: [CRM] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const set = (i: number, k: "itemId" | "qty" | "rate", v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <Dialog open onClose={onClose} title="Draft quotation" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!lines.some((l) => l.itemId)}>Create draft</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <Select aria-label="Item" className="flex-1" value={l.itemId} onChange={(e) => set(i, "itemId", e.target.value)}><option value="">Item…</option>{items.data?.items.map((it) => <option key={it.id} value={it.id}>{it.code} {it.name}</option>)}</Select>
            <Input aria-label="Quantity" className="w-24" inputMode="decimal" value={l.qty} onChange={(e) => set(i, "qty", e.target.value)} />
            <Input aria-label="Rate" className="w-28" inputMode="decimal" placeholder="List rate" value={l.rate} onChange={(e) => set(i, "rate", e.target.value)} />
            <Button size="sm" variant="ghost" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3.5" aria-hidden /></Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { itemId: "", qty: "1", rate: "" }])}><Plus className="size-4" aria-hidden /> Line</Button>
        <Field label="Valid until">{(p) => <Input {...p} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}</Field>
        <p className="text-xs text-muted">The quotation opens as a draft in Sales; finish and submit it there. The opportunity moves to the proposal stage.</p>
      </div>
    </Dialog>
  );
}
