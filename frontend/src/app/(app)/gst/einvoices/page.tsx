"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/documents";

interface Row {
  id: string;
  docType: "sales_invoice" | "credit_note";
  number: string | null;
  docDate: string;
  customer: string;
  gstin: string | null;
  taxKind: string;
  grandTotal: string;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  irnStatus: string | null;
  irnError: string | null;
}

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  generated: { label: "Registered", tone: "success" },
  pending: { label: "Queued", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default function EInvoicesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState("missing");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["gst", "einvoices", status, from, to],
    queryFn: () => api<{ items: Row[] }>("/gst/einvoices", { query: { status: status || undefined, from, to } }),
    refetchInterval: (x) => (x.state.data?.items.some((r) => r.irnStatus === "pending") ? 3000 : false),
  });
  const rows = q.data?.items ?? [];
  async function bulk() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ queued: number; skipped: { id: string; reason: string }[] }>("/gst/einvoices/bulk", { body: { ids: [...picked] } });
      setMsg({ tone: "success", text: `${r.queued} queued for IRN generation${r.skipped.length ? `; ${r.skipped.length} skipped (${[...new Set(r.skipped.map((s) => s.reason))].join(", ")})` : ""}.` });
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["gst", "einvoices"] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  const href = (r: Row) => (r.docType === "credit_note" ? `/sales/credit-notes/${r.id}` : `/sales/invoices/${r.id}`);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="e-Invoices"
        description="B2B, SEZ and export invoices and credit notes, and their IRN registration on the Invoice Registration Portal."
        actions={can("gst.einvoice.manage") && picked.size > 0 ? <Button loading={busy} onClick={bulk}>Generate {picked.size} IRN{picked.size === 1 ? "" : "s"}</Button> : undefined}
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <div className="grid gap-4 border-b border-border px-5 py-4 sm:grid-cols-4">
          <Field label="Status">
            {(f) => (
              <Select {...f} value={status} onChange={(e) => { setStatus(e.target.value); setPicked(new Set()); }}>
                <option value="missing">Not registered</option>
                <option value="pending">Queued</option>
                <option value="generated">Registered</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
                <option value="">All</option>
              </Select>
            )}
          </Field>
          <Field label="From">{(f) => <Input {...f} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(f) => <Input {...f} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {q.data && !rows.length && <EmptyState title="Nothing here" description={status === "missing" ? "Every approved B2B invoice has an IRN." : "No documents match."} />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={rows.length > 0 && rows.filter((r) => !r.irn).every((r) => picked.has(r.id))}
                      onChange={(e) => setPicked(e.target.checked ? new Set(rows.filter((r) => !r.irn).map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <th className="px-4 py-2.5 font-medium">Document</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 text-right font-medium">Value</th>
                  <th className="px-4 py-2.5 font-medium">IRN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">
                      {!r.irn && <input type="checkbox" aria-label={`Select ${r.number}`} checked={picked.has(r.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={href(r)} className="font-medium text-primary hover:underline">{r.number}</Link>
                      <p className="text-xs text-muted">{r.docType === "credit_note" ? "Credit note" : "Invoice"} · {formatDate(r.docDate)}</p>
                    </td>
                    <td className="px-4 py-3">{r.customer}<p className="font-mono text-xs text-muted">{r.gstin ?? (r.taxKind === "export" ? "Export" : "")}</p></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(r.grandTotal)}</td>
                    <td className="px-4 py-3">
                      {r.irnStatus ? <Badge tone={STATUS[r.irnStatus].tone}>{STATUS[r.irnStatus].label}</Badge> : <Badge>Not registered</Badge>}
                      {r.ackNo && <p className="mt-1 text-xs text-muted">Ack {r.ackNo} · {formatDateTime(r.ackDate)}</p>}
                      {r.irnError && r.irnStatus === "failed" && <p className="mt-1 max-w-sm text-xs text-danger">{r.irnError}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
