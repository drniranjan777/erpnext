"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Info } from "@/components/documents/doc-page";
import { ActivityTimeline } from "@/components/crm/activity-form";
import { NextActionCard, type LeadInsight } from "@/components/crm/next-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CRM, grade, GRADE_TONE, LEAD_TONE, SOURCES, type Activity, type Lead } from "@/lib/crm";
import { formatDate } from "@/lib/documents";
import { inr } from "@/lib/payroll";
import { askText } from "@/components/ui/ask";

interface LeadView extends Lead { requirement: string | null; sourceRef: string | null; scoreReasons: string[]; lostReason: string | null; partyId: string | null; partyName: string | null; opportunityId: string | null; duplicateNumber: string | null; activities: Activity[]; insight: LeadInsight }

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [CRM, "leads", id], queryFn: () => api<LeadView>(`${CRM}/leads/${id}`) });
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function status(s: string) {
    const lostReason = s === "lost" ? await askText("Why was it lost?") : null;
    if (s === "lost" && !lostReason) return;
    setError(null);
    try {
      await api(`${CRM}/leads/${id}/status`, { body: { status: s, lostReason } });
      qc.invalidateQueries({ queryKey: [CRM] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const l = q.data!;
  const manage = can("crm.leads.manage");
  const open = !["converted", "lost"].includes(l.status);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={l.name}
        description={`${l.number}${l.company ? ` · ${l.company}` : ""} · ${SOURCES[l.source] ?? l.source}`}
        actions={
          manage &&
          open && (
            <span className="flex flex-wrap gap-2">
              {l.status !== "qualified" && <Button variant="secondary" onClick={() => status("qualified")}><ThumbsUp className="size-4" aria-hidden /> Qualified</Button>}
              {can("masters.parties.manage") && <Button onClick={() => setConverting(true)}><ArrowRightLeft className="size-4" aria-hidden /> Convert</Button>}
              <Button variant="ghost" onClick={() => status("unqualified")}>Not a fit</Button>
              <Button variant="ghost" onClick={() => status("lost")}><ThumbsDown className="size-4" aria-hidden /> Lost</Button>
            </span>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={LEAD_TONE[l.status]}>{l.status}</Badge>
        <Badge tone={GRADE_TONE[grade(l.score)]}>{grade(l.score)} · score {l.score}</Badge>
        {l.duplicateOfId && <Link href={`${CRM}/leads/${l.duplicateOfId}`}><Badge tone="warning">Same contact as {l.duplicateNumber}</Badge></Link>}
        {l.partyId && <Link href={`/masters/parties/${l.partyId}`}><Badge tone="success">Customer: {l.partyName}</Badge></Link>}
        {l.opportunityId && <Link href={`${CRM}/opportunities/${l.opportunityId}`}><Badge tone="primary">Opportunity</Badge></Link>}
      </div>
      {error && <Alert>{error}</Alert>}
      {l.lostReason && <Alert tone="warning">Lost: {l.lostReason}</Alert>}
      {l.insight && <NextActionCard next={l.insight.nextAction} summary={l.insight.summary} missing={open ? l.insight.missing : undefined} />}
      <Card>
        <CardHeader title="Enquiry" />
        <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-3">
          <Info label="Phone" value={l.phone ?? "–"} />
          <Info label="Email" value={l.email ?? "–"} />
          <Info label="City · state" value={[l.city, l.stateCode].filter(Boolean).join(" · ") || "–"} />
          <Info label="Product" value={l.product ?? "–"} />
          <Info label="Estimated value" value={inr(l.estimatedValue)} />
          <Info label="Owner" value={`${l.owner ?? "Unassigned"}${l.territory ? ` (${l.territory})` : ""}`} />
          <Info label="Follow up" value={l.nextFollowUp ? formatDate(l.nextFollowUp) : "–"} />
          <Info label="Portal reference" value={l.sourceRef ?? "–"} mono />
        </dl>
        {l.requirement && <p className="border-t border-border px-5 py-3 text-sm">{l.requirement}</p>}
        <p className="border-t border-border px-5 py-2 text-xs text-muted">Score: {l.scoreReasons.join(", ") || "no signals yet"}</p>
      </Card>
      <ActivityTimeline activities={l.activities} link={{ leadId: l.id }} canManage={manage && open} />
      {converting && <ConvertDialog lead={l} onClose={() => setConverting(false)} />}
    </div>
  );
}

function ConvertDialog({ lead, onClose }: { lead: LeadView; onClose: () => void }) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }) });
  const [f, setF] = useState({ partyId: "", name: lead.company ?? lead.name, gstin: "", line1: "", city: lead.city ?? "", stateCode: lead.stateCode ?? "", pincode: "", withOpp: true, title: lead.product ?? `${lead.company ?? lead.name} enquiry`, amount: lead.estimatedValue ? String(Number(lead.estimatedValue)) : "", closeDate: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setError(null);
    const body = {
      partyId: f.partyId || undefined,
      party: f.partyId ? undefined : { name: f.name, gstin: f.gstin || null, address: f.line1 ? { line1: f.line1, city: f.city, stateCode: f.stateCode, pincode: f.pincode || null } : undefined },
      opportunity: f.withOpp ? { title: f.title, amount: Number(f.amount) || 0, closeDate: f.closeDate || null } : undefined,
    };
    try {
      await api(`${CRM}/leads/${lead.id}/convert`, { body });
      await qc.invalidateQueries({ queryKey: [CRM] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Convert ${lead.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Convert</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer" className="sm:col-span-2">{(p) => <Select {...p} value={f.partyId} onChange={set("partyId")}><option value="">New customer…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</Select>}</Field>
        {!f.partyId && (
          <>
            <Field label="Customer name">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
            <Field label="GSTIN">{(p) => <Input {...p} value={f.gstin} onChange={set("gstin")} />}</Field>
            <Field label="Address" className="sm:col-span-2">{(p) => <Input {...p} value={f.line1} onChange={set("line1")} />}</Field>
            <Field label="City">{(p) => <Input {...p} value={f.city} onChange={set("city")} />}</Field>
            <Field label="State code · PIN">{(p) => <span className="flex gap-2"><Input {...p} className="w-20" maxLength={2} value={f.stateCode} onChange={set("stateCode")} /><Input aria-label="PIN code" maxLength={6} value={f.pincode} onChange={set("pincode")} /></span>}</Field>
          </>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.withOpp} onChange={(e) => setF({ ...f, withOpp: e.target.checked })} /> Create an opportunity</label>
        {f.withOpp && (
          <>
            <Field label="Opportunity" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={set("title")} />}</Field>
            <Field label="Value (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={set("amount")} />}</Field>
            <Field label="Expected close">{(p) => <Input {...p} type="date" value={f.closeDate} onChange={set("closeDate")} />}</Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
