"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/documents";
import { ACTIVITY_LABEL, CRM, SOURCES, when } from "@/lib/crm";
import { inr } from "@/lib/payroll";

interface Summary { openLeads: number; newLeads: number; unassigned: number; openOpportunities: number; pipeline: number; overdueActivities: number; leads30: number; converted30: number; bySource: { source: string; leads: number; converted: number }[] }
interface Agenda { id: string; kind: string; subject: string; dueAt: string | null; leadId: string | null; opportunityId: string | null; leadName: string | null; opportunityTitle: string | null; partyName: string | null; overdue: boolean }

export default function CrmHomePage() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: [CRM, "summary"], queryFn: () => api<Summary>(`${CRM}/summary`) });
  const agenda = useQuery({ queryKey: [CRM, "agenda"], queryFn: () => api<Agenda[]>(`${CRM}/activities/agenda`) });
  const follow = useQuery({ queryKey: [CRM, "follow-ups"], queryFn: () => api<{ id: string; number: string; name: string; company: string | null; nextFollowUp: string; score: number }[]>(`${CRM}/leads/follow-ups`) });
  if (s.isLoading) return <LoadingBlock />;
  if (s.error) return <ErrorBlock error={s.error} />;
  const d = s.data!;
  const stat = (label: string, value: string | number, href?: string) => (
    <Card className="px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{href ? <Link href={href} className="hover:underline">{value}</Link> : value}</p>
    </Card>
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="CRM" description="Leads from every channel, the opportunity pipeline and your day's follow-ups." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stat("Open leads", d.openLeads, `${CRM}/leads`)}
        {stat("Not yet assigned", d.unassigned, `${CRM}/leads`)}
        {stat("Open pipeline", inr(d.pipeline), `${CRM}/pipeline`)}
        {stat("Leads converted (30 days)", d.leads30 ? `${Math.round((d.converted30 / d.leads30) * 100)} %` : "–")}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="My agenda" description={d.overdueActivities ? `${d.overdueActivities} overdue` : undefined} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {agenda.data?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-5 py-2">
                <Badge tone={a.overdue ? "danger" : "neutral"}>{ACTIVITY_LABEL[a.kind]}</Badge>
                <Link className="font-medium hover:underline" href={a.opportunityId ? `${CRM}/opportunities/${a.opportunityId}` : `${CRM}/leads/${a.leadId}`}>{a.subject}</Link>
                <span className="text-xs text-muted">{a.opportunityTitle ?? a.leadName ?? a.partyName} · {when(a.dueAt)}</span>
                <Button className="ml-auto" size="sm" variant="ghost" onClick={async () => { await api(`${CRM}/activities/${a.id}/done`, { body: {} }); qc.invalidateQueries({ queryKey: [CRM] }); }}>Done</Button>
              </li>
            ))}
            {agenda.data && !agenda.data.length && <li className="px-5 py-4 text-muted">Nothing scheduled.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Leads to follow up" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {follow.data?.map((l) => <li key={l.id} className="flex gap-2 px-5 py-2"><Link className="font-medium hover:underline" href={`${CRM}/leads/${l.id}`}>{l.name}</Link><span className="text-xs text-muted">{l.company} · due {formatDate(l.nextFollowUp)}</span><Badge className="ml-auto">{l.score}</Badge></li>)}
            {follow.data && !follow.data.length && <li className="px-5 py-4 text-muted">No follow-ups due.</li>}
          </ul>
        </Card>
      </div>
      <Card>
        <CardHeader title="Leads by source (90 days)" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.bySource.map((x) => <li key={x.source} className="flex justify-between px-5 py-2"><span>{SOURCES[x.source] ?? x.source}</span><span className="tabular-nums">{x.leads} leads · {x.converted} converted ({x.leads ? Math.round((x.converted / x.leads) * 100) : 0} %)</span></li>)}
          {!d.bySource.length && <li className="px-5 py-4 text-muted">No leads yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
