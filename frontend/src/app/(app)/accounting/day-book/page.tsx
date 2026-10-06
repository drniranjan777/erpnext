"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ACC, VOUCHER_LABEL, VOUCHER_PATH } from "@/lib/accounting";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";

interface DayBook {
  vouchers: { voucherId: string; voucherType: string; voucherNumber: string | null; postingDate: string; isReversal: boolean; lines: { accountCode: string; accountName: string; party: string | null; debit: string; credit: string }[] }[];
}

export default function DayBookPage() {
  const [from, setFrom] = useState(todayIST());
  const [to, setTo] = useState(todayIST());
  const q = useQuery({ queryKey: [ACC, "day-book", from, to], queryFn: () => api<DayBook>(`${ACC}/day-book`, { query: { from, to } }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Day book" description="Every voucher posted to the ledger, with its entries." />
      <Card>
        <div className="flex flex-wrap gap-4 border-b border-border px-5 py-4">
          <Field label="From">{(f) => <Input {...f} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(f) => <Input {...f} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {q.data && !q.data.vouchers.length && <EmptyState title="Nothing posted in this period" />}
        <div className="divide-y divide-border">
          {q.data?.vouchers.map((v) => (
            <div key={`${v.voucherId}${v.isReversal}`} className="px-5 py-3">
              <p className="mb-1 text-sm">
                <span className="text-muted">{formatDate(v.postingDate)}</span> · {VOUCHER_LABEL[v.voucherType] ?? v.voucherType}{" "}
                {VOUCHER_PATH[v.voucherType] ? <Link href={`${VOUCHER_PATH[v.voucherType]}/${v.voucherId}`} className="font-medium text-primary hover:underline">{v.voucherNumber}</Link> : v.voucherNumber}
                {v.isReversal && <Badge className="ml-2">Cancellation</Badge>}
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {v.lines.map((l, i) => (
                    <tr key={i}>
                      <td className={`py-0.5 ${Number(l.credit) ? "pl-8" : ""}`}><span className="font-mono text-xs text-muted">{l.accountCode}</span> {l.accountName}{l.party && <span className="text-muted"> · {l.party}</span>}</td>
                      <td className="w-36 py-0.5 text-right tabular-nums">{Number(l.debit) ? formatMoney(l.debit) : ""}</td>
                      <td className="w-36 py-0.5 text-right tabular-nums">{Number(l.credit) ? formatMoney(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
