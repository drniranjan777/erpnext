"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { inr, monthLabel, PAY } from "@/lib/payroll";

interface Slip { id: string; month: string; gross: string; totalDeductions: string; net: string }
interface Decl { employeeId: string; fullName: string; fy: string; regime: "new" | "old"; data: Record<string, number> }
const FIELDS: [string, string, boolean][] = [
  ["section80C", "Section 80C (PF, PPF, ELSS, insurance, tuition…), up to ₹1.5 lakh", true],
  ["section80D", "Section 80D health insurance", true],
  ["hraExemption", "HRA exemption", true],
  ["otherDeductions", "Other deductions (80CCD(1B), home-loan interest…)", true],
  ["employerNps", "Employer NPS, section 80CCD(2)", false],
  ["previousIncome", "Salary from a previous employer this year", false],
  ["previousTds", "TDS deducted by the previous employer", false],
];

/** An employee's own payslips and income-tax declaration. */
export default function MyPayPage() {
  const slips = useQuery({ queryKey: [PAY, "mine"], queryFn: () => api<Slip[]>(`${PAY}/payslips/mine`), retry: false });
  const decl = useQuery({ queryKey: [PAY, "declaration"], queryFn: () => api<Decl>(`${PAY}/declarations`), retry: false });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="My pay" description="Payslips and the income-tax declaration your monthly TDS is worked out from." />
      {slips.isLoading && <LoadingBlock />}
      {slips.error && <ErrorBlock error={slips.error} />}
      {slips.data && (
        <Card>
          <CardHeader title="Payslips" />
          <ul className="divide-y divide-border border-t border-border text-sm">
            {slips.data.map((s) => (
              <li key={s.id} className="flex items-center gap-4 px-5 py-2">
                <Link className="font-medium text-primary hover:underline" href={`/print/payslips/${s.id}`} target="_blank">{monthLabel(s.month)}</Link>
                <span className="text-muted">gross {inr(s.gross)} · deductions {inr(s.totalDeductions)}</span>
                <span className="ml-auto font-medium tabular-nums">{inr(s.net)}</span>
              </li>
            ))}
            {!slips.data.length && <li className="px-5 py-4 text-muted">No payslips yet.</li>}
          </ul>
        </Card>
      )}
      {decl.data && <Declaration d={decl.data} />}
    </div>
  );
}

function Declaration({ d }: { d: Decl }) {
  const [regime, setRegime] = useState(d.regime);
  const [data, setData] = useState<Record<string, string>>(Object.fromEntries(Object.entries(d.data).map(([k, v]) => [k, String(v)])));
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      await api(`${PAY}/declarations`, { method: "PUT", body: { fy: d.fy, regime, data: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) } });
      setMsg({ tone: "success", text: "Saved. Next month's TDS uses it." });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <Card>
      <CardHeader title={`Tax declaration ${d.fy}`} description="The new regime has lower rates and no deductions besides the standard deduction and employer NPS; the old regime allows the deductions below." />
      <div className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-2">
        {msg && <div className="sm:col-span-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        <Field label="Tax regime">{(p) => <Select {...p} value={regime} onChange={(e) => setRegime(e.target.value as "new" | "old")}><option value="new">New regime (default)</option><option value="old">Old regime</option></Select>}</Field>
        {FIELDS.filter(([, , oldOnly]) => !oldOnly || regime === "old").map(([k, label]) => <Field key={k} label={label}>{(p) => <Input {...p} inputMode="decimal" value={data[k] ?? ""} onChange={(e) => setData({ ...data, [k]: e.target.value })} />}</Field>)}
        <div className="sm:col-span-2"><Button onClick={save}>Save declaration</Button></div>
      </div>
    </Card>
  );
}
