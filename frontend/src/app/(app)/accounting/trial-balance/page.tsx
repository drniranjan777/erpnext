"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ACC, drCr, type AccountRow } from "@/lib/accounting";
import { formatMoney, todayIST } from "@/lib/documents";

interface Tb { from: string | null; to: string; rows: AccountRow[]; totals: { debit: string; credit: string; closingDebit: string; closingCredit: string }; balanced: boolean }

function fyStart() {
  const [y, m] = todayIST().split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

export default function TrialBalancePage() {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIST());
  const [groupsOnly, setGroupsOnly] = useState(false);
  const [hideZero, setHideZero] = useState(true);
  const q = useQuery({ queryKey: [ACC, "tb", from, to], queryFn: () => api<Tb>(`${ACC}/trial-balance`, { query: { from, to } }) });
  const rows = (q.data?.rows ?? []).filter((r) => (!groupsOnly || r.isGroup) && (!hideZero || Number(r.opening) || Number(r.debit) || Number(r.credit)));
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Trial balance" description="Opening balance, movement in the period and closing balance of every account." />
      <Card>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-5 py-4">
          <Field label="From">{(f) => <Input {...f} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(f) => <Input {...f} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          <div className="pb-2"><Checkbox label="Groups only" checked={groupsOnly} onChange={(e) => setGroupsOnly(e.target.checked)} /></div>
          <div className="pb-2"><Checkbox label="Hide zero balances" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /></div>
          {q.data && <div className="ml-auto pb-2">{q.data.balanced ? <Badge tone="success">Balanced</Badge> : <Badge tone="danger">Out of balance</Badge>}</div>}
        </div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {q.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-4 py-2.5 text-right font-medium">Opening</th>
                  <th className="px-4 py-2.5 text-right font-medium">Debit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Credit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Closing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className={r.isGroup ? "bg-surface-muted/40 font-medium" : ""}>
                    <td className="px-4 py-2" style={{ paddingLeft: `${16 + (groupsOnly ? 0 : r.level * 16)}px` }}>
                      {r.isGroup ? <>{r.code} {r.name}</> : <Link href={`${ACC}/ledger?accountId=${r.id}&from=${from}&to=${to}`} className="hover:underline"><span className="font-mono text-xs text-muted">{r.code}</span> {r.name}</Link>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{drCr(r.opening)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(r.debit) ? formatMoney(r.debit) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(r.credit) ? formatMoney(r.credit) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{drCr(r.closing)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td className="px-4 py-2.5">Total</td>
                  <td />
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(q.data.totals.debit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(q.data.totals.credit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(q.data.totals.closingDebit)} Dr / {formatMoney(q.data.totals.closingCredit)} Cr</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
