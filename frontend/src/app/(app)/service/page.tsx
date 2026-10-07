"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PRIORITY_TONE, SLA_LABEL, SLA_TONE, STATUS_TONE, SVC, type TicketRow, when } from "@/lib/service";

export default function ServiceDeskPage() {
  const { can } = useAuth();
  const [f, setF] = useState({ status: "open", assignee: "", q: "", breached: false });
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: [SVC, "tickets", f], queryFn: () => api<TicketRow[]>(`${SVC}/tickets`, { query: { status: f.status || undefined, assignee: f.assignee || undefined, q: f.q || undefined, breached: f.breached ? "true" : undefined } }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Service desk" description="Customer tickets with their response and resolution targets. Missed targets escalate on their own." actions={can("service.tickets.manage") && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Ticket</Button>} />
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-56" placeholder="Number, subject or serial" aria-label="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select className="h-9 w-40" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="open">All open</option><option value="in_progress">In progress</option><option value="waiting_customer">Waiting on customer</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="">Everything</option></Select>
        <Select className="h-9 w-40" aria-label="Assignee" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}><option value="">Anyone</option><option value="me">Mine</option><option value="none">Unassigned</option></Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.breached} onChange={(e) => setF({ ...f, breached: e.target.checked })} /> Breached only</label>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Ticket</th><th className="px-4 py-2 font-medium">Customer</th><th className="px-4 py-2 font-medium">Priority</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Response</th><th className="px-4 py-2 font-medium">Resolution</th><th className="px-4 py-2 font-medium">Assignee</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`${SVC}/tickets/${t.id}`}>{t.subject}</Link><span className="block text-xs text-muted">{t.number} · {t.category} · {t.channel}{t.serialNo && ` · ${t.serialNo}`}{t.underWarranty && " · warranty"}{t.underContract && " · AMC"}</span></td>
                  <td className="px-4 py-2">{t.customer ?? "–"}</td>
                  <td className="px-4 py-2"><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>{t.escalationLevel > 0 && <Badge tone="danger" className="ml-1">L{t.escalationLevel}</Badge>}</td>
                  <td className="px-4 py-2"><Badge tone={STATUS_TONE[t.status]}>{t.status.replace("_", " ")}</Badge></td>
                  <td className="px-4 py-2">{t.response && <Badge tone={SLA_TONE[t.response]}>{SLA_LABEL[t.response]}</Badge>}</td>
                  <td className="px-4 py-2">{t.resolutionSla && <Badge tone={SLA_TONE[t.resolutionSla]}>{SLA_LABEL[t.resolutionSla]}</Badge>}<span className="block text-xs text-muted">{when(t.resolutionDueAt)}</span></td>
                  <td className="px-4 py-2">{t.assignee ?? <span className="text-warning">unassigned</span>}</td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No tickets.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
      {adding && <NewTicket onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewTicket({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string }[] }>(`/masters/parties`, { query: { role: "customer", limit: 200 } }) });
  const [f, setF] = useState({ partyId: "", contactName: "", contactPhone: "", contactEmail: "", channel: "phone", subject: "", description: "", serialNo: "", priority: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setError(null);
    try {
      await api(`${SVC}/tickets`, { body: { ...f, partyId: f.partyId || null, contactName: f.contactName || null, contactPhone: f.contactPhone || null, contactEmail: f.contactEmail || null, description: f.description || null, serialNo: f.serialNo || null, priority: f.priority || undefined } });
      await qc.invalidateQueries({ queryKey: [SVC] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New ticket" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={f.subject.trim().length < 3}>Log ticket</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer" hint="Or leave blank: a known phone or email is matched">{(p) => <Select {...p} value={f.partyId} onChange={set("partyId")}><option value="">—</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Channel">{(p) => <Select {...p} value={f.channel} onChange={set("channel")}><option value="phone">Phone</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="walk_in">Walk-in</option><option value="field">Field</option></Select>}</Field>
        <Field label="Contact name">{(p) => <Input {...p} value={f.contactName} onChange={set("contactName")} />}</Field>
        <Field label="Phone">{(p) => <Input {...p} value={f.contactPhone} onChange={set("contactPhone")} />}</Field>
        <Field label="Email">{(p) => <Input {...p} type="email" value={f.contactEmail} onChange={set("contactEmail")} />}</Field>
        <Field label="Machine serial no.">{(p) => <Input {...p} value={f.serialNo} onChange={set("serialNo")} />}</Field>
        <Field label="Subject" className="sm:col-span-2">{(p) => <Input {...p} value={f.subject} onChange={set("subject")} />}</Field>
        <Field label="Details" className="sm:col-span-2">{(p) => <textarea {...p} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label="Priority" hint="Blank: worked out from the words used">{(p) => <Select {...p} value={f.priority} onChange={set("priority")}><option value="">Automatic</option><option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>}</Field>
      </div>
    </Dialog>
  );
}
