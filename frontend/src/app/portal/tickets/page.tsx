"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/documents";
import { portalApi, TICKET_LABEL, TICKET_TONE } from "@/lib/portal";

interface Ticket { id: string; number: string; subject: string; status: string; priority: string; category: string; serialNo: string | null; createdAt: string; resolvedAt: string | null }
interface Article { id: string; title: string; excerpt: string }

export default function PortalTickets() {
  const [raising, setRaising] = useState(false);
  const q = useQuery({ queryKey: ["portal", "tickets"], queryFn: () => portalApi<Ticket[]>("/portal/tickets") });
  return (
    <div className="space-y-6">
      <PageHeader title="Service requests" description="Report a breakdown, ask for an installation or raise any concern. Our service desk replies here and by email." actions={<><Link href="/portal/tickets/help" className="text-sm text-primary hover:underline">Help articles</Link>{!raising && <Button onClick={() => setRaising(true)}><Plus className="size-4" aria-hidden /> New request</Button>}</>} />
      {raising && <NewTicket onClose={() => setRaising(false)} />}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Link href={`/portal/tickets/${t.id}`} className="font-mono text-xs text-primary hover:underline">{t.number}</Link>
                <span className="font-medium">{t.subject}</span>
                {t.serialNo && <span className="text-xs text-muted">serial {t.serialNo}</span>}
                <span className="text-xs text-muted">{formatDate(t.createdAt.slice(0, 10))}</span>
                <Badge tone={TICKET_TONE[t.status]} className="ml-auto">{TICKET_LABEL[t.status] ?? t.status}</Badge>
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">No service requests yet.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}

function NewTicket({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({ subject: "", description: "", serialNo: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const help = useQuery({ queryKey: ["portal", "articles", f.subject], queryFn: () => portalApi<Article[]>("/portal/articles", { query: { q: f.subject } }), enabled: f.subject.trim().length >= 4 });
  async function save() {
    setError(null);
    setBusy(true);
    try {
      const t = await portalApi<{ id: string }>("/portal/tickets", { body: { subject: f.subject, description: f.description, serialNo: f.serialNo || null, phone: f.phone || null } });
      await qc.invalidateQueries({ queryKey: ["portal"] });
      router.push(`/portal/tickets/${t.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="New service request" />
      <div className="grid gap-3 border-t border-border p-5">
        {error && <Alert>{error}</Alert>}
        <Field label="What is the problem?">{(p) => <Input {...p} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
        {help.data && help.data.length > 0 && (
          <div className="rounded-lg bg-surface-muted px-4 py-3 text-sm">
            <p className="text-xs font-medium uppercase text-muted">These may help</p>
            <ul className="mt-1 space-y-1">{help.data.slice(0, 3).map((a) => <li key={a.id}><Link className="text-primary hover:underline" href={`/portal/tickets/help?article=${a.id}`} target="_blank">{a.title}</Link></li>)}</ul>
          </div>
        )}
        <Field label="Details" hint="What happened, since when, any error code shown">{(p) => <textarea {...p} rows={4} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Machine serial number">{(p) => <Input {...p} value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} />}</Field>
          <Field label="Phone to reach you">{(p) => <Input {...p} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={f.subject.trim().length < 3 || f.description.trim().length < 5}>Send</Button>
        </div>
      </div>
    </Card>
  );
}
