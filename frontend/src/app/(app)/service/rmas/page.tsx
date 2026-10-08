"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { askText } from "@/components/ui/ask";

interface Rma { id: string; number: string; serialNo: string | null; reason: string; underWarranty: boolean; status: string; diagnosis: string | null; replacementSerial: string | null; dispatchRef: string | null; createdAt: string; customer: string; itemCode: string; itemName: string; ticketNumber: string | null }
const NEXT: Record<string, { step: string; label: string; ask?: "diagnosis" | "replacementSerial" | "dispatchRef" }[]> = {
  authorised: [{ step: "receive", label: "Received" }, { step: "reject", label: "Reject" }],
  received: [{ step: "repair", label: "Start repair", ask: "diagnosis" }, { step: "replaced", label: "Replace", ask: "replacementSerial" }, { step: "reject", label: "Reject" }],
  repairing: [{ step: "repaired", label: "Repaired" }, { step: "replaced", label: "Replace instead", ask: "replacementSerial" }, { step: "reject", label: "Reject" }],
  repaired: [{ step: "return", label: "Send back", ask: "dispatchRef" }],
  replaced: [{ step: "return", label: "Send back", ask: "dispatchRef" }],
};
const ASK = { diagnosis: "What is wrong?", replacementSerial: "Serial number of the replacement", dispatchRef: "Dispatch reference (DC / courier)" };

export default function RmaPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["/service", "rmas", status], queryFn: () => api<Rma[]>("/service/rmas", { query: { status: status || undefined } }) });
  async function step(r: Rma, s: { step: string; ask?: keyof typeof ASK }) {
    const extra: Record<string, string> = {};
    if (s.ask) {
      const v = await askText(ASK[s.ask]);
      if (!v) return;
      extra[s.ask] = v;
    }
    setError(null);
    try {
      await api(`/service/rmas/${r.id}/step`, { body: { step: s.step, ...extra } });
      qc.invalidateQueries({ queryKey: ["/service"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Returns for repair (RMA)" description="Units the customer sends back: received, repaired or replaced (a replacement carries the remaining warranty), and returned." />
      <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{["authorised", "received", "repairing", "repaired", "replaced", "returned", "rejected"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="font-mono text-xs text-muted">{r.number}</span>
                <span className="font-medium">{r.customer}</span>
                <span className="text-xs">{r.itemCode} {r.serialNo}{r.replacementSerial && ` → ${r.replacementSerial}`}</span>
                <span className="text-xs text-muted">{r.reason}{r.diagnosis && ` · ${r.diagnosis}`}{r.dispatchRef && ` · sent ${r.dispatchRef}`} · {formatDate(r.createdAt.slice(0, 10))}</span>
                {r.underWarranty && <Badge tone="success">warranty</Badge>}
                <Badge tone={r.status === "returned" ? "success" : r.status === "rejected" ? "danger" : "primary"} className="ml-auto">{r.status}</Badge>
                {can("service.contracts.manage") && NEXT[r.status]?.map((s) => <Button key={s.step} size="sm" variant={s.step === "reject" ? "ghost" : "secondary"} onClick={() => step(r, s)}>{s.label}</Button>)}
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">No returns. Authorise one from a ticket.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}
