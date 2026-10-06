"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleDashed,
  Clock,
  Download,
  FileText,
  MessageSquare,
  Paperclip,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, apiDownload, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  STATUS_META,
  documentKeys,
  formatBytes,
  type ActivityEntry,
  type ApprovalStep,
  type AttachmentInfo,
  type DocumentStatus,
  type Revision,
} from "@/lib/documents";

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const meta = STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** Vertical stepper showing each approval level of the current round. */
export function ApprovalProgress({ steps }: { steps: ApprovalStep[] }) {
  if (!steps.length) return <p className="text-sm text-muted">No approval required for this document.</p>;
  return (
    <ol className="space-y-4">
      {steps.map((s) => {
        const icon =
          s.status === "approved" ? (
            <Check className="size-3.5" />
          ) : s.status === "rejected" ? (
            <X className="size-3.5" />
          ) : s.status === "pending" ? (
            <Clock className="size-3.5" />
          ) : (
            <CircleDashed className="size-3.5" />
          );
        const tone =
          s.status === "approved"
            ? "bg-success-soft text-success"
            : s.status === "rejected"
              ? "bg-danger-soft text-danger"
              : s.status === "pending"
                ? "bg-warning-soft text-warning"
                : "bg-surface-muted text-muted";
        return (
          <li key={s.stepNo} className="flex gap-3">
            <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", tone)} aria-hidden>
              {icon}
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium">
                Level {s.stepNo}: {s.name}
              </p>
              <p className="text-xs text-muted">
                {s.approver.roleName ? `Any ${s.approver.roleName}` : (s.approver.userName ?? "Approver")}
                {s.status === "pending" && " · waiting for decision"}
                {s.status === "skipped" && " · skipped"}
              </p>
              {s.actedBy && (
                <p className="text-xs text-muted">
                  {s.status === "approved" ? "Approved" : "Rejected"} by {s.actedBy} · {formatDateTime(s.actedAt)}
                </p>
              )}
              {s.comment && <p className="mt-1 rounded-md bg-surface-muted px-2 py-1 text-xs">“{s.comment}”</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  comment: <MessageSquare className="size-3.5" />,
  attachment: <Paperclip className="size-3.5" />,
  approved: <Check className="size-3.5" />,
  rejected: <X className="size-3.5" />,
};

export function ActivityFeed({ documentId }: { documentId: string }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const activity = useQuery({ queryKey: documentKeys.activity(documentId), queryFn: () => api<ActivityEntry[]>(`/documents/${documentId}/activity`) });
  const comment = useMutation({
    mutationFn: () => api(`/documents/${documentId}/comments`, { body: { message } }),
    onSuccess: () => {
      setMessage("");
      qc.invalidateQueries({ queryKey: documentKeys.activity(documentId) });
    },
  });

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) comment.mutate();
        }}
      >
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder="Add a comment…"
          aria-label="Comment"
          className="min-h-10 flex-1 resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" variant="secondary" loading={comment.isPending} disabled={!message.trim()} aria-label="Post comment">
          <Send className="size-4" />
        </Button>
      </form>
      {comment.error && <Alert>{(comment.error as Error).message}</Alert>}
      {activity.isLoading && <LoadingBlock />}
      {activity.error && <ErrorBlock error={activity.error} />}
      <ol className="space-y-3">
        {activity.data?.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted" aria-hidden>
              {ACTIVITY_ICON[e.kind] ?? <FileText className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-medium">{e.actor.name ?? "System"}</span>{" "}
                {e.kind === "comment" ? <span className="text-muted">commented</span> : <span>{e.message}</span>}
              </p>
              {e.kind === "comment" && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2">{e.message}</p>}
              {typeof e.data?.comment === "string" && e.data.comment && (
                <p className="mt-1 rounded-lg bg-surface-muted px-3 py-2 text-muted">“{e.data.comment}”</p>
              )}
              {typeof e.data?.reason === "string" && <p className="mt-1 text-xs text-muted">Reason: {e.data.reason}</p>}
              <p className="text-xs text-muted" title={formatDateTime(e.createdAt)}>
                {timeAgo(e.createdAt)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AttachmentsPanel({ documentId, readOnly }: { documentId: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const files = useQuery({ queryKey: documentKeys.attachments(documentId), queryFn: () => api<AttachmentInfo[]>(`/documents/${documentId}/attachments`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: documentKeys.attachments(documentId) });
    qc.invalidateQueries({ queryKey: documentKeys.activity(documentId) });
  };
  const upload = useMutation({ mutationFn: (file: File) => apiUpload(`/documents/${documentId}/attachments`, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api<void>(`/documents/attachments/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const error = upload.error ?? remove.error;

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div>
          <input
            ref={input}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.xls,.xlsx,.doc,.docx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => input.current?.click()}>
            <Upload className="size-3.5" aria-hidden /> Attach file
          </Button>
          <span className="ml-2 text-xs text-muted">PDF, images, Excel, Word, CSV · up to 10 MB</span>
        </div>
      )}
      {error && <Alert>{(error as Error).message}</Alert>}
      {files.isLoading && <LoadingBlock />}
      {files.data?.length === 0 && <EmptyState title="No files attached" description="Attach quotations, drawings or specifications." />}
      <ul className="divide-y divide-border rounded-lg border border-border empty:hidden">
        {files.data?.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
            <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{f.fileName}</p>
              <p className="text-xs text-muted">
                {formatBytes(f.sizeBytes)} · {f.uploadedBy.name ?? "—"} · {timeAgo(f.createdAt)}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => apiDownload(`/documents/attachments/${f.id}/download`, f.fileName)} aria-label={`Download ${f.fileName}`}>
              <Download className="size-4" />
            </Button>
            {!readOnly && f.uploadedBy.id === me?.user.id && (
              <Button
                variant="ghost"
                size="sm"
                loading={remove.isPending && remove.variables === f.id}
                onClick={() => confirm(`Remove ${f.fileName}?`) && remove.mutate(f.id)}
                aria-label={`Remove ${f.fileName}`}
              >
                <Trash2 className="size-4 text-danger" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RevisionsPanel({ documentId, renderSnapshot }: { documentId: string; renderSnapshot: (s: Record<string, unknown>) => React.ReactNode }) {
  const revisions = useQuery({ queryKey: documentKeys.revisions(documentId), queryFn: () => api<Revision[]>(`/documents/${documentId}/revisions`) });
  const [open, setOpen] = useState<number | null>(null);
  if (revisions.isLoading) return <LoadingBlock />;
  if (!revisions.data?.length) return <EmptyState title="No earlier revisions" description="When an approved document is amended, its previous version is kept here." />;
  return (
    <ul className="space-y-2">
      {revisions.data.map((r) => (
        <li key={r.revision} className="rounded-lg border border-border">
          <button className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm" onClick={() => setOpen(open === r.revision ? null : r.revision)}>
            <span>
              <span className="font-medium">Revision {r.revision}</span>
              <span className="text-muted"> · amended by {r.createdBy ?? "—"} on {formatDateTime(r.createdAt)}</span>
            </span>
            {r.reason && <span className="truncate text-xs text-muted">{r.reason}</span>}
          </button>
          {open === r.revision && <div className="border-t border-border p-3">{renderSnapshot(r.snapshot)}</div>}
        </li>
      ))}
    </ul>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            value === t.value ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 text-xs">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
