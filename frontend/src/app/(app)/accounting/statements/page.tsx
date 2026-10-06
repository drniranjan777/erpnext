"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Printer } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { ACC } from "@/lib/accounting";
import { formatMoney, todayIST } from "@/lib/documents";

interface Line { key: string; label: string; amount: string; previous: string | null; accounts: { id: string; code: string; name: string; amount: string }[] }
interface Group { label: string; lines: Line[]; total: string; previous: string | null }
interface Bs { asOf: string; previousAsOf: string | null; equityAndLiabilities: { groups: Group[]; total: string; previous: string | null }; assets: { groups: Group[]; total: string; previous: string | null }; balanced: boolean }
interface Pl { from: string; to: string; income: Line[]; totalIncome: { amount: string; previous: string | null }; expenses: Line[]; totalExpenses: { amount: string; previous: string | null }; profitBeforeTax: { amount: string; previous: string | null } }
interface Cf { from: string; to: string; operating: { lines: { label: string; amount: string }[]; total: string }; investing: { lines: { label: string; amount: string }[]; total: string }; financing: { lines: { label: string; amount: string }[]; total: string }; netChange: string; openingCash: string; closingCash: string; difference: string }
type Ratios = Record<string, number | null | string>;

const fyStart = () => {
  const [y, m] = todayIST().split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
};

function Amount({ v }: { v: string | null }) {
  if (v === null) return null;
  const n = Number(v);
  return <span className="tabular-nums">{n < 0 ? `(${formatMoney(Math.abs(n))})` : formatMoney(n)}</span>;
}

