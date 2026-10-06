"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney, todayIST } from "@/lib/documents";

type H = { taxable?: string; igst: string; cgst: string; sgst: string; cess: string };
interface Gstr3b {
  table31: Record<"a" | "b" | "c" | "d" | "e", H>;
  table32: { pos: string; taxable: string; igst: string }[];
  table4: { imports: { igst: string; cess: string }; reverseCharge: H; others: H; reversed: H; net: H; ineligible: H };
  table5: { inter: string; intra: string };
  ledger: { liability: H; credit: H; rcm: H };
  setOff: { utilised: Record<"igst" | "cgst" | "sgst" | "cess", Record<"igst" | "cgst" | "sgst" | "cess", string>>; cash: Record<string, string>; creditLeft: Record<string, string> };
  cashPayable: Record<"igst" | "cgst" | "sgst" | "cess", string>;
}

const HEADS = ["igst", "cgst", "sgst", "cess"] as const;
const LABEL = { igst: "IGST", cgst: "CGST", sgst: "SGST / UTGST", cess: "Cess" };

function Row({ label, v, withTaxable = true }: { label: string; v: H; withTaxable?: boolean }) {
  return (
    <tr>
      <td className="px-4 py-2">{label}</td>
      {withTaxable && <td className="px-4 py-2 text-right tabular-nums">{v.taxable !== undefined ? formatMoney(v.taxable) : ""}</td>}
      {HEADS.map((h) => <td key={h} className="px-4 py-2 text-right tabular-nums">{formatMoney(v[h])}</td>)}
    </tr>
  );
}

export default function Gstr3bPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(todayIST().slice(0, 7));
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: React.ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["gst", "gstr3b", period], queryFn: () => api<Gstr3b>("/gst/gstr3b", { query: { period } }) });
  async function settle() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ journalId: string; number: string; cashPayable: string }>("/gst/gstr3b/settle", { body: { period } });
      setMsg({ tone: "success", text: <>Set-off posted in <Link href={`/accounting/journals/${r.journalId}`} className="underline">{r.number}</Link>. Cash to pay: {formatMoney(r.cashPayable)} (record it as a payment against “GST payable”).</> });
      qc.invalidateQueries({ queryKey: ["gst", "gstr3b"] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  const d = q.data;
  const head = (withTaxable = true) => (
    <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
      <tr><th className="px-4 py-2 font-medium">Nature</th>{withTaxable && <th className="px-4 py-2 text-right font-medium">Taxable</th>}{HEADS.map((h) => <th key={h} className="px-4 py-2 text-right font-medium">{LABEL[h]}</th>)}</tr>
    </thead>
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="GSTR-3B" description="Summary return computed from the month's posted documents, and the set-off of input credit against output tax." actions={d && can("accounting.tax.manage") ? <Button loading={busy} onClick={settle}>Post set-off</Button> : undefined} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card><div className="px-5 py-4"><Field label="Return period">{(f) => <Input {...f} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />}</Field></div></Card>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {d && (
        <>
          <Card>
            <CardHeader title="3.1 Outward and reverse-charge inward supplies" />
            <table className="w-full border-t border-border text-sm">
              {head()}
              <tbody className="divide-y divide-border">
                <Row label="(a) Taxable outward supplies" v={d.table31.a} />
                <Row label="(b) Zero-rated (exports, SEZ)" v={d.table31.b} />
                <Row label="(c) Nil-rated and exempt" v={d.table31.c} />
                <Row label="(d) Inward supplies on reverse charge" v={d.table31.d} />
                <Row label="(e) Non-GST outward supplies" v={d.table31.e} />
              </tbody>
            </table>
          </Card>
          <Card>
            <CardHeader title="4 Eligible input tax credit" />
            <table className="w-full border-t border-border text-sm">
              {head(false)}
              <tbody className="divide-y divide-border">
                <Row withTaxable={false} label="(A)(1) Import of goods" v={{ igst: d.table4.imports.igst, cgst: "0", sgst: "0", cess: d.table4.imports.cess }} />
                <Row withTaxable={false} label="(A)(3) Inward supplies on reverse charge" v={d.table4.reverseCharge} />
                <Row withTaxable={false} label="(A)(5) All other ITC" v={d.table4.others} />
                <Row withTaxable={false} label="(B) ITC reversed (debit notes)" v={d.table4.reversed} />
                <tr className="font-semibold"><td className="px-4 py-2">(C) Net ITC available</td>{HEADS.map((h) => <td key={h} className="px-4 py-2 text-right tabular-nums">{formatMoney(d.table4.net[h])}</td>)}</tr>
                <Row withTaxable={false} label="(D) Ineligible ITC (s.17(5))" v={d.table4.ineligible} />
              </tbody>
            </table>
          </Card>
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader title="3.2 Inter-state supplies to unregistered persons" />
              <ul className="divide-y divide-border border-t border-border text-sm">
                {d.table32.map((r) => <li key={r.pos} className="flex justify-between px-5 py-2"><span>State {r.pos}</span><span className="tabular-nums">{formatMoney(r.taxable)} · IGST {formatMoney(r.igst)}</span></li>)}
                {!d.table32.length && <li className="px-5 py-3 text-muted">None</li>}
              </ul>
            </Card>
            <Card>
              <CardHeader title="5 Exempt, nil and non-GST inward supplies" />
              <dl className="grid grid-cols-2 gap-4 border-t border-border px-5 py-4 text-sm"><div><dt className="text-xs text-muted">Inter-state</dt><dd className="tabular-nums">{formatMoney(d.table5.inter)}</dd></div><div><dt className="text-xs text-muted">Intra-state</dt><dd className="tabular-nums">{formatMoney(d.table5.intra)}</dd></div></dl>
            </Card>
          </div>
          <Card>
            <CardHeader title="6.1 Payment of tax" description="On the tax ledgers as at the period end: IGST credit is used first, then CGST and SGST (never across each other); reverse-charge tax is paid in cash." />
            <table className="w-full border-t border-border text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="px-4 py-2 font-medium">Tax</th><th className="px-4 py-2 text-right font-medium">Liability</th><th className="px-4 py-2 text-right font-medium">Paid by IGST</th><th className="px-4 py-2 text-right font-medium">by CGST</th><th className="px-4 py-2 text-right font-medium">by SGST</th><th className="px-4 py-2 text-right font-medium">by cess</th><th className="px-4 py-2 text-right font-medium">Cash (incl. RCM)</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {HEADS.map((h) => (
                  <tr key={h}>
                    <td className="px-4 py-2">{LABEL[h]}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(d.ledger.liability[h])}</td>
                    {HEADS.map((c) => <td key={c} className="px-4 py-2 text-right tabular-nums">{Number(d.setOff.utilised[h][c]) ? formatMoney(d.setOff.utilised[h][c]) : "—"}</td>)}
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(d.cashPayable[h])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border px-5 py-3 text-sm text-muted">Credit carried forward: {HEADS.map((h) => `${LABEL[h]} ${formatMoney(d.setOff.creditLeft[h])}`).join(" · ")}</p>
          </Card>
        </>
      )}
    </div>
  );
}
