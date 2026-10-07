"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookCheck, FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, AttachmentsPanel } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { QMS, type Sop } from "@/lib/qms";

const API = `${QMS}/sops`;
const ROUTE = "/quality/sops";
interface Member { userId: string; fullName: string; email: string }

export default function SopPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const key = [QMS, "sops", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Sop>(`${API}/${id}`) });
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function call<T>(fn: () => Promise<T>, then?: (r: T) => void) {
    setError(null);
    try {
      const r = await fn();
      await qc.invalidateQueries({ queryKey: [QMS, "sops"] });
      then?.(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  const done = d.trainees.filter((t) => t.acknowledgedAt).length;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: ROUTE, label: "SOPs" }}
        badges={<><Badge>v{d.sopVersion}</Badge>{d.current && <Badge tone="success">Current</Badge>}{d.supersededAt && <Badge tone="warning">Superseded</Badge>}</>}
        subtitle={`${d.sopCode} · ${d.title}`}
        actions={
          <>
            {d.canAcknowledge && <Button onClick={() => call(() => api(`${API}/${d.id}/acknowledge`, { method: "POST" }))}><BookCheck className="size-4" aria-hidden /> I have read and understood this</Button>}
            {d.canRevise && <Button variant="secondary" onClick={() => call(() => api<Sop>(`${API}/${d.id}/new-version`, { method: "POST" }), (r) => router.push(`${ROUTE}/${r.id}`))}><FilePlus2 className="size-4" aria-hidden /> New version</Button>}
            <DocumentActions doc={d} apiBase={API} routeBase={ROUTE} queryKey={key} />
          </>
        }
      />
      {error && <Alert>{error}</Alert>}
      <DocStatusAlerts doc={d} approvedNote={d.supersededAt ? `Superseded ${formatDateTime(d.supersededAt)}: do not use.` : `Released; effective ${d.effectiveDate ? formatDate(d.effectiveDate) : "now"}.`} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Department" value={d.department ?? "–"} />
          <Info label="Effective" value={d.effectiveDate ? formatDate(d.effectiveDate) : "On release"} />
          <Info label="Review by" value={d.reviewDue ? formatDate(d.reviewDue) : "–"} />
          <Info label="Versions" value={d.versions.map((v) => <Link key={v.id} href={`${ROUTE}/${v.id}`} className={`mr-2 ${v.id === d.id ? "font-semibold" : "text-primary hover:underline"}`}>v{v.sopVersion}</Link>)} />
        </dl>
        {d.purpose && <p className="border-t border-border px-5 py-3 text-sm">{d.purpose}</p>}
        {d.body && <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap border-t border-border px-5 py-4 font-sans text-sm">{d.body}</pre>}
      </Card>
      <Card>
        <CardHeader title="Training" description={d.trainees.length ? `${done} of ${d.trainees.length} have read this version.` : "Nobody is on the training list yet."} action={d.canAssign && can("iam.users.read") && <Button size="sm" variant="secondary" onClick={() => setPicking(!picking)}>{picking ? "Done" : "Choose people"}</Button>} />
        {picking && <TraineePicker sop={d} onSaved={() => qc.invalidateQueries({ queryKey: key })} />}
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.trainees.map((t) => (
            <li key={t.userId} className="flex items-center justify-between px-5 py-2">
              <span>{t.name} <span className="text-xs text-muted">{t.email}</span></span>
              {t.acknowledgedAt ? <Badge tone="success">Read {formatDateTime(t.acknowledgedAt)}</Badge> : <Badge tone="warning">Not yet</Badge>}
            </li>
          ))}
        </ul>
      </Card>
      <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled" || !!d.supersededAt} />
      <ActivityFeed documentId={d.id} />
    </div>
  );
}

function TraineePicker({ sop, onSaved }: { sop: Sop; onSaved: () => void }) {
  const members = useQuery({ queryKey: ["iam", "users"], queryFn: () => api<Member[]>("/iam/users") });
  const [sel, setSel] = useState(new Set(sop.trainees.map((t) => t.userId)));
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${API}/${sop.id}/trainees`, { method: "PUT", body: { userIds: [...sel] } });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="space-y-2 border-t border-border p-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-1 sm:grid-cols-2">
        {members.data?.map((m) => <Checkbox key={m.userId} label={`${m.fullName} (${m.email})`} checked={sel.has(m.userId)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(m.userId); else n.delete(m.userId); return n; })} />)}
      </div>
      <div className="flex justify-end"><Button size="sm" onClick={save}>Save training list</Button></div>
    </div>
  );
}
