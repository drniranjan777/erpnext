"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PartyPicker } from "@/components/party-picker";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ACC, drCr, VOUCHER_LABEL, VOUCHER_PATH, type AccountRow, type LedgerEntry } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/documents";

interface Ledger { account: { id: string; code: string; name: string } | null; party: { id: string; name: string } | null; opening: string; debit: string; credit: string; closing: string; entries: LedgerEntry[]; truncated: boolean }

export default function LedgerPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <LedgerView />
    </Suspense>
  );
}

function LedgerView() {
  const params = useSearchParams();
  const router = useRouter();
  const accountId = params.get("accountId") ?? "";
  const partyId = params.get("partyId") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${ACC}/ledger?${p.toString()}`);
  };
  const accounts = useQuery({ queryKey: [ACC, "accounts"], queryFn: () => api<AccountRow[]>(`${ACC}/accounts`) });
  const q = useQuery({ queryKey: [ACC, "ledger", accountId, partyId, from, to], queryFn: () => api<Ledger>(`${ACC}/ledger`, { query: { accountId, partyId, from, to } }), enabled: !!(accountId || partyId) });
  const d = q.data;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title={d?.account ? `${d.account.code} ${d.account.name}` : d?.party ? `Ledger: ${d.party.name}` : "Ledger"} description="Every entry with a running balance. Click a voucher to open the document." />
      <Card>
        <div className="grid gap-4 border-b border-border px-5 py-4 sm:grid-cols-4">
          <Field label="Account" className="sm:col-span-2">
            {(f) => (
              <Select {...f} value={accountId} onChange={(e) => set("accountId", e.target.value)}>
                <option value="">All accounts (party ledger)</option>
                {(accounts.data ?? []).filter((a) => !a.isGroup).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="From">{(f) => <Input {...f} type="date" value={from} onChange={(e) => set("from", e.target.value)} />}</Field>
          <Field label="To">{(f) => <Input {...f} type="date" value={to} onChange={(e) => set("to", e.target.value)} />}</Field>
          <Field label="Customer / vendor" className="sm:col-span-2">
            {(f) => <PartyPicker id={f.id} role="customer" value={d?.party ? { id: d.party.id, code: "", name: d.party.name, gstin: null, stateCode: null, creditDays: null } : null} onChange={(p) => set("partyId", p?.id ?? "")} />}
          </Field>
        </div>
        {!accountId && !partyId && <EmptyState title="Choose an account or a party" />}
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {d && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Voucher</th>
                  <th className="px-4 py-2.5 font-medium">{accountId ? "Party / narration" : "Account"}</th>
                  <th className="px-4 py-2.5 text-right font-medium">Debit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Credit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-surface-muted/40">
                  <td className="px-4 py-2" colSpan={5}>Opening balance</td>
                  <td className="px-4 py-2 text-right tabular-nums">{drCr(d.opening)}</td>
                </tr>
                {d.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{formatDate(e.postingDate)}</td>
                    <td className="px-4 py-2">
                      {VOUCHER_PATH[e.voucherType] ? <Link href={`${VOUCHER_PATH[e.voucherType]}/${e.voucherId}`} className="text-primary hover:underline">{e.voucherNumber ?? "—"}</Link> : e.voucherNumber}
                      <span className="block text-xs text-muted">{VOUCHER_LABEL[e.voucherType] ?? e.voucherType}{e.isReversal && <Badge className="ml-1">Cancelled</Badge>}</span>
                    </td>
                    <td className="px-4 py-2">
                      {accountId ? e.party ?? "" : `${e.accountCode} ${e.accountName}`}
                      {(e.narration || e.against) && <span className="block text-xs text-muted">{[e.narration, e.against && `against ${e.against}`].filter(Boolean).join(" · ")}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(e.debit) ? formatMoney(e.debit) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(e.credit) ? formatMoney(e.credit) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{drCr(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold">
                <tr>
                  <td className="px-4 py-2.5" colSpan={3}>Closing balance{d.truncated && <span className="ml-2 font-normal text-warning">(first entries only: narrow the dates)</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(d.debit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(d.credit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{drCr(d.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
