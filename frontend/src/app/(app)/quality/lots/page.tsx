"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { LOT_STATUS, QA, type LotStatus } from "@/lib/quality";

interface Lot { id: string; item: { id: string; code: string; name: string; uom: string }; batchNo: string; status: LotStatus; note: string | null; updatedAt: string | null; expiryDate: string | null; stock: string }
interface Signature { id: string; meaning: string; reason: string | null; signedAt: string; signedBy: string; email: string; payload: { from?: string; to?: string } }

export default function LotsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: [QA, "lots", status, search], queryFn: () => api<{ total: number; items: Lot[] }>(`${QA}/lots`, { query: { status: status || undefined, q: search || undefined, limit: 100 } }) });
  const [sign, setSign] = useState<Lot | null>(null);
  const [history, setHistory] = useState<Lot | null>(null);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Lot status" description="Lots on hold, under test, conditionally released or rejected. Held lots cannot be issued, consumed or sold until QA releases them; every change of status is signed electronically." />
      <div className="flex flex-wrap gap-3">
        <Input className="h-9 w-64" placeholder="Batch, item code or name" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="h-9 w-56" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Not released</option>
          {Object.entries(LOT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Lot</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 text-right font-medium">In stock</th><th className="px-4 py-2 font-medium">Expiry</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2"><span className="font-mono font-medium">{l.batchNo}</span><span className="block text-xs text-muted">{l.item.code} {l.item.name}</span></td>
                  <td className="px-4 py-2"><Badge tone={LOT_STATUS[l.status].tone}>{LOT_STATUS[l.status].label}</Badge>{l.note && <span className="block text-xs text-muted">{l.note}{l.updatedAt && ` · ${formatDateTime(l.updatedAt)}`}</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.stock)} {l.item.uom}</td>
                  <td className="px-4 py-2">{l.expiryDate ? formatDate(l.expiryDate) : "–"}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setHistory(l)}>Signatures</Button>
                    {can("quality.release.sign") && <Button size="sm" variant="secondary" onClick={() => setSign(l)}><PenLine className="size-4" aria-hidden /> Change status</Button>}
                  </td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No lots in this status.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
      {sign && <SignDialog lot={sign} onClose={() => setSign(null)} />}
      {history && <HistoryDialog lot={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function SignDialog({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [f, setF] = useState({ status: lot.status === "released" ? "quarantine" : "released", reason: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api(`${QA}/lots/status`, { body: { itemId: lot.item.id, batchNo: lot.batchNo, ...f } });
      qc.invalidateQueries({ queryKey: [QA, "lots"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Lot ${lot.batchNo}`} description={`${lot.item.code} ${lot.item.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy} disabled={!f.password || f.reason.trim().length < 3}>Sign</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="New status">{(p) => <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(LOT_STATUS).filter(([k]) => k !== lot.status).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>}</Field>
        <Field label="Reason" required>{(p) => <Input {...p} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
        <Field label="Your password" required hint={`Signing as ${me?.user.fullName ?? "you"}. Your signature, its meaning and the time are recorded and cannot be changed.`}>{(p) => <Input {...p} type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ lot, onClose }: { lot: Lot; onClose: () => void }) {
  const q = useQuery({ queryKey: [QA, "signatures", lot.id], queryFn: () => api<Signature[]>(`${QA}/signatures/${lot.id}`) });
  return (
    <Dialog open onClose={onClose} title={`Signatures: ${lot.batchNo}`} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {q.isLoading && <LoadingBlock />}
      {q.data && !q.data.length && <p className="text-sm text-muted">No signed changes yet. Inspections release or reject lots on their own approval.</p>}
      <ul className="space-y-3 text-sm">
        {q.data?.map((s) => (
          <li key={s.id} className="rounded-lg border border-border p-3">
            <p className="font-medium">{s.meaning}</p>
            <p className="text-muted">{s.signedBy} ({s.email}) · {formatDateTime(s.signedAt)}</p>
            <p>{s.payload.from && `${LOT_STATUS[s.payload.from as LotStatus]?.label ?? s.payload.from} → `}{LOT_STATUS[s.payload.to as LotStatus]?.label ?? s.payload.to}{s.reason && `: ${s.reason}`}</p>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
