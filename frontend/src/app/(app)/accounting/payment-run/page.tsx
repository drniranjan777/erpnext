"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, apiDownload, ApiError } from "@/lib/api";
import { ACC, type MoneyAccount } from "@/lib/accounting";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";

interface Proposal {
  bills: { billId: string; number: string | null; supplierInvoiceNo: string; dueDate: string | null; vendorId: string; vendor: string; msme: string | null; outstanding: string; hasBank: boolean; overdueDays: number }[];
  total: string;
}

export default function PaymentRunPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [dueBy, setDueBy] = useState(() => new Date(Date.parse(`${todayIST()}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10));
  const q = useQuery({ queryKey: [ACC, "proposal", dueBy], queryFn: () => api<Proposal>(`${ACC}/payment-proposal`, { query: { dueBy } }) });
  const banks = useQuery({ queryKey: [ACC, "money-accounts"], queryFn: () => api<MoneyAccount[]>(`${ACC}/money-accounts`) });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [accountId, setAccount] = useState("");
  const [mode, setMode] = useState("neft");
  const [done, setDone] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bankList = (banks.data ?? []).filter((b) => b.accountType === "bank");
  const acc = accountId || bankList[0]?.id || "";
  const total = Object.values(picked).reduce((s, v) => s + Number(v || 0), 0);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ ids: string[] }>(`${ACC}/payment-run`, { body: { accountId: acc, mode, docDate: todayIST(), items: Object.entries(picked).filter(([, v]) => Number(v) > 0).map(([billId, amount]) => ({ billId, amount })) } });
      setDone(r.ids);
      setPicked({});
      qc.invalidateQueries({ queryKey: [ACC] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Payment run" description="Bills due by a date, micro and small (MSME) vendors first. Pay several vendors at once and download the bank upload file." />
      {error && <Alert>{error}</Alert>}
      {done && (
        <Alert tone="success">
          {done.length} payment(s) posted.{" "}
          <button type="button" className="font-medium underline" onClick={() => apiDownload(`${ACC}/bank-file?ids=${done.join(",")}&format=generic`, `payments_${todayIST()}.csv`).catch((e) => setError(e instanceof ApiError ? e.message : "Download failed"))}>Bank file (CSV)</button>{" · "}
          <button type="button" className="font-medium underline" onClick={() => apiDownload(`${ACC}/bank-file?ids=${done.join(",")}&format=hdfc`, `payments_hdfc_${todayIST()}.csv`).catch((e) => setError(e instanceof ApiError ? e.message : "Download failed"))}>HDFC format</button>
        </Alert>
      )}
      <Card>
        <div className="flex flex-wrap items-end gap-4 border-b border-border px-5 py-4">
          <Field label="Due by">{(f) => <Input {...f} type="date" value={dueBy} onChange={(e) => setDueBy(e.target.value)} />}</Field>
          <Field label="Pay from">
            {(f) => (
              <Select {...f} value={acc} onChange={(e) => setAccount(e.target.value)}>
                {bankList.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name} ({formatMoney(b.balance)})</option>)}
              </Select>
            )}
          </Field>
          <Field label="Mode">
            {(f) => (
              <Select {...f} value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="neft">NEFT (RTGS above ₹2 lakh)</option>
                <option value="rtgs">RTGS</option>
                <option value="imps">IMPS</option>
              </Select>
            )}
          </Field>
          {can("accounting.money.manage") && (
            <Button className="ml-auto" loading={busy} disabled={!total || !acc} onClick={run}><Download className="size-4" aria-hidden /> Pay {formatMoney(total)}</Button>
          )}
        </div>
        {q.isLoading && <LoadingBlock />}
        {q.error && <div className="p-5"><ErrorBlock error={q.error} /></div>}
        {q.data && !q.data.bills.length && <EmptyState title="Nothing due" description="No unpaid bills due by this date." />}
        {!!q.data?.bills.length && (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr><th className="w-10 px-4 py-2.5" /><th className="px-4 py-2.5 font-medium">Vendor</th><th className="px-4 py-2.5 font-medium">Bill</th><th className="px-4 py-2.5 font-medium">Due</th><th className="px-4 py-2.5 text-right font-medium">Outstanding</th><th className="w-36 px-4 py-2.5 text-right font-medium">Pay</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.bills.map((b) => (
                <tr key={b.billId}>
                  <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Pay ${b.number}`} disabled={!b.hasBank} checked={b.billId in picked} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[b.billId] = b.outstanding; else delete n[b.billId]; return n; })} /></td>
                  <td className="px-4 py-2.5">{b.vendor}{b.msme && ["micro", "small"].includes(b.msme) && <Badge tone="warning" className="ml-2">MSME</Badge>}{!b.hasBank && <span className="block text-xs text-danger">No bank account on file</span>}</td>
                  <td className="px-4 py-2.5"><Link href={`/purchase/invoices/${b.billId}`} className="font-mono text-primary hover:underline">{b.number}</Link><span className="block text-xs text-muted">{b.supplierInvoiceNo}</span></td>
                  <td className={`px-4 py-2.5 ${b.overdueDays ? "text-danger" : ""}`}>{formatDate(b.dueDate)}{b.overdueDays > 0 && <span className="block text-xs">{b.overdueDays} days late</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(b.outstanding)}</td>
                  <td className="px-4 py-2">{b.billId in picked && <Input className="h-9 text-right" inputMode="decimal" aria-label={`Amount for ${b.number}`} value={picked[b.billId]} onChange={(e) => setPicked({ ...picked, [b.billId]: e.target.value })} />}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
