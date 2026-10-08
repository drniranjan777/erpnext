"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Mail, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { DataTable } from "@/components/ui/data-table";

interface Delivery {
  id: string;
  event: string;
  channel: "email" | "whatsapp" | "sms" | "in_app";
  recipient: string;
  subject: string | null;
  status: "queued" | "sent" | "failed" | "skipped";
  provider: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

const TONE = { queued: "warning", sent: "success", failed: "danger", skipped: "neutral" } as const;

export default function MessageLogPage() {
  const log = useInfiniteQuery({
    queryKey: ["platform", "message-log"],
    queryFn: ({ pageParam }) => api<{ items: Delivery[]; nextCursor: string | null }>("/platform/message-log", { query: { limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Message log" description="Every email and WhatsApp message the system sent on your behalf, with delivery status. Failed messages are retried automatically." />
      <Card>
        {log.isLoading && <LoadingBlock />}
        {log.error && <div className="p-5"><ErrorBlock error={log.error} /></div>}
        {log.data && !items.length && <EmptyState title="No messages yet" />}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <DataTable
              rows={items}
              hasMore={log.hasNextPage}
              loadingMore={log.isFetchingNextPage}
              onLoadMore={() => void log.fetchNextPage()}
              rowKey={(d) => String(d.id)}
              rowClassName={() => "align-top"}
              exportName="settings-message-log"
              storageKey="settings-message-log-0"
              columns={[
                { key: "when", label: "When", locked: true, className: "text-muted", render: (d) => <>{formatDateTime(d.createdAt)}</> },
                { key: "to", label: "To", className: "whitespace-normal", render: (d) => <><span className="inline-flex items-center gap-1.5">
                                      {d.channel === "email" ? <Mail className="size-3.5 text-muted" aria-label="Email" /> : <MessageCircle className="size-3.5 text-muted" aria-label="WhatsApp" />}
                                      {d.recipient}
                                    </span></> },
                { key: "message", label: "Message", className: "max-w-md whitespace-normal", render: (d) => <><p className="truncate">{d.subject}</p>
                                    <p className="text-xs text-muted">
                                      {d.event} · via {d.provider === "file" ? "dev mailbox (.mail folder)" : d.provider}
                                    </p>
                                    {d.error && <p className="mt-1 text-xs text-danger">{d.error}</p>}</> },
                { key: "status", label: "Status", className: "whitespace-normal", render: (d) => <><Badge tone={TONE[d.status]}>{d.status}</Badge></> },
              ]}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
