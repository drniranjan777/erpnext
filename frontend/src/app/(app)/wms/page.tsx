"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useWmsWarehouses, WMS } from "@/lib/wms";
import { askConfirm } from "@/components/ui/ask";

export default function WmsHome() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useWmsWarehouses();
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function enable(id: string, code: string) {
    if (!await askConfirm(`Run ${code} with bins? Its current stock goes into the receiving bin, to be put away. This cannot be undone.`)) return;
    setMsg(null);
    try {
      const r = await api<{ linesMoved: number }>(`${WMS}/warehouses/${id}/enable`, { body: {} });
      setMsg({ tone: "success", text: `${code} now runs with bins. ${r.linesMoved} stock line(s) are in the receiving bin; set up zones and bins, then plan put-away.` });
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Warehouse management" description="Run a warehouse with zones and bins: stock is kept by bin, received goods are put away by rules, and work is confirmed by scanning." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="font-mono text-xs text-muted">{w.code}</span>
                <span className="font-medium">{w.name}</span>
                {w.wms ? <Badge tone="success">bins · {w.bins}</Badge> : <Badge>no bins</Badge>}
                {w.openTasks > 0 && <Badge tone="warning">{w.openTasks} open task(s)</Badge>}
                <span className="ml-auto flex flex-wrap gap-3">
                  {w.wms ? (
                    <>
                      <Link className="text-primary hover:underline" href={`${WMS}/bins?wh=${w.id}`}>Layout</Link>
                      <Link className="text-primary hover:underline" href={`${WMS}/tasks?wh=${w.id}`}>Tasks</Link>
                      <Link className="text-primary hover:underline" href={`${WMS}/heatmap?wh=${w.id}`}>Heat map</Link>
                      <Link className="text-primary hover:underline" href={`${WMS}/scan?wh=${w.id}`}>Scan</Link>
                    </>
                  ) : (
                    can("wms.setup.manage") && <Button size="sm" variant="secondary" disabled={w.allowNegativeStock} title={w.allowNegativeStock ? "Turn off negative stock for this warehouse first" : undefined} onClick={() => enable(w.id, w.code)}>Switch bins on</Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Gs1Settings manage={can("wms.setup.manage")} />
    </div>
  );
}

function Gs1Settings({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: [WMS, "settings"], queryFn: () => api<{ gs1Prefix: string | null; ssccExtension: number }>(`${WMS}/settings`) });
  if (!q.data) return q.isError ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  return <Gs1Form key={q.data.gs1Prefix ?? ""} initial={q.data} manage={manage} />;
}

function Gs1Form({ initial, manage }: { initial: { gs1Prefix: string | null; ssccExtension: number }; manage: boolean }) {
  const [f, setF] = useState({ gs1Prefix: initial.gs1Prefix ?? "", ssccExtension: String(initial.ssccExtension) });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      await api(`${WMS}/settings`, { method: "PUT", body: { gs1Prefix: f.gs1Prefix || null, ssccExtension: Number(f.ssccExtension) || 0 } });
      setMsg({ tone: "success", text: "Saved." });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <Card>
      <CardHeader title="Carton numbering (GS1)" description="Your GS1 India company prefix numbers cartons and pallets with an SSCC, printed as a GS1-128 barcode on the logistic label." />
      <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="Company prefix">{(p) => <Input {...p} disabled={!manage} className="w-40 font-mono" inputMode="numeric" placeholder="890xxxx" value={f.gs1Prefix} onChange={(e) => setF({ ...f, gs1Prefix: e.target.value })} />}</Field>
        <Field label="Extension digit">{(p) => <Input {...p} disabled={!manage} className="w-24" type="number" min={0} max={9} value={f.ssccExtension} onChange={(e) => setF({ ...f, ssccExtension: e.target.value })} />}</Field>
        {manage && <Button onClick={save}>Save</Button>}
      </div>
    </Card>
  );
}