function Row({ line, compare, from, to }: { line: Line; compare: boolean; from?: string; to: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td className="px-4 py-2 pl-8">
          {line.accounts.length > 0 ? (
            <button type="button" className="inline-flex items-center gap-1 text-left hover:underline" onClick={() => setOpen(!open)}>
              {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
              {line.label}
            </button>
          ) : (
            <span className="pl-5">{line.label}</span>
          )}
        </td>
        <td className="px-4 py-2 text-right"><Amount v={line.amount} /></td>
        {compare && <td className="px-4 py-2 text-right text-muted"><Amount v={line.previous} /></td>}
      </tr>
      {open &&
        line.accounts.map((a) => (
          <tr key={a.id} className="text-xs text-muted print:hidden">
            <td className="px-4 py-1 pl-16">{a.id === "profit" ? a.name : <Link href={`${ACC}/ledger?accountId=${a.id}${from ? `&from=${from}` : ""}&to=${to}`} className="hover:underline">{a.code} {a.name}</Link>}</td>
            <td className="px-4 py-1 text-right"><Amount v={a.amount} /></td>
            {compare && <td />}
          </tr>
        ))}
    </>
  );
}

export default function StatementsPage() {
  const [tab, setTab] = useState<"pl" | "bs" | "cf" | "ratios">("pl");
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIST());
  const [compare, setCompare] = useState(true);
  const query = { from, to, compare: compare ? "previous_year" : "none" };
  const pl = useQuery({ queryKey: [ACC, "pl", query], queryFn: () => api<Pl>(`${ACC}/statements/profit-and-loss`, { query }), enabled: tab === "pl" });
  const bs = useQuery({ queryKey: [ACC, "bs", query], queryFn: () => api<Bs>(`${ACC}/statements/balance-sheet`, { query }), enabled: tab === "bs" });
  const cf = useQuery({ queryKey: [ACC, "cf", query], queryFn: () => api<Cf>(`${ACC}/statements/cash-flow`, { query }), enabled: tab === "cf" });
  const ratios = useQuery({ queryKey: [ACC, "ratios", query], queryFn: () => api<Ratios>(`${ACC}/statements/ratios`, { query }), enabled: tab === "ratios" });
  const head = (label: string) => (
    <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
      <tr><th className="px-4 py-2.5 font-medium">{label}</th><th className="px-4 py-2.5 text-right font-medium">This period</th>{compare && <th className="px-4 py-2.5 text-right font-medium">Previous year</th>}</tr>
    </thead>
  );
  const total = (label: string, amount: string, previous: string | null, strong = true) => (
    <tr className={strong ? "border-t-2 border-border font-semibold" : "font-medium"}><td className="px-4 py-2">{label}</td><td className="px-4 py-2 text-right"><Amount v={amount} /></td>{compare && <td className="px-4 py-2 text-right text-muted"><Amount v={previous} /></td>}</tr>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Financial statements" description="Schedule III Balance Sheet and Statement of Profit and Loss, cash flow (indirect method) and ratios. Click a line to see its accounts." actions={<Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Print</Button>} />
      <Card className="print:hidden">
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <Field label="Statement">{(f) => <Select {...f} value={tab} onChange={(e) => setTab(e.target.value as typeof tab)}><option value="pl">Profit and loss</option><option value="bs">Balance sheet</option><option value="cf">Cash flow</option><option value="ratios">Ratios</option></Select>}</Field>
          {tab !== "bs" && <Field label="From">{(f) => <Input {...f} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>}
          <Field label={tab === "bs" ? "As of" : "To"}>{(f) => <Input {...f} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          {(tab === "pl" || tab === "bs") && <Field label="Compare">{(f) => <Select {...f} value={compare ? "y" : "n"} onChange={(e) => setCompare(e.target.value === "y")}><option value="y">With previous year</option><option value="n">No</option></Select>}</Field>}
        </div>
      </Card>
      {tab === "pl" && (pl.isLoading ? <LoadingBlock /> : pl.error ? <ErrorBlock error={pl.error} /> : pl.data && (
        <Card>
          <table className="w-full text-sm">
            {head("Statement of Profit and Loss")}
            <tbody>
              {pl.data.income.map((l) => <Row key={l.key} line={l} compare={compare} from={from} to={to} />)}
              {total("Total income", pl.data.totalIncome.amount, pl.data.totalIncome.previous, false)}
              <tr><td className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-muted" colSpan={3}>Expenses</td></tr>
              {pl.data.expenses.map((l) => <Row key={l.key} line={l} compare={compare} from={from} to={to} />)}
              {total("Total expenses", pl.data.totalExpenses.amount, pl.data.totalExpenses.previous, false)}
              {total("Profit before tax", pl.data.profitBeforeTax.amount, pl.data.profitBeforeTax.previous)}
            </tbody>
          </table>
        </Card>
      ))}
      {tab === "bs" && (bs.isLoading ? <LoadingBlock /> : bs.error ? <ErrorBlock error={bs.error} /> : bs.data && (
        <Card>
          <div className="flex justify-end px-5 pt-3">{bs.data.balanced ? <Badge tone="success">Balanced</Badge> : <Badge tone="danger">Out of balance</Badge>}</div>
          {([["Equity and liabilities", bs.data.equityAndLiabilities], ["Assets", bs.data.assets]] as const).map(([label, side]) => (
            <table key={label} className="w-full text-sm">
              {head(label)}
              <tbody>
                {side.groups.map((g) => (
                  <Fragment key={g.label}>
                    <tr><td className="px-4 pt-3 font-medium" colSpan={3}>{g.label}</td></tr>
                    {g.lines.map((l) => <Row key={l.key} line={l} compare={compare} to={to} />)}
                    {total(`Total ${g.label.toLowerCase()}`, g.total, g.previous, false)}
                  </Fragment>
                ))}
                {total(`Total ${label.toLowerCase()}`, side.total, side.previous)}
              </tbody>
            </table>
          ))}
        </Card>
      ))}
      {tab === "cf" && (cf.isLoading ? <LoadingBlock /> : cf.error ? <ErrorBlock error={cf.error} /> : cf.data && (
        <Card>
          <table className="w-full text-sm">
            <tbody>
              {([["A. Cash flow from operating activities", cf.data.operating], ["B. Cash flow from investing activities", cf.data.investing], ["C. Cash flow from financing activities", cf.data.financing]] as const).map(([label, sec]) => (
                <Fragment key={label}>
                  <tr><td className="px-4 pt-4 font-medium" colSpan={2}>{label}</td></tr>
                  {sec.lines.map((l) => <tr key={l.label}><td className="px-4 py-1.5 pl-8">{l.label}</td><td className="px-4 py-1.5 text-right"><Amount v={l.amount} /></td></tr>)}
                  <tr className="font-medium"><td className="px-4 py-2">Net cash from {label.split(" from ")[1]}</td><td className="px-4 py-2 text-right"><Amount v={sec.total} /></td></tr>
                </Fragment>
              ))}
              <tr className="border-t-2 border-border font-semibold"><td className="px-4 py-2">Net increase / (decrease) in cash (A + B + C)</td><td className="px-4 py-2 text-right"><Amount v={cf.data.netChange} /></td></tr>
              <tr><td className="px-4 py-1.5">Cash and cash equivalents at the start</td><td className="px-4 py-1.5 text-right"><Amount v={cf.data.openingCash} /></td></tr>
              <tr className="font-semibold"><td className="px-4 py-1.5">Cash and cash equivalents at the end</td><td className="px-4 py-1.5 text-right"><Amount v={cf.data.closingCash} /></td></tr>
              {Number(cf.data.difference) !== 0 && <tr><td className="px-4 py-2 text-danger" colSpan={2}>Unreconciled difference {formatMoney(cf.data.difference)}</td></tr>}
            </tbody>
          </table>
        </Card>
      ))}
      {tab === "ratios" && (ratios.isLoading ? <LoadingBlock /> : ratios.error ? <ErrorBlock error={ratios.error} /> : ratios.data && (
        <Card>
          <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
            {([["currentRatio", "Current ratio", ""], ["quickRatio", "Quick ratio", ""], ["debtEquity", "Debt / equity", ""], ["grossMarginPct", "Gross margin", "%"], ["netMarginPct", "Net margin (before tax)", "%"], ["returnOnEquityPct", "Return on equity", "%"], ["debtorDays", "Debtor days", " days"], ["creditorDays", "Creditor days", " days"], ["inventoryDays", "Inventory days", " days"]] as const).map(([k, label, unit]) => (
              <div key={k}><dt className="text-xs text-muted">{label}</dt><dd className="text-lg font-semibold tabular-nums">{ratios.data![k] === null ? "—" : `${ratios.data![k]}${unit}`}</dd></div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}
