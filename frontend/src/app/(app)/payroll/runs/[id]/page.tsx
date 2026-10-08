"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Banknote, Calculator, Download, FileText, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, apiDownload, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayIST } from "@/lib/documents";
import { inr, monthLabel, PAY, RUN_TONE, type PayLine, type RunView } from "@/lib/payroll";
import { askConfirm } from "@/components/ui/ask";

type Tab = "payslips" | "statutory";
const amt = (ls: PayLine[], code: string) => ls.filter((l) => l.code === code).reduce((s, l) => s + Number(l.amount), 0);

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [PAY, "runs", id], queryFn: () => api<RunView>(`${PAY}/runs/${id}`) });
  const [tab, setTab] = useState<Tab>("payslips");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(path: string, body: unknown = {}, confirmText?: string) {
    if (confirmText && !await askConfirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await api(path, { body });
      await qc.invalidateQueries({ queryKey: [PAY] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const r = q.data!;
  const s = r.statutory;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={`Payroll ${monthLabel(r.month)}`}
        description={`${r.totals.employees ?? 0} employees · gross ${inr(r.totals.gross)} · net ${inr(r.totals.net)} · employer contributions ${inr(r.totals.employer)}`}
        actions={
          <span className="flex flex-wrap gap-2">
            {r.status === "draft" && can("payroll.runs.manage") && <Button variant="secondary" disabled={busy} onClick={() => act(`${PAY}/runs`, { month: r.month })}><Calculator className="size-4" aria-hidden /> Recompute</Button>}
            {r.status === "draft" && can("payroll.runs.approve") && <Button disabled={busy} onClick={() => act(`${PAY}/runs/${r.id}/approve`, {}, "Approve payroll? This posts the salary journal, recovers loans and locks the month's attendance.")}><BadgeCheck className="size-4" aria-hidden /> Approve</Button>}
            {r.status === "approved" && can("payroll.payments.export") && <Button variant="secondary" onClick={() => apiDownload(`${PAY}/runs/${r.id}/bank-file`, `salary-${r.month}.csv`)}><Download className="size-4" aria-hidden /> Bank file</Button>}
            {r.status !== "draft" && <Button variant="secondary" onClick={() => apiDownload(`${PAY}/runs/${r.id}/ecr`, `ECR-${r.month}.txt`)}><FileText className="size-4" aria-hidden /> PF ECR</Button>}
            {r.status === "approved" && can("payroll.runs.approve") && <Button disabled={busy} onClick={() => act(`${PAY}/runs/${r.id}/paid`, { paidOn: todayIST() }, "Mark salaries as paid? The payroll can no longer be reopened.")}><Banknote className="size-4" aria-hidden /> Mark paid</Button>}
            {r.status === "approved" && can("payroll.runs.approve") && <Button variant="ghost" disabled={busy} onClick={() => act(`${PAY}/runs/${r.id}/reopen`, {}, "Reopen payroll? The salary journal is cancelled and attendance unlocked.")}><Undo2 className="size-4" aria-hidden /> Reopen</Button>}
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RUN_TONE[r.status]}>{r.status}</Badge>
        {r.glVoucherId && <Link className="text-sm text-primary hover:underline" href={`/accounting/journals/${r.glVoucherId}`}>Salary journal</Link>}
        {r.paidOn && <span className="text-sm text-muted">Paid on {r.paidOn}</span>}
      </div>
      {error && <Alert>{error}</Alert>}
      {r.warnings.length > 0 && <Alert tone="warning">{r.warnings.join(" · ")}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "payslips", label: "Payslips", count: r.payslips.length }, { value: "statutory", label: "Statutory" }]} />
      {tab === "payslips" && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-2 font-medium">Employee</th><th className="px-3 py-2 text-right font-medium">Paid days</th><th className="px-3 py-2 text-right font-medium">LOP</th><th className="px-3 py-2 text-right font-medium">OT h</th><th className="px-3 py-2 text-right font-medium">Gross</th><th className="px-3 py-2 text-right font-medium">PF</th><th className="px-3 py-2 text-right font-medium">ESI</th><th className="px-3 py-2 text-right font-medium">PT</th><th className="px-3 py-2 text-right font-medium">TDS</th><th className="px-3 py-2 text-right font-medium">Other</th><th className="px-3 py-2 text-right font-medium">Net</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.payslips.map((p) => {
                const other = Number(p.totalDeductions) - amt(p.deductions, "PF") - amt(p.deductions, "ESI") - amt(p.deductions, "PT") - amt(p.deductions, "TDS");
                return (
                  <Fragment key={p.id}>
                    <tr className="cursor-pointer hover:bg-surface-muted" onClick={() => setOpen(open === p.id ? null : p.id)}>
                      <td className="px-4 py-2"><span className="font-medium">{p.fullName}</span> <span className="font-mono text-xs text-muted">{p.code}</span>{p.warnings.length > 0 && <Badge tone="warning" className="ml-1">!</Badge>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(p.payableDays)}/{p.monthDays}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(p.lopDays) || ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(p.otHours) || ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(p.gross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(amt(p.deductions, "PF"))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(amt(p.deductions, "ESI"))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(amt(p.deductions, "PT"))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(p.tds)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{inr(other)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{inr(p.net)}</td>
                    </tr>
                    {open === p.id && (
                      <tr>
                        <td colSpan={11} className="bg-surface-muted/50 px-4 py-3">
                          <div className="grid gap-4 text-xs sm:grid-cols-3">
                            {(["earnings", "deductions", "employer"] as const).map((k) => (
                              <div key={k}>
                                <p className="mb-1 font-medium capitalize">{k === "employer" ? "Employer contributions" : k}</p>
                                {p[k].map((l) => <p key={`${l.code}${l.ref ?? ""}`} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{inr(l.amount)}</span></p>)}
                              </div>
                            ))}
                          </div>
                          {p.warnings.length > 0 && <p className="mt-2 text-xs text-warning">{p.warnings.join(" · ")}</p>}
                          <Link className="mt-2 inline-block text-xs text-primary hover:underline" href={`/print/payslips/${p.id}`} target="_blank">Payslip</Link>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {tab === "statutory" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Provident fund" description={`${s.pf.employees} members`} />
            <dl className="grid grid-cols-2 gap-2 border-t border-border px-5 py-4 text-sm">
              <dt className="text-muted">EPF wages</dt><dd className="text-right tabular-nums">{inr(s.pf.epfWages)}</dd>
              <dt className="text-muted">Employee 12 %</dt><dd className="text-right tabular-nums">{inr(s.pf.employee)}</dd>
              <dt className="text-muted">Employer to EPF</dt><dd className="text-right tabular-nums">{inr(s.pf.employerEpf)}</dd>
              <dt className="text-muted">Employer to EPS 8.33 %</dt><dd className="text-right tabular-nums">{inr(s.pf.eps)}</dd>
              <dt className="text-muted">EDLI 0.5 %</dt><dd className="text-right tabular-nums">{inr(s.pf.edli)}</dd>
            </dl>
            {s.pf.missingUan.length > 0 && <p className="border-t border-border px-5 py-2 text-xs text-warning">Left out of the ECR (no UAN): {s.pf.missingUan.join(", ")}</p>}
          </Card>
          <Card>
            <CardHeader title="ESI" description={`${s.esi.employees} insured`} />
            <dl className="grid grid-cols-2 gap-2 border-t border-border px-5 py-4 text-sm">
              <dt className="text-muted">ESI wages</dt><dd className="text-right tabular-nums">{inr(s.esi.wages)}</dd>
              <dt className="text-muted">Employee 0.75 %</dt><dd className="text-right tabular-nums">{inr(s.esi.employee)}</dd>
              <dt className="text-muted">Employer 3.25 %</dt><dd className="text-right tabular-nums">{inr(s.esi.employer)}</dd>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Professional tax and LWF" />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {s.pt.map((p) => <li key={`pt${p.stateCode}`} className="flex justify-between px-5 py-2"><span>PT · state {p.stateCode} · {p.employees} employees</span><span className="tabular-nums">{inr(p.employee)}</span></li>)}
              {s.lwf.map((p) => <li key={`lwf${p.stateCode}`} className="flex justify-between px-5 py-2"><span>LWF · state {p.stateCode} · {p.employees} employees</span><span className="tabular-nums">{inr(p.employee)} + {inr(p.employer)}</span></li>)}
              {!s.pt.length && !s.lwf.length && <li className="px-5 py-3 text-muted">Nothing this month.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="TDS on salary (section 192)" />
            <p className="border-t border-border px-5 py-4 text-2xl font-semibold tabular-nums">{inr(s.tds)}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
