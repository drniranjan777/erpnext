"use client";

import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayIST } from "@/lib/documents";
import { inr, monthLabel, PAY, RUN_TONE, type Run } from "@/lib/payroll";

export default function PayrollRunsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [month, setMonth] = useState(() => {
    const d = new Date(`${todayIST().slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: [PAY, "runs"], queryFn: () => api<Run[]>(`${PAY}/runs`) });
  async function compute() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Run>(`${PAY}/runs`, { body: { month } });
      router.push(`${PAY}/runs/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Payroll" description="Compute a month from salaries, the attendance muster, overtime, piece rate, inputs and loans; review; approve to post the salary journal and lock attendance." />
      {can("payroll.runs.manage") && (
        <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Month</span>
            <Input type="month" className="w-44" max={todayIST().slice(0, 7)} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
          <Button disabled={busy} onClick={compute}><Calculator className="size-4" aria-hidden /> {busy ? "Computing…" : "Compute payroll"}</Button>
          <p className="text-xs text-muted">Process attendance for the month first. A draft can be recomputed as often as needed.</p>
        </Card>
      )}
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Month</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 text-right font-medium">Employees</th><th className="px-4 py-2 text-right font-medium">Gross</th><th className="px-4 py-2 text-right font-medium">Net pay</th><th className="px-4 py-2 text-right font-medium">Employer cost</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><Link className="font-medium text-primary hover:underline" href={`${PAY}/runs/${r.id}`}>{monthLabel(r.month)}</Link></td>
                  <td className="px-4 py-2"><Badge tone={RUN_TONE[r.status]}>{r.status}</Badge>{r.warnings.length > 0 && <span className="ml-2 text-xs text-warning">{r.warnings.length} warning(s)</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.totals.employees ?? 0}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr(r.totals.gross)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr(r.totals.net)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr(r.totals.employer)}</td>
                </tr>
              ))}
              {!q.data.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No payroll yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
