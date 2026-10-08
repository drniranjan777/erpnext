"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { clientRef } from "@/lib/offline-queue";

interface Z { sales: number; salesAmount: number; returns: number; returnsAmount: number; byTender: Record<string, { in: number; out: number }>; byRate: Record<string, { taxable: number; tax: number }>; expectedCash: number; countedCash: number; difference: number }
interface ShiftRow { id: string; terminal: string; status: string; openingCash: number; openedAt: string; closedAt: string | null; openedBy: string | null; sales: number; net: number; zReport: Z | null }
interface Sale { id: string; kind: string; number: string; total: number; soldAt: string; buyerName: string | null; lines: { itemId: string; code: string; name: string; qty: number }[] }
interface Shift { id: string; status: string; openingCash: number; openedAt: string; terminal: { code: string; name: string }; sales: Sale[]; summary: Z | null }
interface Wh { id: string; code: string; name: string }

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ShiftsPage() {
  return (
    <Suspense>
      <Shifts />
    </Suspense>
  );
}

/** Shifts, returns, day close, and tills. */
function Shifts() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(params.get("session"));
  const list = useQuery({ queryKey: ["/pos/sessions"], queryFn: () => api<ShiftRow[]>("/pos/sessions"), enabled: can("pos.terminals.manage") });
  const shift = useQuery({ queryKey: ["/pos/sessions", open], queryFn: () => api<Shift>(`/pos/sessions/${open}`), enabled: !!open });
  const wh = useQuery({ queryKey: ["/inventory/warehouses"], queryFn: () => api<Wh[]>("/inventory/warehouses"), enabled: can("pos.terminals.manage") });
  const [counted, setCounted] = useState("");
  const [till, setTill] = useState({ code: "", name: "", warehouseId: "", footer: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/pos"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const ret = (s: Sale) => {
    const which = window.prompt(`Return which item and how many? (${s.lines.map((l) => `${l.code} × ${l.qty}`).join(", ")}) — e.g. ${s.lines[0].code} 1`);
    if (!which) return;
    const [code, n] = which.trim().split(/\s+/);
    const l = s.lines.find((x) => x.code.toLowerCase() === code.toLowerCase());
    const reason = l && window.prompt("Reason for the return");
    if (!l || !reason) return;
    run(() => api(`/pos/sessions/${open}/sales/${s.id}/return`, { body: { clientRef: clientRef(), lines: [{ itemId: l.itemId, qty: Number(n || 1) }], refund: "cash", reason } }), "Return recorded and refunded in cash.");
  };
  const z = shift.data?.summary;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Shifts and tills" description="Sales and returns of each shift, the day-close (Z) report with cash to count, and the tills." actions={<Link className="text-sm text-primary hover:underline" href="/pos">Back to the till</Link>} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {shift.data && (
        <Card>
          <CardHeader title={`${shift.data.terminal.code} · shift from ${formatDateTime(shift.data.openedAt)}`} description={`${shift.data.status} · opening cash ${inr(shift.data.openingCash)}`} />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {shift.data.sales.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-1.5"><Badge tone={s.kind === "return" ? "warning" : "success"}>{s.kind}</Badge><span>{s.number}</span><span className="text-xs text-muted">{formatDateTime(s.soldAt)}{s.buyerName ? ` · ${s.buyerName}` : ""} · {s.lines.map((l) => `${l.code} × ${l.qty}`).join(", ")}</span><span className="ml-auto tabular-nums">{inr(s.total)}</span><Link className="text-xs text-primary hover:underline" href={`/print/pos-receipt/${s.id}`} target="_blank">Receipt</Link>{shift.data!.status === "open" && s.kind === "sale" && <Button size="sm" variant="secondary" onClick={() => ret(s)}>Return</Button>}</li>)}
          </ul>
          {z && (
            <div className="grid gap-4 border-t border-border p-4 text-sm sm:grid-cols-3">
              <div><p className="font-medium">Sales</p><p>{z.sales} sale(s) · {inr(z.salesAmount)}</p><p>{z.returns} return(s) · {inr(z.returnsAmount)}</p></div>
              <div><p className="font-medium">By tender</p>{Object.entries(z.byTender).map(([m, v]) => <p key={m} className="uppercase">{m}: <span className="normal-case">in {inr(v.in)} · out {inr(v.out)}</span></p>)}</div>
              <div><p className="font-medium">GST</p>{Object.entries(z.byRate).map(([r, v]) => <p key={r}>{r} %: taxable {inr(v.taxable)} · tax {inr(v.tax)}</p>)}</div>
              <div className="sm:col-span-3"><p className="font-medium">Cash</p><p>Expected in the drawer: {inr(z.expectedCash)}{shift.data.status === "closed" ? ` · counted ${inr(z.countedCash)} · ${z.difference === 0 ? "matches" : `difference ${inr(z.difference)}`}` : ""}</p></div>
            </div>
          )}
          {shift.data.status === "open" && (
            <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
              <Input className="h-9 w-48" type="number" min={0} step="0.01" aria-label="Counted cash" placeholder="Cash counted in the drawer" value={counted} onChange={(e) => setCounted(e.target.value)} />
              <Button disabled={counted === ""} onClick={() => run(() => api(`/pos/sessions/${open}/close`, { body: { countedCash: Number(counted) } }), "Shift closed.")}>Close shift</Button>
            </div>
          )}
        </Card>
      )}
      {can("pos.terminals.manage") && (
        <>
          <Card>
            <CardHeader title="Recent shifts" />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {list.data?.map((s) => <li key={s.id}><button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-2 text-left hover:bg-surface-muted" onClick={() => setOpen(s.id)}><Badge tone={s.status === "open" ? "primary" : "neutral"}>{s.status}</Badge><span className="font-medium">{s.terminal}</span><span className="text-xs text-muted">{formatDateTime(s.openedAt)}{s.closedAt ? ` → ${formatDateTime(s.closedAt)}` : ""} · {s.openedBy}</span><span className="ml-auto tabular-nums">{s.sales} sale(s) · {inr(s.net)}</span>{s.zReport && s.zReport.difference !== 0 && <Badge tone="warning">cash {s.zReport.difference > 0 ? "over" : "short"} {inr(Math.abs(s.zReport.difference))}</Badge>}</button></li>)}
              {list.data && !list.data.length && <li className="px-4 py-4 text-center text-muted">No shifts yet.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Add a till" />
            <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-4">
              <Input aria-label="Code" placeholder="Code" value={till.code} onChange={(e) => setTill({ ...till, code: e.target.value })} />
              <Input aria-label="Name" placeholder="Name" value={till.name} onChange={(e) => setTill({ ...till, name: e.target.value })} />
              <Select aria-label="Warehouse" value={till.warehouseId} onChange={(e) => setTill({ ...till, warehouseId: e.target.value })}><option value="">Sells from…</option>{wh.data?.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</Select>
              <Input aria-label="Receipt footer" placeholder="Receipt footer" value={till.footer} onChange={(e) => setTill({ ...till, footer: e.target.value })} />
              <Button disabled={!till.code || till.name.length < 2 || !till.warehouseId} onClick={() => run(() => api("/pos/terminals", { body: { code: till.code, name: till.name, warehouseId: till.warehouseId, receiptFooter: till.footer || null } }), "Till added.")}>Add till</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
