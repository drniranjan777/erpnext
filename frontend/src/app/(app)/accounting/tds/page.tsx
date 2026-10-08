"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, apiDownload, ApiError } from "@/lib/api";
import { ACC, type MoneyAccount } from "@/lib/accounting";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { DataTable } from "@/components/ui/data-table";

interface Quarter {
  quarter: string;
  sections: { section: string; label: string; deducted: string; deposited: string; balance: string; deductees: number }[];
  deductions: { billId: string; number: string; date: string; vendorId: string; vendor: string; pan: string | null; section: string; rate: string; base: string; tds: string; panStatus: string }[];
  challans: { voucherId: string; section: string; bsrCode: string; challanSerial: string; depositDate: string; amount: string; number: string }[];
  warnings: string[];
}

function current() {
  const [y, m] = todayIST().split("-").map(Number);
  return { fy: m >= 4 ? y : y - 1, quarter: m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4 };
}

export default function TdsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [sel, setSel] = useState({ ...current(), form: "26Q" as "26Q" | "27Q" });
  const [paying, setPaying] = useState<string | null>(null);
  const q = useQuery({ queryKey: [ACC, "tds", sel], queryFn: () => api<Quarter>(`${ACC}/tds`, { query: { fy: sel.fy, quarter: sel.quarter, form: sel.form } }) });
  const d = q.data;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="TDS"
        description="Tax deducted on vendor bills by quarter and section, what has been deposited, and the data for the quarterly return and Form 16A."
        actions={d ? <Button variant="secondary" onClick={() => apiDownload(`${ACC}/tds?fy=${sel.fy}&quarter=${sel.quarter}&form=${sel.form}&format=csv`, `${sel.form}_${d.quarter.replace(/\s/g, "_")}.csv`)}><Download className="size-4" aria-hidden /> Return data (CSV)</Button> : undefined}
      />
      <Card>
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <Field label="Financial year">{(f) => <Select {...f} value={sel.fy} onChange={(e) => setSel({ ...sel, fy: Number(e.target.value) })}>{[0, 1, 2].map((i) => { const y = current().fy - i; return <option key={y} value={y}>{y}-{String((y + 1) % 100).padStart(2, "0")}</option>; })}</Select>}</Field>
          <Field label="Quarter">{(f) => <Select {...f} value={sel.quarter} onChange={(e) => setSel({ ...sel, quarter: Number(e.target.value) })}><option value={1}>Q1 Apr–Jun</option><option value={2}>Q2 Jul–Sep</option><option value={3}>Q3 Oct–Dec</option><option value={4}>Q4 Jan–Mar</option></Select>}</Field>
          <Field label="Return">{(f) => <Select {...f} value={sel.form} onChange={(e) => setSel({ ...sel, form: e.target.value as "26Q" | "27Q" })}><option value="26Q">26Q (residents)</option><option value="27Q">27Q (non-residents)</option></Select>}</Field>
        </div>
      </Card>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {d?.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
      {d && (
        <>
          <Card>
            <CardHeader title={`Sections · ${d.quarter}`} />
            <DataTable
              rows={d.sections}
              rowKey={(s) => String(s.section)}
              exportName="accounting-tds"
              storageKey="accounting-tds-0"
              empty={<p className="px-4 py-6 text-center text-sm text-muted">No TDS this quarter.</p>}
              columns={[
                { key: "section", label: "Section", locked: true, className: "whitespace-normal", render: (s) => <>{s.label}</> },
                { key: "deductees", label: "Deductees", align: "right", render: (s) => <>{s.deductees}</> },
                { key: "deducted", label: "Deducted", align: "right", render: (s) => <>{formatMoney(s.deducted)}</> },
                { key: "deposited", label: "Deposited", align: "right", render: (s) => <>{formatMoney(s.deposited)}</> },
                { key: "to-deposit", label: "To deposit", align: "right", render: (s) => <><span className={`${Number(s.balance) > 0 ? "text-danger" : ""}`}>{formatMoney(s.balance)}</span></> },
                { key: "col5", label: "", align: "right", noSort: true, render: (s) => <>{Number(s.balance) > 0 && can("accounting.tax.manage") && <Button size="sm" variant="secondary" onClick={() => setPaying(s.section)}>Record challan</Button>}</> },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Deductions" />
            <DataTable
              rows={d.deductions}
              rowKey={(x) => String(x.billId)}
              exportName="accounting-tds"
              storageKey="accounting-tds-1"
              columns={[
                { key: "deductee", label: "Deductee", locked: true, className: "whitespace-normal", render: (x) => <>{x.vendor}<span className={`block font-mono text-xs ${x.pan ? "text-muted" : "text-danger"}`}>{x.pan ?? "PAN missing"}</span></> },
                { key: "bill", label: "Bill", className: "whitespace-normal", render: (x) => <><Link href={`/purchase/invoices/${x.billId}`} className="font-mono text-primary hover:underline">{x.number}</Link><span className="block text-xs text-muted">{formatDate(x.date)}</span></> },
                { key: "section", label: "Section", className: "whitespace-normal", render: (x) => <>{x.section}</> },
                { key: "amount", label: "Amount", align: "right", render: (x) => <>{formatMoney(x.base)}</> },
                { key: "rate", label: "Rate", align: "right", render: (x) => <>{Number(x.rate)}%</> },
                { key: "tds", label: "TDS", align: "right", render: (x) => <>{formatMoney(x.tds)}</> },
                { key: "col6", label: "", align: "right", noSort: true, render: (x) => <><Link className="text-xs text-primary hover:underline" href={`/accounting/tds/16a/${x.vendorId}?fy=${sel.fy}&quarter=${sel.quarter}`}>16A</Link></> },
              ]}
            />
          </Card>
          {d.challans.length > 0 && (
            <Card>
              <CardHeader title="Challans deposited" />
              <ul className="divide-y divide-border border-t border-border text-sm">
                {d.challans.map((c) => <li key={c.voucherId} className="flex flex-wrap justify-between gap-3 px-5 py-2"><span>{c.section}</span><span className="font-mono">BSR {c.bsrCode} · {c.challanSerial}</span><span className="text-muted">{formatDate(c.depositDate)}</span><Link href={`${ACC}/payments/${c.voucherId}`} className="text-primary hover:underline">{c.number}</Link><span className="tabular-nums">{formatMoney(c.amount)}</span></li>)}
              </ul>
            </Card>
          )}
        </>
      )}
      {paying && <ChallanDialog section={paying} fy={sel.fy} quarter={sel.quarter} amount={d?.sections.find((s) => s.section === paying)?.balance ?? ""} onClose={() => setPaying(null)} onDone={() => qc.invalidateQueries({ queryKey: [ACC, "tds"] })} />}
    </div>
  );
}

function ChallanDialog({ section, fy, quarter, amount, onClose, onDone }: { section: string; fy: number; quarter: number; amount: string; onClose: () => void; onDone: () => void }) {
  const banks = useQuery({ queryKey: [ACC, "money-accounts"], queryFn: () => api<MoneyAccount[]>(`${ACC}/money-accounts`) });
  const [f, setF] = useState({ accountId: "", amount, bsrCode: "", challanSerial: "", depositDate: todayIST() });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const acc = f.accountId || banks.data?.find((b) => b.accountType === "bank")?.id || "";
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`${ACC}/tds/challans`, { body: { ...f, accountId: acc, section, fy, quarter } });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={`TDS deposit · ${section}`} description="Challan ITNS 281 details from the bank / income-tax portal." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Record</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Paid from">{(p) => <Select {...p} value={acc} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{(banks.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</Select>}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount">{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Field label="Deposit date">{(p) => <Input {...p} type="date" value={f.depositDate} onChange={(e) => setF({ ...f, depositDate: e.target.value })} />}</Field>
          <Field label="BSR code">{(p) => <Input {...p} maxLength={7} inputMode="numeric" value={f.bsrCode} onChange={(e) => setF({ ...f, bsrCode: e.target.value.replace(/\D/g, "") })} />}</Field>
          <Field label="Challan serial no.">{(p) => <Input {...p} maxLength={5} inputMode="numeric" value={f.challanSerial} onChange={(e) => setF({ ...f, challanSerial: e.target.value.replace(/\D/g, "") })} />}</Field>
        </div>
      </div>
    </Dialog>
  );
}
