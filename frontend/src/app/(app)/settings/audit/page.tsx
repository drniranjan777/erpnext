"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";
import { auditActionLabel, describeDevice, type AuditEntry, type AuditPage } from "@/lib/audit";

interface Filters {
  entityType: string;
  from: string;
  to: string;
}

export default function AuditPage() {
  const [filters, setFilters] = useState<Filters>({ entityType: "", from: "", to: "" });
  const [open, setOpen] = useState<string | null>(null);

  const entityTypes = useQuery({
    queryKey: ["audit", "entity-types"],
    queryFn: () => api<string[]>("/platform/audit-logs/entity-types"),
  });
  const logs = useInfiniteQuery({
    queryKey: ["audit", "logs", filters],
    queryFn: ({ pageParam }) =>
      api<AuditPage>("/platform/audit-logs", { query: { ...filters, limit: 50, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = logs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Audit trail" description="Every change in this workspace: who, what, when and from where. Entries can't be edited or deleted." />

      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Record type">
            {(p) => (
              <Select {...p} value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
                <option value="">All</option>
                {entityTypes.data?.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From">
            {(p) => <Input {...p} type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />}
          </Field>
          <Field label="To">
            {(p) => <Input {...p} type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />}
          </Field>
        </div>
      </Card>

      <Card>
        {logs.isLoading && <LoadingBlock />}
        {logs.error && <div className="p-5"><ErrorBlock error={logs.error} /></div>}
        {logs.data && items.length === 0 && <EmptyState title="No activity found" description="Try widening the filters." />}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <th className="px-3 py-2.5 font-medium">When (IST)</th>
                  <th className="px-3 py-2.5 font-medium">Who</th>
                  <th className="px-3 py-2.5 font-medium">What</th>
                  <th className="px-3 py-2.5 font-medium">Record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((e) => {
                  const expanded = open === e.id;
                  return (
                    <Fragment key={e.id}>
                      <tr className="cursor-pointer hover:bg-surface-muted/60" onClick={() => setOpen(expanded ? null : e.id)}>
                        <td className="px-3 py-3 text-muted">
                          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{formatDateTime(e.createdAt)}</td>
                        <td className="px-3 py-3">{e.actor.fullName ?? e.actor.email ?? "System"}</td>
                        <td className="px-3 py-3">{auditActionLabel(e.action)}</td>
                        <td className="px-3 py-3">
                          <Badge>{e.entityType}</Badge>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-surface-muted/40">
                          <td />
                          <td colSpan={4} className="px-3 pb-4 pt-1">
                            <EntryDetails entry={e} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {logs.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="secondary" size="sm" loading={logs.isFetchingNextPage} onClick={() => logs.fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function show(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function EntryDetails({ entry }: { entry: AuditEntry }) {
  const changes = Object.entries(entry.changes ?? {});
  return (
    <div className="space-y-3 text-xs">
      {changes.length > 0 && (
        <div className="overflow-x-auto"><table className="w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-surface">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-3 py-1.5 font-medium">Field</th>
              <th className="px-3 py-1.5 font-medium">Before</th>
              <th className="px-3 py-1.5 font-medium">After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {changes.map(([field, c]) => (
              <tr key={field}>
                <td className="px-3 py-1.5 font-medium">{field}</td>
                <td className="px-3 py-1.5 text-danger">{show(c.from)}</td>
                <td className="px-3 py-1.5 text-success">{show(c.to)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <dl className="grid gap-x-6 gap-y-1 text-muted sm:grid-cols-2">
        <div><dt className="inline">Action code: </dt><dd className="inline font-mono">{entry.action}</dd></div>
        {entry.entityId && <div><dt className="inline">Record ID: </dt><dd className="inline font-mono">{entry.entityId}</dd></div>}
        {entry.ip && <div><dt className="inline">IP address: </dt><dd className="inline font-mono">{entry.ip}</dd></div>}
        {entry.userAgent && <div><dt className="inline">Device: </dt><dd className="inline">{describeDevice(entry.userAgent)}</dd></div>}
        {entry.metadata && <div className="sm:col-span-2"><dt className="inline">Details: </dt><dd className="inline font-mono break-all">{JSON.stringify(entry.metadata)}</dd></div>}
        {entry.requestId && <div className="sm:col-span-2"><dt className="inline">Request ID: </dt><dd className="inline font-mono">{entry.requestId}</dd></div>}
      </dl>
    </div>
  );
}
