"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { ErrorBlock, formatDateTime, LoadingBlock, PageHeader } from "@/components/ui/page";
import { ApiError } from "@/lib/api";
import { portalApi, TICKET_LABEL, TICKET_TONE } from "@/lib/portal";

interface Ticket { id: string; number: string; subject: string; description: string | null; status: string; serialNo: string | null; itemName: string | null; resolution: string | null; createdAt: string; rating: number | null; messages: { id: string; kind: string; body: string; createdAt: string; author: string | null }[] }

export default function PortalTicket() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["portal", "ticket", id], queryFn: () => portalApi<Ticket>(`/portal/tickets/${id}`) });
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const t = q.data!;
  async function send(path: string, payload: unknown) {
    setError(null);
    try {
      await portalApi(path, { body: payload });
      setBody("");
      qc.invalidateQueries({ queryKey: ["portal"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="space-y-6">
      <Link href="/portal/tickets" className="text-sm text-primary hover:underline">← Service requests</Link>
      <PageHeader title={`${t.number}: ${t.subject}`} description={[t.itemName, t.serialNo && `serial ${t.serialNo}`, `raised ${formatDateTime(t.createdAt)}`].filter(Boolean).join(" · ")} actions={<Badge tone={TICKET_TONE[t.status]}>{TICKET_LABEL[t.status] ?? t.status}</Badge>} />
      {error && <Alert>{error}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {t.description && <li className="px-5 py-3"><p className="text-xs text-muted">You wrote · {formatDateTime(t.createdAt)}</p><p className="mt-1 whitespace-pre-wrap">{t.description}</p></li>}
          {t.messages.map((m) => (
            <li key={m.id} className={`px-5 py-3 ${m.kind === "reply" ? "bg-primary/5" : ""}`}>
              <p className="text-xs text-muted">{m.kind === "customer" ? "You wrote" : m.author} · {formatDateTime(m.createdAt)}</p>
              <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
          {t.resolution && <li className="bg-success/5 px-5 py-3"><p className="text-xs text-muted">Resolution</p><p className="mt-1 whitespace-pre-wrap">{t.resolution}</p></li>}
        </ul>
      </Card>
      {t.status !== "closed" && (
        <Card className="space-y-2 p-4">
          <textarea aria-label="Your message" rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder={t.status === "resolved" ? "Not fixed? Tell us and we will reopen it." : "Add a message"} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex justify-end"><Button onClick={() => send(`/portal/tickets/${id}/messages`, { body })} disabled={!body.trim()}>Send</Button></div>
        </Card>
      )}
      {["resolved", "closed"].includes(t.status) && (
        <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <span>{t.rating ? "Your rating" : "How did we do?"}</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => send(`/portal/tickets/${id}/rating`, { rating: n })}>
              <Star className={`size-5 ${t.rating && n <= t.rating ? "fill-warning text-warning" : "text-muted"}`} aria-hidden />
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}
