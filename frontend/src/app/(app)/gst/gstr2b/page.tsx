"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";

interface Line { id: string; section: string; ctin: string | null; tradeName: string | null; docType: string; docNo: string; docDate: string; taxable: string; igst: string; cgst: string; sgst: string; cess: string; itcAvailable: boolean; status: string; purchaseInvoiceId: string | null; difference: string | null; action: string | null }
interface Recon {
  importedAt: string | null;
  summary: { lines: number; matched: number; mismatch: number; missingInBooks: number; missingIn2b: number; itcIn2b: string; itcAtRisk: string; matchRate: number | null };
  lines: Line[];
  missingIn2b: { id: string; number: string | null; vendor: string; gstin: string; no: string; date: string; itc: string }[];
}

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { matched: "success", mismatch: "warning", missing_in_books: "danger", unmatched_note: "neutral" };
const LABEL: Record<string, string> = { matched: "Matched", mismatch: "Amounts differ", missing_in_books: "Not in books", unmatched_note: "Note" };

export default function Gstr2bPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [period, setPeriod] = useState(todayIST().slice(0, 7));
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["gst", "gstr2b", period], queryFn: () => api<Recon>("/gst/gstr2b", { query: { period } }) });
  async function upload(f: File) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiUpload<Recon & { period: string }>("/gst/gstr2b", f);
      setPeriod(r.period);
      setMsg({ tone: "success", text: `${r.summary.lines} documents imported: ${r.summary.matched} matched, ${r.summary.mismatch} with differences, ${r.summary.missingInBooks} not in the books.` });
      qc.invalidateQueries({ queryKey: ["gst", "gstr2b"] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  async function act(id: string, action: string) {
    await api(`/gst/gstr2b/lines/${id}`, { method: "PUT", body: { action: action || null } });
    qc.invalidateQueries({ queryKey: ["gst", "gstr2b"] });
  }
  const d = q.data;
  const lines = (d?.lines ?? []).filter((l) => !filter || l.status === filter);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="GSTR-2B reconciliation"
        description="Upload the GSTR-2B JSON from the GST portal. Each document is matched with your bills by vendor GSTIN and invoice number; claim ITC only on what is matched."
        actions={can("accounting.tax.manage") ? (<><input ref={file} type="file" className="hidden" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /><Button loading={busy} onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Upload GSTR-2B</Button></>) : undefined}
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <Field label="Return period">{(f) => <Input {...f} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />}</Field>
          {d?.importedAt && <p className="pb-2 text-sm text-muted">Imported {formatDateTime(d.importedAt)}</p>}
        </div>
        {d && (
          <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div><dt className="text-xs text-muted">Documents in 2B</dt><dd className="tabular-nums">{d.summary.lines}</dd></div>
            <div><dt className="text-xs text-muted">Matched</dt><dd className="tabular-nums">{d.summary.matched}{d.summary.matchRate !== null && ` (${d.summary.matchRate}%)`}</dd></div>
            <div><dt className="text-xs text-muted">Amounts differ</dt><dd className="tabular-nums">{d.summary.mismatch}</dd></div>
            <div><dt className="text-xs text-muted">In 2B, not in books</dt><dd className="tabular-nums">{d.summary.missingInBooks}</dd></div>
            <div><dt className="text-xs text-muted">ITC in 2B</dt><dd className="tabular-nums">{formatMoney(d.summary.itcIn2b)}</dd></div>
            <div><dt className="text-xs text-muted">ITC at risk (bills not in 2B)</dt><dd className={`tabular-nums ${Number(d.summary.itcAtRisk) ? "text-danger" : ""}`}>{formatMoney(d.summary.itcAtRisk)}</dd></div>
          </dl>
        )}
      </Card>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {d && (
        <Card>
          <CardHeader
            title="Documents in GSTR-2B"
            action={<Select className="h-9 w-44" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All</option><option value="matched">Matched</option><option value="mismatch">Amounts differ</option><option value="missing_in_books">Not in books</option></Select>}
          />
          {!lines.length ? (
            <EmptyState title="Nothing here" description={d.summary.lines ? "No documents with this status." : "Upload the month's GSTR-2B to start."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-t border-border text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Supplier</th><th className="px-4 py-2 font-medium">Document</th><th className="px-4 py-2 text-right font-medium">Taxable</th><th className="px-4 py-2 text-right font-medium">Tax</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Action</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2">{l.tradeName}<span className="block font-mono text-xs text-muted">{l.ctin}</span></td>
                      <td className="px-4 py-2"><span className="font-mono">{l.docNo}</span> <span className="text-xs text-muted">{l.docType} · {formatDate(l.docDate)}</span>{!l.itcAvailable && <Badge tone="danger" className="ml-1">ITC not available</Badge>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(l.taxable)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(Number(l.igst) + Number(l.cgst) + Number(l.sgst) + Number(l.cess))}</td>
                      <td className="px-4 py-2"><Badge tone={TONE[l.status] ?? "neutral"}>{LABEL[l.status] ?? l.status}</Badge>{l.difference && <span className="block text-xs text-muted">{l.difference}</span>}{l.purchaseInvoiceId && <Link href={`/purchase/invoices/${l.purchaseInvoiceId}`} className="block text-xs text-primary hover:underline">Open bill</Link>}</td>
                      <td className="px-4 py-2">
                        {l.status !== "matched" && can("accounting.tax.manage") && (
                          <Select className="h-8 w-36" aria-label={`Action for ${l.docNo}`} value={l.action ?? ""} onChange={(e) => act(l.id, e.target.value)}>
                            <option value="">—</option>
                            <option value="accept">Accept</option>
                            <option value="follow_up">Follow up</option>
                            <option value="defer">Defer ITC</option>
                          </Select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {!!d?.missingIn2b.length && (
        <Card>
          <CardHeader title="Bills in the books but not in GSTR-2B" description="The vendor has not filed these (or filed them wrong): ITC on them is at risk until they appear." />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {d.missingIn2b.map((b) => (
              <li key={b.id} className="flex flex-wrap justify-between gap-3 px-5 py-2"><span>{b.vendor} <span className="font-mono text-xs text-muted">{b.gstin}</span></span><Link href={`/purchase/invoices/${b.id}`} className="font-mono text-primary hover:underline">{b.no}</Link><span className="text-muted">{formatDate(b.date)}</span><span className="tabular-nums">ITC {formatMoney(b.itc)}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
