"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Info } from "@/components/documents/doc-page";
import { Alert, Card } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import type { AddressSnapshot, SellingLine } from "@/lib/sales";

export function address(a: AddressSnapshot) {
  return [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(", ");
}

/** Customer, bill-to / ship-to and terms block shared by quotations, orders and invoices. */
export function CustomerBlock({ customer, billing, shipping, extra }: { customer: { id: string; name: string; gstin: string | null; registration?: string }; billing: AddressSnapshot; shipping: AddressSnapshot; extra?: React.ReactNode }) {
  return (
    <Card>
      <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
        <Info
          label="Customer"
          value={
            <>
              <Link href={`/masters/parties/${customer.id}`} className="font-medium hover:underline">
                {customer.name}
              </Link>
              <span className="block font-mono text-xs text-muted">{customer.gstin ?? customer.registration ?? ""}</span>
            </>
          }
        />
        <Info label="Bill to" value={address(billing)} />
        <Info label="Ship to" value={address(shipping)} />
        {extra}
      </dl>
    </Card>
  );
}

export function SellingLinesTable<T extends SellingLine>({ lines, extra }: { lines: T[]; extra?: { label: string; render: (l: T) => React.ReactNode } }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 text-right font-medium">Qty</th>
            <th className="px-4 py-2 text-right font-medium">Rate</th>
            <th className="px-4 py-2 text-right font-medium">Taxable</th>
            <th className="px-4 py-2 text-right font-medium">GST</th>
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            {extra && <th className="px-4 py-2 text-right font-medium">{extra.label}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border align-top">
          {lines.map((l) => (
            <tr key={l.id ?? l.lineNo}>
              <td className="px-4 py-2.5 text-muted">{l.lineNo}</td>
              <td className="px-4 py-2.5">
                {l.description}
                <p className="text-xs text-muted">
                  <span className="font-mono">{l.itemCode}</span>
                  {l.hsnCode && ` · HSN ${l.hsnCode}`}
                </p>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                {formatQty(l.qty)} {l.uomCode}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                {formatMoney(l.rate)}
                {Number(l.discountPct) > 0 && <p className="text-xs text-muted">−{Number(l.discountPct)}%</p>}
                {l.listRate && Number(l.listRate) !== Number(l.rate) && <p className="text-xs text-muted">list {formatMoney(l.listRate)}</p>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(l.taxableValue)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted">{Number(l.gstRate)}%</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>
              {extra && <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{extra.render(l)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Edit page: loads the document and shows the form if it is still editable. */
export function EditDocPage<T extends { displayNumber: string; can: { edit: boolean } }>({ apiBase, title, render }: { apiBase: string; title: string; render: (doc: T) => React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: [apiBase, id], queryFn: () => api<T>(`${apiBase}/${id}`) });
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={q.data ? `Edit ${q.data.displayNumber}` : `Edit ${title}`} />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.can.edit && <Alert tone="warning">This {title} can no longer be edited.</Alert>}
      {q.data?.can.edit && render(q.data)}
    </div>
  );
}

export const due = (date: string | null, days: number | null, outstanding?: string) =>
  date ? `${formatDate(date)}${outstanding && Number(outstanding) > 0 && days !== null ? (days < 0 ? ` · ${-days} days overdue` : ` · in ${days} days`) : ""}` : "—";
