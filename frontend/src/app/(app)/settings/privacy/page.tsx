"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api } from "@/lib/api";

interface Row {
  request: { id: string; type: string; details: string; status: "open" | "completed" | "rejected"; resolution: string | null; createdAt: string; resolvedAt: string | null };
  user: { name: string | null; email: string | null };
}

export default function PrivacyRequestsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["privacy", "requests"], queryFn: () => api<Row[]>("/platform/data-requests") });
  const [resolving, setResolving] = useState<{ row: Row; status: "completed" | "rejected" } | null>(null);
  const [resolution, setResolution] = useState("");
  const resolve = useMutation({
    mutationFn: () => api(`/platform/data-requests/${resolving!.row.request.id}`, { method: "PATCH", body: { status: resolving!.status, resolution } }),
    onSuccess: () => {
      setResolving(null);
      setResolution("");
      qc.invalidateQueries({ queryKey: ["privacy"] });
    },
  });
  const open = list.data?.filter((r) => r.request.status === "open").length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Data protection requests"
        description="Correction, erasure and grievance requests from people in your workspace under the DPDP Act, 2023. Respond promptly and record the outcome."
      />
      {open > 0 && <Alert tone="warning">{open} open request(s) need a response.</Alert>}
      <Card>
        {list.isLoading && <LoadingBlock />}
        {list.error && <div className="p-5"><ErrorBlock error={list.error} /></div>}
        {list.data?.length === 0 && <EmptyState title="No requests" description="When someone raises a request from My account, it appears here." />}
        <ul className="divide-y divide-border">
          {list.data?.map((r) => (
            <li key={r.request.id} className="px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium capitalize">{r.request.type}</span>
                <Badge tone={r.request.status === "open" ? "warning" : r.request.status === "completed" ? "success" : "danger"}>{r.request.status}</Badge>
                <span className="text-muted">
                  {r.user.name} · {r.user.email}
                </span>
                <span className="ml-auto text-xs text-muted">{formatDateTime(r.request.createdAt)}</span>
              </div>
              <p className="mt-1">{r.request.details}</p>
              {r.request.resolution && <p className="mt-1 text-muted">Response: {r.request.resolution}</p>}
              {r.request.status === "open" && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => setResolving({ row: r, status: "completed" })}>
                    Mark completed
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setResolving({ row: r, status: "rejected" })}>
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {resolving && (
        <Dialog
          open
          onClose={() => setResolving(null)}
          title={resolving.status === "completed" ? "Complete request" : "Reject request"}
          description="The requester is notified with your response."
          footer={
            <>
              <Button variant="secondary" onClick={() => setResolving(null)}>
                Cancel
              </Button>
              <Button variant={resolving.status === "rejected" ? "danger" : "primary"} loading={resolve.isPending} disabled={resolution.trim().length < 5} onClick={() => resolve.mutate()}>
                Send response
              </Button>
            </>
          }
        >
          {resolve.error && <Alert>{(resolve.error as Error).message}</Alert>}
          <Field label="Response to the person" required>
            {(p) => (
              <textarea
                {...p}
                rows={4}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
          </Field>
        </Dialog>
      )}
    </div>
  );
}
