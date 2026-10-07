"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError, apiUpload } from "@/lib/api";

interface Row { id: string; kind: string; fileName: string | null; source: string; confidence: string | null; status: string; lines: number; warnings: number; createdAt: string; createdBy: string | null }
interface Capture { id: string; kind: string; source: string; confidence: string | null; status: string; fields: Record<string, unknown>; lines: Record<string, unknown>[]; matches: Record<string, unknown>; warnings: string[]; result: Record<string, unknown> | null }

const KIND: Record<string, string> = { delivery_challan: "Delivery challan", eway_bill: "E-way bill", coa: "Certificate of analysis", quotation: "Vendor quotation", bank_statement: "Bank statement", invoice: "Supplier bill", unknown: "Not recognised" };
const human = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** Read challans, e-way bills, CoAs, quotations and bank statements; check what was read and apply it. */
export default function DocumentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("review");
  const [text, setText] = useState("");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ["/docai", status], queryFn: () => api<Row[]>("/docai/captures", { query: { status } }) });
  const cap = useQuery({ queryKey: ["/docai", "one", open], queryFn: () => api<Capture>(`/docai/captures/${open}`), enabled: !!open });
  async function run(fn: () => Promise<{ id?: string } | unknown>, done: string) {
    setMsg(null);
    setBusy(true);
    try {
      const r = (await fn()) as { id?: string };
      setMsg({ tone: "success", text: done });
      if (r?.id && done.startsWith("Read")) setOpen(r.id);
      qc.invalidateQueries({ queryKey: ["/docai"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  const c = cap.data;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Document AI" description="Paste or upload a delivery challan, e-way bill, certificate of analysis, vendor quotation or bank statement. Text is read directly; scans, photos and handwriting need an AI key. Supplier bills go through Purchase → bill capture." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Read a document" />
        <div className="space-y-2 border-t border-border p-4">
          <textarea aria-label="Document text" rows={6} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" placeholder="Paste the document text here" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Select className="h-9 w-56" aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Detect the type</option>{Object.entries(KIND).filter(([k]) => !["invoice", "unknown"].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Button disabled={text.trim().length < 10} loading={busy} onClick={() => run(() => api("/docai/read-text", { body: { text, kind: kind || undefined } }), "Read.").then(() => setText(""))}><FileText className="size-4" aria-hidden /> Read text</Button>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted">
              <Upload className="size-4" aria-hidden /> Upload file
              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => apiUpload("/docai/read-file", f, kind ? { kind } : {}), "Read."); e.target.value = ""; }} />
            </label>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-[1fr_1.5fr]">
        <Card>
          <div className="border-b border-border p-3"><Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="review">To review</option><option value="applied">Applied</option><option value="discarded">Discarded</option></Select></div>
          <ul className="divide-y divide-border text-sm">
            {list.data?.map((r) => (
              <li key={r.id}>
                <button type="button" className={`w-full px-4 py-2 text-left hover:bg-surface-muted ${open === r.id ? "bg-surface-muted" : ""}`} onClick={() => setOpen(r.id)}>
                  <p className="font-medium">{KIND[r.kind] ?? r.kind}{r.warnings ? <Badge tone="warning" className="ml-2">{r.warnings} note(s)</Badge> : null}</p>
                  <p className="text-xs text-muted">{r.fileName ?? "pasted text"} · {r.source === "ai" ? "read by AI" : "text"} · {timeAgo(r.createdAt)}</p>
                </button>
              </li>
            ))}
            {list.data && !list.data.length && <li className="px-4 py-6 text-center text-muted">Nothing here.</li>}
          </ul>
        </Card>
        {c && (
          <Card>
            <CardHeader title={KIND[c.kind] ?? c.kind} description={`Confidence ${c.confidence ? Math.round(Number(c.confidence) * 100) : "–"} %`} action={c.status === "review" && <span className="flex gap-2">{["quotation", "coa"].includes(c.kind) && <Button size="sm" onClick={() => run(() => api(`/docai/captures/${c.id}/apply`, { body: {} }), c.kind === "quotation" ? "Vendor prices updated." : "CoA attached to the inspection.")}>Apply</Button>}<Button size="sm" variant="ghost" onClick={() => run(() => api(`/docai/captures/${c.id}/discard`, { body: {} }), "Discarded.")}>Discard</Button></span>} />
            <div className="space-y-3 border-t border-border p-4 text-sm">
              {c.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">{Object.entries(c.fields).filter(([, v]) => v !== null && v !== "").map(([k, v]) => <div key={k}><dt className="inline text-muted">{human(k)}: </dt><dd className="inline font-medium">{String(v)}</dd></div>)}</dl>
              {Object.keys(c.matches).filter((k) => k !== "items" && k !== "checks").length > 0 && (
                <p className="text-xs">Matched: {Object.entries(c.matches).filter(([k]) => k !== "items" && k !== "checks").map(([k, v]) => `${human(k)} → ${Array.isArray(v) ? v.map((x) => (x as { number?: string }).number).join(", ") : ((v as { name?: string; number?: string }).name ?? (v as { number?: string }).number)}`).join("; ")}</p>
              )}
              {c.lines.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted"><tr>{Object.keys(c.lines[0]).map((k) => <th key={k} className="py-1 pr-2">{human(k)}</th>)}{Array.isArray(c.matches.items) && <th>Item</th>}</tr></thead>
                  <tbody className="divide-y divide-border">
                    {c.lines.map((l, i) => (
                      <tr key={i}>
                        {Object.values(l).map((v, j) => <td key={j} className={`py-1 pr-2 ${v === false ? "text-danger" : ""}`}>{v === true ? "✓" : v === false ? "✗" : v === null ? "–" : String(v)}</td>)}
                        {Array.isArray(c.matches.items) && <td className="py-1">{(c.matches.items as ({ code: string } | null)[])[i]?.code ?? "–"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {c.result && <p className="text-xs text-success">Applied: {JSON.stringify(c.result)}</p>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
