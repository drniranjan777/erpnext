"use client";

import { useQuery } from "@tanstack/react-query";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentActions } from "@/components/documents/document-actions";
import { DocPageHeader, DocStatusAlerts, Info } from "@/components/documents/doc-page";
import { ActivityFeed, AttachmentsPanel, StatusBadge } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import type { DocumentStatus } from "@/lib/documents";
import { ENG, type Drawing } from "@/lib/engineering";

const G = `${ENG}/drawings`;

export default function DrawingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const key = [ENG, "drawings", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Drawing>(`${G}/${id}`) });
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function revise() {
    try {
      const r = await api<Drawing>(`${G}/${d.id}/revise`, { method: "POST" });
      router.push(`${G}/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DocPageHeader
        doc={d}
        back={{ href: G, label: "Drawing register" }}
        badges={<><Badge>Rev {d.drawingRevision}</Badge>{d.current && <Badge tone="success">Current</Badge>}{d.supersededAt && <Badge tone="warning">Superseded</Badge>}</>}
        subtitle={`${d.drawingNo} · ${d.title}`}
        actions={
          <>
            {d.canRevise && <Button variant="secondary" onClick={revise}><FilePlus2 className="size-4" aria-hidden /> New revision</Button>}
            <DocumentActions doc={d} apiBase={G} routeBase={G} queryKey={key} />
          </>
        }
      />
      {error && <Alert>{error}</Alert>}
      <DocStatusAlerts doc={d} approvedNote={d.supersededAt ? `Superseded ${formatDateTime(d.supersededAt)}: do not build to this revision.` : `Released ${formatDateTime(d.releasedAt)}.`} />
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Drawing" value={d.drawingNo} mono />
          <Info label="Item" value={d.item ? `${d.item.code} ${d.item.name}` : "–"} />
          <Info label="Sheet" value={d.sheetSize ?? "–"} />
          <Info label="Change" value={d.changeId ? <Link className="underline" href={`${ENG}/changes/${d.changeId}`}>View change</Link> : "–"} />
        </dl>
        {d.notes && <p className="border-t border-border px-5 py-3 text-sm">{d.notes}</p>}
      </Card>
      <Card>
        <CardHeader title="Revisions" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.revisions.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-2">
              <Link href={`${G}/${r.id}`} className={`font-mono ${r.id === d.id ? "font-semibold" : "text-primary hover:underline"}`}>Rev {r.revision}</Link>
              {r.supersededAt ? <Badge>Superseded</Badge> : <StatusBadge status={r.status as DocumentStatus} />}
              <span className="text-xs text-muted">{r.releasedAt ? `released ${formatDateTime(r.releasedAt)}` : ""}</span>
            </li>
          ))}
        </ul>
      </Card>
      <AttachmentsPanel documentId={d.id} readOnly={d.status === "cancelled" || !!d.supersededAt} />
      <ActivityFeed documentId={d.id} />
    </div>
  );
}
