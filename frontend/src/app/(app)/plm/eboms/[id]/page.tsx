"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ESignDialog } from "@/components/esign-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { PageHeader, ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Ebom {
  id: string; itemId: string; item: string | null; revision: string; status: string; mbomId: string | null;
  lines: { findNo: number; itemId: string; item: string; qty: number; refDes?: string | null }[];
  comparison: { matches: boolean; onlyDesign: { item: string; qty: number }[]; onlyManufacturing: { item: string; qty: number }[]; qtyDiffers: { item: string; design: number; manufacturing: number }[] } | null;
}

/** An engineering BOM revision against the manufacturing BOM. */
export default function EbomPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["/plm/eboms", id], queryFn: () => api<Ebom>(`/plm/eboms/${id}`) });
  const [signing, setSigning] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const e = q.data;
  if (!e) return q.isError ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  async function mbom() {
    setMsg(null);
    try {
      await api(`/plm/eboms/${id}/mbom`, { body: {} });
      setMsg({ tone: "success", text: "Draft manufacturing BOM created: add operations in Manufacturing and submit it." });
      qc.invalidateQueries({ queryKey: ["/plm"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const c = e.comparison;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title={`${e.item} · revision ${e.revision}`} description={`Engineering BOM · ${e.status}`} actions={can("plm.items.manage") && <span className="flex gap-2">{e.status === "draft" && <Button onClick={() => setSigning(true)}>Release</Button>}{e.status === "released" && !e.mbomId && <Button variant="secondary" onClick={mbom}>Draft manufacturing BOM</Button>}{e.mbomId && <Link className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm hover:bg-surface-muted" href={`/manufacturing/boms/${e.mbomId}`}>Manufacturing BOM</Link>}</span>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs text-muted"><tr><th className="px-4 py-1.5">Find no.</th><th className="px-4 py-1.5">Part</th><th className="px-4 py-1.5 text-right">Qty</th><th className="px-4 py-1.5">Reference</th></tr></thead>
          <tbody className="divide-y divide-border">{e.lines.map((l) => <tr key={l.findNo}><td className="px-4 py-1.5">{l.findNo}</td><td className="px-4 py-1.5">{l.item}</td><td className="px-4 py-1.5 text-right tabular-nums">{l.qty}</td><td className="px-4 py-1.5 text-xs">{l.refDes ?? ""}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <Card>
        <CardHeader title="Against the manufacturing BOM" />
        <div className="space-y-1 border-t border-border p-4 text-sm">
          {!c && <p className="text-muted">No approved manufacturing BOM for this item yet.</p>}
          {c && c.matches && <Badge tone="success">Every design part is in the manufacturing BOM in the same quantity</Badge>}
          {c?.onlyDesign.map((x) => <p key={x.item}><Badge tone="danger">missing in manufacturing</Badge> {x.item} × {x.qty}</p>)}
          {c?.qtyDiffers.map((x) => <p key={x.item}><Badge tone="warning">quantity differs</Badge> {x.item}: design {x.design}, manufacturing {x.manufacturing}</p>)}
          {c?.onlyManufacturing.map((x) => <p key={x.item}><Badge>manufacturing only</Badge> {x.item} × {x.qty}</p>)}
        </div>
      </Card>
      {signing && <ESignDialog meaning={`Engineering BOM revision ${e.revision} released`} reasonRequired={false} reasonLabel="Comment" onClose={() => setSigning(false)} onSign={async (password, reason) => { await api(`/plm/eboms/${id}/release`, { body: { password, reason: reason || null } }); qc.invalidateQueries({ queryKey: ["/plm"] }); }} />}
    </div>
  );
}
