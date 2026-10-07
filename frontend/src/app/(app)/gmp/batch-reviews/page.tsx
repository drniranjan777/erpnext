"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";

interface Row { id: string; workOrderId: string; workOrderNumber: string; itemCode: string; itemName: string; batchNo: string | null; status: string; exceptions: number; commented: number; createdAt: string; decidedAt: string | null; decidedBy: string | null }
interface WorkOrder { id: string; number: string | null; item: { name: string }; stage: string }

const TONE: Record<string, "warning" | "success" | "danger"> = { open: "warning", approved: "success", rejected: "danger" };

/** Batch record reviews: QA looks only at what went differently (the exceptions) and signs the decision. */
export default function BatchReviewsPage() {
  const router = useRouter();
  const [status, setStatus] = useState("open");
  const [wo, setWo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["/gmp/batch-reviews", status], queryFn: () => api<Row[]>("/gmp/batch-reviews", { query: status ? { status } : {} }) });
  const wos = useQuery({ queryKey: ["/manufacturing/work-orders", "review"], queryFn: () => api<{ items: WorkOrder[] }>("/manufacturing/work-orders", { query: { limit: 100 } }) });
  async function open() {
    setError(null);
    try {
      const r = await api<{ id: string }>("/gmp/batch-reviews", { body: { workOrderId: wo } });
      router.push(`/gmp/batch-reviews/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Batch record review" description="Review by exception: the electronic batch record lists only what needs a reviewer — failed or warned start checks, first-off and in-line results, recipe parameters out of limits, rejects, machine alarms, deviations, missing line clearance, open inspections. Each is assessed, then QA signs the decision." />
      {error && <Alert>{error}</Alert>}
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <Select className="h-9 flex-1" aria-label="Work order" value={wo} onChange={(e) => setWo(e.target.value)}><option value="">Review a batch…</option>{wos.data?.items.filter((w) => w.number).map((w) => <option key={w.id} value={w.id}>{w.number} · {w.item.name} ({w.stage.replace("_", " ")})</option>)}</Select>
        <Button disabled={!wo} onClick={open}>Open review</Button>
        <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></Select>
      </Card>
      <Card>
        <ul className="divide-y divide-border text-sm">
          {list.data?.map((r) => (
            <li key={r.id}>
              <Link href={`/gmp/batch-reviews/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-surface-muted">
                <Badge tone={TONE[r.status]}>{r.status}</Badge>
                <span className="font-medium">{r.workOrderNumber}</span>
                <span>{r.itemCode} · {r.itemName}{r.batchNo ? ` · batch ${r.batchNo}` : ""}</span>
                <span className="ml-auto text-xs text-muted">{r.exceptions} exception(s), {r.commented} assessed{r.decidedAt ? ` · ${r.decidedBy} ${formatDateTime(r.decidedAt)}` : ""}</span>
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-8 text-center text-muted">Nothing here.</li>}
        </ul>
      </Card>
    </div>
  );
}
