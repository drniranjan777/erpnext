"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, MessageSquare, PackageX, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Info } from "@/components/documents/doc-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { PRIORITY_TONE, SLA_LABEL, SLA_TONE, STATUS_TONE, SVC, when } from "@/lib/service";

interface Ticket {
  id: string; number: string; subject: string; description: string | null; category: string; priority: keyof typeof PRIORITY_TONE; status: keyof typeof STATUS_TONE; channel: string;
  partyId: string | null; customer: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; itemId: string | null; itemName: string | null; serialNo: string | null;
  assigneeId: string | null; assignee: string | null; responseDueAt: string | null; resolutionDueAt: string | null; firstResponseAt: string | null; resolvedAt: string | null; escalationLevel: number; resolution: string | null;
  warrantyEnds: string | null; contractNumber: string | null; contractEnds: string | null; response: keyof typeof SLA_TONE | null; resolutionSla: keyof typeof SLA_TONE | null;
  events: { id: string; kind: string; body: string; createdAt: string; author: string | null }[];
  visits: { id: string; number: string; kind: string; status: string; scheduledAt: string }[];
  suggestions: { id: string; title: string; excerpt: string }[];
}
interface Member { userId: string; fullName: string }

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("service.tickets.manage");
  const q = useQuery({ queryKey: [SVC, "tickets", id], queryFn: () => api<Ticket>(`${SVC}/tickets/${id}`) });
  const members = useQuery({ queryKey: ["iam", "users"], queryFn: () => api<Member[]>("/iam/users"), retry: false, enabled: manage });
  const [reply, setReply] = useState({ body: "", toCustomer: true });
  const [hint, setHint] = useState<string | null>(null);
  async function suggest() {
    try {
      const a = await api<{ reply: string; mode: string; classification: { category: string; priority: string; differs: boolean } }>(`${SVC}/tickets/${id}/assist`);
      setReply({ body: a.reply, toCustomer: true });
      setHint(`${a.mode === "ai" ? "Drafted by AI" : "Drafted from a template"}; check before sending.${a.classification.differs ? ` The wording suggests ${a.classification.category}, ${a.classification.priority} priority.` : ""}`);
    } catch {
      setHint("Could not draft a reply.");
    }
  }
  const [dlg, setDlg] = useState<"visit" | "rma" | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function act(path: string, body: unknown, done?: string) {
    setMsg(null);
    try {
      const r = await api<{ mailed?: boolean }>(path, { body });
      if (done) setMsg({ tone: "success", text: r.mailed === false ? `${done} (no customer email on record, so not mailed)` : done });
      await qc.invalidateQueries({ queryKey: [SVC] });
      return true;
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
      return false;
    }
  }
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const t = q.data!;
  const closed = t.status === "closed";
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t.subject}
        description={`${t.number} · ${t.customer ?? t.contactName ?? "Unknown customer"} · ${t.category} by ${t.channel}`}
        actions={
          manage && (
            <span className="flex flex-wrap gap-2">
              {!["resolved", "closed"].includes(t.status) && <Button variant="secondary" onClick={() => setDlg("visit")}><CalendarPlus className="size-4" aria-hidden /> Visit</Button>}
              {t.itemId && !closed && <Button variant="ghost" onClick={() => setDlg("rma")}><PackageX className="size-4" aria-hidden /> RMA</Button>}
              {!["resolved", "closed"].includes(t.status) && <Button onClick={() => { const resolution = window.prompt("How was it resolved?"); if (resolution) act(`${SVC}/tickets/${t.id}/status`, { status: "resolved", resolution }); }}><CheckCircle2 className="size-4" aria-hidden /> Resolve</Button>}
              {t.status === "resolved" && <Button variant="secondary" onClick={() => act(`${SVC}/tickets/${t.id}/status`, { status: "closed" })}>Close</Button>}
              {["resolved", "closed"].includes(t.status) && <Button variant="ghost" onClick={() => act(`${SVC}/tickets/${t.id}/status`, { status: "open" })}>Reopen</Button>}
            </span>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={STATUS_TONE[t.status]}>{t.status.replace("_", " ")}</Badge>
        <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
        {t.escalationLevel > 0 && <Badge tone="danger">escalated L{t.escalationLevel}</Badge>}
        {t.warrantyEnds && <Badge tone="success">warranty to {formatDate(t.warrantyEnds)}</Badge>}
        {t.contractNumber && <Badge tone="primary">{t.contractNumber} to {formatDate(t.contractEnds!)}</Badge>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Respond by" value={<>{when(t.responseDueAt)} {t.response && <Badge tone={SLA_TONE[t.response]}>{SLA_LABEL[t.response]}</Badge>}</>} />
          <Info label="Resolve by" value={<>{when(t.resolutionDueAt)} {t.resolutionSla && <Badge tone={SLA_TONE[t.resolutionSla]}>{SLA_LABEL[t.resolutionSla]}</Badge>}</>} />
          <Info label="Machine" value={t.serialNo ? <Link className="text-primary hover:underline" href={`${SVC}/installed-base?serial=${encodeURIComponent(t.serialNo)}`}>{t.itemName ?? ""} {t.serialNo}</Link> : "–"} />
          <Info label="Contact" value={[t.contactName, t.contactPhone, t.contactEmail].filter(Boolean).join(" · ") || "–"} />
          <Info
            label="Assignee"
            value={manage ? <Select aria-label="Assignee" className="h-8" value={t.assigneeId ?? ""} onChange={(e) => e.target.value && act(`${SVC}/tickets/${t.id}/assign`, { userId: e.target.value })}><option value="">Unassigned</option>{members.data?.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select> : (t.assignee ?? "–")}
          />
        </dl>
        {t.description && <p className="whitespace-pre-wrap border-t border-border px-5 py-3 text-sm">{t.description}</p>}
        {t.resolution && <p className="border-t border-border px-5 py-3 text-sm"><span className="font-medium">Resolution: </span>{t.resolution}</p>}
      </Card>
      {t.suggestions.length > 0 && (
        <Card>
          <CardHeader title="From the knowledge base" />
          <ul className="divide-y divide-border border-t border-border text-sm">{t.suggestions.map((a) => <li key={a.id} className="px-5 py-2"><Link className="font-medium text-primary hover:underline" href={`${SVC}/kb?article=${a.id}`}>{a.title}</Link><span className="block text-xs text-muted">{a.excerpt}</span></li>)}</ul>
        </Card>
      )}
      <Card>
        <CardHeader title="History" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {t.events.map((e) => (
            <li key={e.id} className={`px-5 py-2 ${e.kind === "reply" ? "bg-primary/5" : e.kind === "customer" ? "bg-warning/5" : e.kind === "escalation" ? "bg-danger/5" : ""}`}>
              <p className="text-xs text-muted">{when(e.createdAt)} · {e.kind === "customer" ? "customer, on the portal" : `${e.author ?? "system"} · ${e.kind === "reply" ? "reply to customer" : e.kind}`}</p>
              <p className="whitespace-pre-wrap">{e.body}</p>
            </li>
          ))}
          {t.visits.map((v) => <li key={v.id} className="px-5 py-2 text-xs"><Link className="text-primary hover:underline" href={`${SVC}/visits?visit=${v.id}`}>{v.number}</Link> {v.kind} visit {when(v.scheduledAt)} · {v.status}</li>)}
        </ul>
        {manage && !closed && (
          <div className="space-y-2 border-t border-border p-4">
            <textarea aria-label="Reply" rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} />
            <div className="flex items-center gap-3">
              <Select aria-label="Visibility" className="h-9 w-56" value={reply.toCustomer ? "c" : "n"} onChange={(e) => setReply({ ...reply, toCustomer: e.target.value === "c" })}><option value="c">Reply to the customer</option><option value="n">Internal note</option></Select>
              <Button size="sm" disabled={!reply.body.trim()} onClick={async () => (await act(`${SVC}/tickets/${t.id}/reply`, reply, reply.toCustomer ? "Reply sent" : "Note added")) && setReply({ body: "", toCustomer: reply.toCustomer })}><MessageSquare className="size-4" aria-hidden /> {reply.toCustomer ? "Send reply" : "Add note"}</Button>
              <Button size="sm" variant="ghost" onClick={suggest}><Sparkles className="size-4" aria-hidden /> Suggest a reply</Button>
              {hint && <span className="text-xs text-muted">{hint}</span>}
            </div>
          </div>
        )}
      </Card>
      {dlg === "visit" && <VisitDialog ticketId={t.id} members={members.data ?? []} onClose={() => setDlg(null)} onDone={() => { setDlg(null); qc.invalidateQueries({ queryKey: [SVC] }); }} />}
      {dlg === "rma" && <RmaDialog t={t} onClose={() => setDlg(null)} onDone={() => { setDlg(null); setMsg({ tone: "success", text: "RMA authorised: see Service → RMA." }); }} />}
    </div>
  );
}

function VisitDialog({ ticketId, members, onClose, onDone }: { ticketId: string; members: Member[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ kind: "breakdown", technicianId: "", date: todayIST(), time: "11:00" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${SVC}/visits`, { body: { kind: f.kind, ticketId, technicianId: f.technicianId || null, scheduledAt: `${f.date}T${f.time}:00+05:30` } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Schedule a visit" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Schedule</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="breakdown">Breakdown</option><option value="installation">Installation</option><option value="preventive">Preventive</option></Select>}</Field>
        <Field label="Technician">{(p) => <Select {...p} value={f.technicianId} onChange={(e) => setF({ ...f, technicianId: e.target.value })}><option value="">—</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>}</Field>
        <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Time">{(p) => <Input {...p} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function RmaDialog({ t, onClose, onDone }: { t: Ticket; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(t.subject);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${SVC}/rmas`, { body: { partyId: t.partyId, itemId: t.itemId, serialNo: t.serialNo, ticketId: t.id, reason } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Authorise a return for repair" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!t.partyId || reason.trim().length < 3}>Authorise</Button></>}>
      {error && <Alert>{error}</Alert>}
      {!t.partyId && <Alert tone="warning">Link the ticket to a customer first.</Alert>}
      <Field label="Reason">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </Dialog>
  );
}
