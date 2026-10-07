"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { formatDate } from "@/lib/documents";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Study {
  id: string; code: string; item: string; batchNo: string; protocolNo: string | null; kind: string; temperatureC: number; humidityPct: number | null; packing: string | null; startDate: string; status: string; claimedShelfLifeMonths: number | null;
  tests: { name: string; unit?: string | null; min?: number | null; max?: number | null }[];
  results: { id: string; timePoint: number; test: string; value: number; ok: boolean; testedOn: string; deviationId: string | null }[];
  schedule: { timePoint: number; pullDate: string; tested: boolean; overdue: boolean; oos: number }[];
  trends: { test: string; unit: string | null; min: number | null; max: number | null; slopePerMonth: number | null; shelfLifeMonths: number | null; limitedBy: string | null }[];
  supportedShelfLifeMonths: number | null;
}

/** A stability study: results by time point, trends and the shelf life they support. */
export default function StudyPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["/pharma/stability", id], queryFn: () => api<Study>(`/pharma/stability/${id}`) });
  const [tp, setTp] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const s = q.data;
  if (!s) return null;
  async function save() {
    setError(null);
    try {
      await api(`/pharma/stability/${id}/results`, { body: { timePoint: Number(tp), results: Object.entries(values).filter(([, v]) => v !== "").map(([test, v]) => ({ test, value: Number(v) })) } });
      setValues({});
      qc.invalidateQueries({ queryKey: ["/pharma/stability"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const cell = (t: number, test: string) => s.results.find((r) => r.timePoint === t && r.test === test);
  const shortfall = s.claimedShelfLifeMonths && s.supportedShelfLifeMonths !== null && s.supportedShelfLifeMonths < s.claimedShelfLifeMonths;
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={`Stability study ${s.code}`} description={`${s.item} · batch ${s.batchNo} · ${s.temperatureC} °C${s.humidityPct ? ` / ${s.humidityPct} % RH` : ""}${s.packing ? ` · ${s.packing}` : ""}${s.protocolNo ? ` · protocol ${s.protocolNo}` : ""}`} actions={s.status === "active" && can("pharma.stability.manage") && <Button variant="ghost" onClick={async () => { await api(`/pharma/stability/${id}/status`, { body: { status: "completed" } }); qc.invalidateQueries({ queryKey: ["/pharma/stability"] }); }}>Complete study</Button>} />
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-sm text-muted">Shelf life the data supports</p><p className={`text-2xl font-semibold ${shortfall ? "text-danger" : ""}`}>{s.supportedShelfLifeMonths !== null ? `${s.supportedShelfLifeMonths} months` : "needs 3 time points"}</p>{s.claimedShelfLifeMonths && <p className="text-xs text-muted">claimed {s.claimedShelfLifeMonths} months</p>}</Card>
        <Card className="p-4 sm:col-span-2 text-sm"><p className="mb-1 text-muted">By test (one-sided 95 % confidence bound of the trend)</p>{s.trends.map((t) => <p key={t.test}>{t.test}: {t.slopePerMonth !== null ? `${t.slopePerMonth > 0 ? "+" : ""}${t.slopePerMonth} ${t.unit ?? ""}/month · ` : ""}{t.shelfLifeMonths !== null ? `${t.shelfLifeMonths} months${t.limitedBy === "extrapolation" ? " (limit of extrapolation)" : ""}` : "–"}</p>)}</Card>
      </div>
      <Card>
        <CardHeader title="Results" />
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Time point</th>{s.tests.map((t) => <th key={t.name} className="px-3 py-2 font-medium">{t.name}<span className="block font-normal">{t.min ?? "–"} to {t.max ?? "–"} {t.unit ?? ""}</span></th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {s.schedule.map((p) => (
                <tr key={p.timePoint}>
                  <td className="px-3 py-1.5">{p.timePoint} M<span className="block text-xs text-muted">{formatDate(p.pullDate)}{p.overdue && <Badge tone="danger" className="ml-1">overdue</Badge>}</span></td>
                  {s.tests.map((t) => {
                    const r = cell(p.timePoint, t.name);
                    return <td key={t.name} className={`px-3 py-1.5 tabular-nums ${r && !r.ok ? "font-semibold text-danger" : ""}`}>{r ? r.value : "–"}{r?.deviationId && <Link className="ml-1 text-xs text-primary hover:underline" href={`/quality/deviations/${r.deviationId}`}>OOS</Link>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.status === "active" && can("pharma.stability.manage") && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-4 text-sm">
            <Select className="h-9 w-32" aria-label="Time point" value={tp} onChange={(e) => setTp(e.target.value)}><option value="">Time point…</option>{s.schedule.map((p) => <option key={p.timePoint} value={p.timePoint}>{p.timePoint} months</option>)}</Select>
            {s.tests.map((t) => <label key={t.name} className="flex flex-col text-xs">{t.name}<Input className="h-9 w-28" type="number" step="any" value={values[t.name] ?? ""} onChange={(e) => setValues({ ...values, [t.name]: e.target.value })} /></label>)}
            <Button disabled={tp === "" || !Object.values(values).some((v) => v !== "")} onClick={save}>Record</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
