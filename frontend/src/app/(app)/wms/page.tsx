"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useWmsWarehouses, WMS } from "@/lib/wms";

export default function WmsHome() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useWmsWarehouses();
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function enable(id: string, code: string) {
    if (!window.confirm(`Run ${code} with bins? Its current stock goes into the receiving bin, to be put away. This cannot be undone.`)) return;
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
    </div>
  );
}
