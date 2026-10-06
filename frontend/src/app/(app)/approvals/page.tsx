"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, timeAgo } from "@/components/ui/page";
import { api } from "@/lib/api";
import { documentKeys, formatDate, formatMoney, type InboxItem } from "@/lib/documents";

export default function ApprovalsPage() {
  const inbox = useQuery({ queryKey: documentKeys.inbox, queryFn: () => api<InboxItem[]>("/documents/approvals/inbox"), refetchInterval: 60_000 });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Approvals" description="Documents waiting for your decision. Oldest first." />
      <Card>
        {inbox.isLoading && <LoadingBlock />}
        {inbox.error && <div className="p-5"><ErrorBlock error={inbox.error} /></div>}
        {inbox.data?.length === 0 && (
          <div className="flex flex-col items-center">
            <CheckCircle2 className="mt-10 size-8 text-success" aria-hidden />
            <EmptyState title="You're all caught up" description="Nothing is waiting for your approval right now." />
          </div>
        )}
        <ul className="divide-y divide-border">
          {inbox.data?.map((d) => (
            <li key={`${d.documentId}-${d.stepNo}`}>
              <Link href={d.path ?? "#"} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface-muted/60">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted">
                    {d.docTypeLabel} · Level {d.stepNo}: {d.stepName}
                  </p>
                  <p className="font-medium">
                    <span className="text-primary">{d.number}</span> · {d.title}
                  </p>
                  <p className="text-xs text-muted">
                    Submitted by {d.submittedBy ?? "—"} {timeAgo(d.submittedAt).toLowerCase()} · dated {formatDate(d.docDate)}
                  </p>
                </div>
                <p className="text-right font-medium tabular-nums">{formatMoney(d.amount, d.currency)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
