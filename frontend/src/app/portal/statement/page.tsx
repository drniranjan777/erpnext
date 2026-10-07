"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { portalApi } from "@/lib/portal";

interface Statement {
  company: { name: string; gstin: string | null } | null;
  party: { name: string; gstin: string | null };
  from: string | null;
  to: string;
  ledger: { opening: string; debit: string; credit: string; closing: string; entries: { postingDate: string; voucherType: string; voucherNumber: string | null; debit: string; credit: string; balance: string }[] };
  openBills: { id: string; number: string; docDate: string; dueDate: string | null; total: string; outstanding: string }[];
}
const TYPE: Record<string, string> = { sales_invoice: "Invoice", money_voucher: "Payment", credit_note: "Credit note", journal_entry: "Adjustment" };
const drcr = (v: string) => `${formatMoney(Math.abs(Number(v)))} ${Number(v) >= 0 ? "Dr" : "Cr"}`;

export default function PortalStatement() {
  const fyStart = () => {
    const t = todayIST();
    const y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) < 4 ? 1 : 0);
    return `${y}-04-01`;
  };
  const [from, setFrom] = useState(fyStart);
  const [to, setTo] = useState(todayIST);
  const q = useQuery({ queryKey: ["portal", "statement", from, to], queryFn: () => portalApi<Statement>("/portal/statement", { query: { from, to } }) });
  return (
    <div className="space-y-6">
      <PageHeader title="Statement of account" description="Your account with us: invoices, payments and the running balance (Dr means you owe us)." actions={<button type="button" className="text-sm text-primary" onClick={() => window.print()}>Print</button>} />
      <div className="flex flex-wrap gap-3 print:hidden">
        <Input className="h-9 w-44" type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input className="h-9 w-44" type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <>
          <Card>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Document</th><th className="px-4 py-2 text-right font-medium">Debit</th><th className="px-4 py-2 text-right font-medium">Credit</th><th className="px-4 py-2 text-right font-medium">Balance</th></tr></thead>
              <tbody className="divide-y divide-border">
                <tr className="text-muted"><td className="px-4 py-2">{formatDate(from)}</td><td className="px-4 py-2">Opening balance</td><td /><td /><td className="px-4 py-2 text-right tabular-nums">{drcr(q.data.ledger.opening)}</td></tr>
                {q.data.ledger.entries.map((e, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{formatDate(e.postingDate)}</td>
                    <td className="px-4 py-2">{TYPE[e.voucherType] ?? e.voucherType.replace(/_/g, " ")} {e.voucherNumber}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(e.debit) ? formatMoney(e.debit) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(e.credit) ? formatMoney(e.credit) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{drcr(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-medium"><tr><td className="px-4 py-2" colSpan={2}>Closing balance</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(q.data.ledger.debit)}</td><td className="px-4 py-2 text-right tabular-nums">{formatMoney(q.data.ledger.credit)}</td><td className="px-4 py-2 text-right tabular-nums">{drcr(q.data.ledger.closing)}</td></tr></tfoot>
            </table>
          </Card>
          {q.data.openBills.length > 0 && (
            <Card>
              <CardHeader title="Unpaid invoices" />
              <ul className="divide-y divide-border border-t border-border text-sm">
                {q.data.openBills.map((b) => (
                  <li key={b.id} className="flex flex-wrap gap-3 px-5 py-2">
                    <span className="font-mono text-xs">{b.number}</span>
                    <span className="text-xs text-muted">{formatDate(b.docDate)}{b.dueDate && ` · due ${formatDate(b.dueDate)}`}</span>
                    <span className="ml-auto tabular-nums">{formatMoney(b.outstanding)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
