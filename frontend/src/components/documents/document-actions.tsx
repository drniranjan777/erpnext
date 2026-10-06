"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, FilePenLine, Pencil, Printer, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { documentKeys, type DocumentHeader } from "@/lib/documents";

type Action = "submit" | "approve" | "reject" | "cancel" | "amend" | "delete";

interface Props {
  doc: DocumentHeader;
  /** Module API base, e.g. "/purchase/requisitions". */
  apiBase: string;
  /** Frontend base route, e.g. "/purchase/requisitions". */
  routeBase: string;
  printHref?: string;
  /** Query key of the document detail, refreshed after every action. */
  queryKey: readonly unknown[];
  /** Documents edited in place (e.g. a count sheet) have no separate edit page. */
  hideEdit?: boolean;
}

const PROMPTS: Partial<Record<Action, { title: string; label: string; required: boolean; confirm: string; danger?: boolean }>> = {
  approve: { title: "Approve", label: "Comment (optional)", required: false, confirm: "Approve" },
  reject: { title: "Reject", label: "Reason for rejection", required: true, confirm: "Reject", danger: true },
  cancel: { title: "Cancel document", label: "Reason for cancelling", required: true, confirm: "Cancel document", danger: true },
  amend: { title: "Amend approved document", label: "What needs to change?", required: true, confirm: "Start amendment" },
};

/** Workflow buttons shown on every document; visibility comes from `doc.can` (server-computed). */
export function DocumentActions({ doc, apiBase, routeBase, printHref, queryKey, hideEdit }: Props) {
  const qc = useQueryClient();
  const router = useRouter();
  const [prompt, setPrompt] = useState<Action | null>(null);
  const [text, setText] = useState("");

  const run = useMutation({
    mutationFn: async ({ action, text }: { action: Action; text?: string }) => {
      const v = doc.version;
      switch (action) {
        case "submit":
          return api(`${apiBase}/${doc.id}/submit`, { body: { version: v } });
        case "approve":
          return api(`/documents/${doc.id}/approve`, { body: { version: v, comment: text || undefined } });
        case "reject":
          return api(`/documents/${doc.id}/reject`, { body: { version: v, comment: text } });
        case "cancel":
          return api(`${apiBase}/${doc.id}/cancel`, { body: { version: v, reason: text } });
        case "amend":
          return api(`${apiBase}/${doc.id}/amend`, { body: { version: v, reason: text } });
        case "delete":
          return api(`${apiBase}/${doc.id}`, { method: "DELETE", query: { version: v } });
      }
    },
    onSuccess: (_d, { action }) => {
      setPrompt(null);
      setText("");
      qc.invalidateQueries({ queryKey: documentKeys.inbox });
      qc.invalidateQueries({ queryKey: documentKeys.activity(doc.id) });
      if (action === "delete") {
        qc.removeQueries({ queryKey });
        router.replace(routeBase);
        return;
      }
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: [routeBase] });
      if (action === "amend") router.push(`${routeBase}/${doc.id}/edit`);
    },
  });

  const conflict = run.error instanceof ApiError && run.error.status === 409;
  const p = prompt ? PROMPTS[prompt] : undefined;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {doc.can.approve && (
          <Button onClick={() => setPrompt("approve")}>
            <Check className="size-4" aria-hidden /> Approve
          </Button>
        )}
        {doc.can.reject && (
          <Button variant="secondary" onClick={() => setPrompt("reject")}>
            <X className="size-4 text-danger" aria-hidden /> Reject
          </Button>
        )}
        {doc.can.submit && (
          <Button loading={run.isPending && run.variables?.action === "submit"} onClick={() => run.mutate({ action: "submit" })}>
            <Send className="size-4" aria-hidden /> Submit
          </Button>
        )}
        {doc.can.edit && !hideEdit && (
          <Link href={`${routeBase}/${doc.id}/edit`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
            <Pencil className="size-4" aria-hidden /> Edit
          </Link>
        )}
        {doc.can.amend && (
          <Button variant="secondary" onClick={() => setPrompt("amend")}>
            <FilePenLine className="size-4" aria-hidden /> Amend
          </Button>
        )}
        {printHref && doc.number && (
          <Link href={printHref} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
            <Printer className="size-4" aria-hidden /> Print
          </Link>
        )}
        {doc.can.cancel && (
          <Button variant="ghost" onClick={() => setPrompt("cancel")}>
            <Ban className="size-4 text-danger" aria-hidden /> Cancel
          </Button>
        )}
        {doc.can.delete && (
          <Button
            variant="ghost"
            loading={run.isPending && run.variables?.action === "delete"}
            onClick={() => confirm("Delete this draft? This can't be undone.") && run.mutate({ action: "delete" })}
          >
            <Trash2 className="size-4 text-danger" aria-hidden /> Delete draft
          </Button>
        )}
      </div>
      {run.error && !prompt && (
        <div className="mt-3">
          <Alert>
            {(run.error as Error).message}
            {conflict && (
              <button className="ml-2 font-medium underline" onClick={() => qc.invalidateQueries({ queryKey })}>
                Reload
              </button>
            )}
          </Alert>
        </div>
      )}

      {prompt && p && (
        <Dialog
          open
          onClose={() => {
            setPrompt(null);
            run.reset();
          }}
          title={`${p.title}: ${doc.displayNumber}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPrompt(null)}>
                Back
              </Button>
              <Button
                variant={p.danger ? "danger" : "primary"}
                loading={run.isPending}
                disabled={p.required && text.trim().length < 3}
                onClick={() => run.mutate({ action: prompt, text: text.trim() })}
              >
                {p.confirm}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {run.error && <Alert>{(run.error as Error).message}</Alert>}
            <Field label={p.label} required={p.required}>
              {(fp) => (
                <textarea
                  {...fp}
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </Field>
            {prompt === "amend" && (
              <p className="text-xs text-muted">The current version is saved as a revision. The document goes back to draft and must be approved again.</p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
