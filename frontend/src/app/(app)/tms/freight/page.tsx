"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { TMS } from "@/lib/tms";
import { askText } from "@/components/ui/ask";
import { DataTable } from "@/components/ui/data-table";

interface Bill { id: string; number: string; billNo: string; billDate: string; transporter: string; claimedAmount: string; computedAmount: string; difference: string; status: string; decisionNote: string | null; trips: number }
interface Billable { id: string; number: string; tripDate: string; vehicleNo: string; freightAmount: string | null; freightBasis: string | null; expenses: string }

export default function FreightBillsPage() {
  const qc = useQueryClient();
  const bills = useQuery({ queryKey: [TMS, "bills"], queryFn: () => api<Bill[]>(`${TMS}/freight-bills`) });
  const transporters = useQuery({ queryKey: [TMS, "transporters"], queryFn: () => api<{ id: string; name: string }[]>(`${TMS}/transporters`) });
  const [tr, setTr] = useState("");
  const billable = useQuery({ queryKey: [TMS, "billable", tr], queryFn: () => api<Billable[]>(`${TMS}/transporters/${tr}/billable`), enabled: !!tr });
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [head, setHead] = useState({ billNo: "", billDate: todayIST() });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: [TMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const lines = Object.entries(claims).filter(([, v]) => v !== "").map(([tripId, v]) => ({ tripId, claimed: Number(v) }));
  async function decide(b: Bill, approve: boolean) {
    const ask = !approve ? "Why is it disputed?" : Number(b.difference) > 0 ? `₹${b.difference} above the contract: why approve it?` : "Note (optional)";
    const note = await askText(ask);
    if (note === null) return;
    run(() => api(`${TMS}/freight-bills/${b.id}/decide`, { body: { approve, note: note || null } }), approve ? "Approved." : "Disputed; its trips can be billed again.");
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Freight bills" description="Check each transporter bill against the contract freight plus the trip expenses. Someone other than the person who entered it approves or disputes it." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Enter a bill" />
        <div className="space-y-3 border-t border-border p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Transporter">{(p) => <Select {...p} value={tr} onChange={(e) => { setTr(e.target.value); setClaims({}); }}><option value="">Choose…</option>{transporters.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
            <Field label="Their bill no.">{(p) => <Input {...p} value={head.billNo} onChange={(e) => setHead({ ...head, billNo: e.target.value })} />}</Field>
            <Field label="Bill date">{(p) => <Input {...p} type="date" value={head.billDate} onChange={(e) => setHead({ ...head, billDate: e.target.value })} />}</Field>
          </div>
          {tr && (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1">Trip</th><th>Vehicle</th><th className="text-right">Contract freight</th><th className="text-right">Expenses</th><th className="text-right">Claimed ₹</th></tr></thead>
              <tbody className="divide-y divide-border">
                {billable.data?.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5"><span className="font-mono text-xs">{t.number}</span> <span className="text-xs text-muted">{formatDate(t.tripDate)}</span></td>
                    <td>{t.vehicleNo}</td>
                    <td className="text-right tabular-nums" title={t.freightBasis ?? undefined}>{t.freightAmount ? formatMoney(t.freightAmount) : "no rate"}</td>
                    <td className="text-right tabular-nums">{formatMoney(t.expenses)}</td>
                    <td className="text-right"><Input aria-label={`Claimed for ${t.number}`} className="ml-auto w-32 text-right" inputMode="decimal" value={claims[t.id] ?? ""} onChange={(e) => setClaims({ ...claims, [t.id]: e.target.value })} /></td>
                  </tr>
                ))}
                {billable.data && !billable.data.length && <tr><td colSpan={5} className="py-3 text-center text-muted">No completed, unbilled trips.</td></tr>}
              </tbody>
            </table></div>
          )}
          <div className="flex justify-end"><Button disabled={!tr || !head.billNo || !lines.length} onClick={() => run(() => api(`${TMS}/freight-bills`, { body: { transporterId: tr, ...head, lines } }), "Bill recorded for checking.").then(() => setClaims({}))}>Record bill</Button></div>
        </div>
      </Card>
      <Card>
        <DataTable
          rows={bills.data ?? []}
          rowKey={(b) => String(b.id)}
          exportName="tms-freight"
          storageKey="tms-freight-1"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No bills.</p>}
          columns={[
            { key: "bill", label: "Bill", locked: true, className: "whitespace-normal", render: (b) => <><span className="font-mono text-xs">{b.number}</span> {b.billNo}<span className="block text-xs text-muted">{formatDate(b.billDate)} · {b.trips} trip(s)</span></> },
            { key: "transporter", label: "Transporter", className: "whitespace-normal", render: (b) => <>{b.transporter}</> },
            { key: "claimed", label: "Claimed", align: "right", render: (b) => <>{formatMoney(b.claimedAmount)}</> },
            { key: "contract", label: "Contract", align: "right", render: (b) => <>{formatMoney(b.computedAmount)}</> },
            { key: "difference", label: "Difference", align: "right", render: (b) => <><span className={`${Number(b.difference) > 0 ? "text-danger" : ""}`}>{formatMoney(b.difference)}</span></> },
            { key: "col5", label: "", align: "right", noSort: true, render: (b) => <><Badge tone={b.status === "approved" ? "success" : b.status === "disputed" ? "danger" : "warning"}>{b.status}</Badge>
                            {b.status === "pending" && <><Button size="sm" variant="ghost" onClick={() => decide(b, true)}>Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(b, false)}>Dispute</Button></>}
                            {b.decisionNote && <span className="block text-xs text-muted">{b.decisionNote}</span>}</> },
          ]}
        />
      </Card>
    </div>
  );
}
