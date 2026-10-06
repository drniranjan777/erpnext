"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ACC, drCr, VOUCHER_LABEL, VOUCHER_PATH, type LedgerEntry, type OpenBill } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/documents";

interface Statement {
  company: { name: string; legalName: string | null; gstin: string | null };
  party: { id: string; code: string; name: string; gstin: string | null; email: string | null };
  to: string;
  ledger: { opening: string; debit: string; credit: string; closing: string; entries: LedgerEntry[] };
  openBills: OpenBill[];
  advances: { id: string; number: string | null; docDate: string; onAccount: string }[];
}

export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useQuery({ queryKey: [ACC, "statement", id, from, to], queryFn: () => api<Statement>(`${ACC}/statement/${id}`, { query: { from, to } }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  return (
    <div className="mx-auto max-w-5xl space-y-6 print:max-w-none">
      <div className="print:hidden">
        <PageHeader title={`Statement of account: ${d.party.name}`} description={d.party.gstin ? `GSTIN ${d.party.gstin}` : undefined} actions={<Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</Button>} />
      </div>
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">{d.company.legalName ?? d.company.name}</h1>
        <p className="text-sm">Statement of account: {d.party.name}{d.party.gstin && ` (GSTIN ${d.party.gstin})`} as of {formatDate(d.to)}</p>
      </div>
      <Card>
        <div className="flex flex-wrap gap-4 border-b border-border px-5 py-4 print:hidden">
          <Field label="From">{(f) => <Input {...f} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(f) => <Input {...f} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Particulars</th><th className="px-4 py-2 text-right font-medium">Debit</th><th className="px-4 py-2 text-right font-medium">Credit</th><th className="px-4 py-2 text-right font-medium">Balance</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr><td className="px-4 py-2" colSpan={4}>Opening balance</td><td className="px-4 py-2 text-right tabular-nums">{drCr(d.ledger.opening)}</td></tr>
            {d.ledger.entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2">{formatDate(e.postingDate)}</td>
                <td className="px-4 py-2">
                  {VOUCHER_LABEL[e.voucherType] ?? e.voucherType}{" "}
                  {VOUCHER_PATH[e.voucherType] ? <Link href={`${VOUCHER_PATH[e.voucherType]}/${e.voucherId}`} className="font-mono text-primary hover:underline print:text-foreground">{e.voucherNumber}</Link> : e.voucherNumber}
                  {e.against && e.against !== e.voucherNumber && <span className="text-muted"> against {e.against}</span>}
                  {e.isReversal && <span className="text-muted"> (cancelled)</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(e.debit) ? formatMoney(e.debit) : ""}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(e.credit) ? formatMoney(e.credit) : ""}</td>
                <td className="px-4 py-2 text-right tabular-nums">{drCr(e.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border font-semibold">
            <tr><td className="px-4 py-2" colSpan={2}>Closing balance</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.ledger.debit)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.ledger.credit)}</td><td className="px-4 py-2 text-right tabular-nums">{drCr(d.ledger.closing)}</td></tr>
          </tfoot>
        </table>
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Open bills" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {d.openBills.map((b) => (
              <li key={b.id} className="flex justify-between gap-3 px-5 py-2">
                <span><span className="font-mono">{b.number}</span> <span className="text-muted">due {formatDate(b.dueDate)}{b.daysOverdue > 0 && `, ${b.daysOverdue} days overdue`}</span></span>
                <span className="tabular-nums">{formatMoney(b.outstanding)}</span>
              </li>
            ))}
            {!d.openBills.length && <li className="px-5 py-3 text-muted">None</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Advances not yet adjusted" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {d.advances.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 px-5 py-2"><span className="font-mono">{a.number}</span><span className="text-muted">{formatDate(a.docDate)}</span><span className="tabular-nums">{formatMoney(a.onAccount)}</span></li>
            ))}
            {!d.advances.length && <li className="px-5 py-3 text-muted">None</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
