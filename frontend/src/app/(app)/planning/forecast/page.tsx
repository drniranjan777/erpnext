"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty } from "@/lib/documents";
import { PLAN } from "@/lib/planning";

interface Cell { qty: string; statQty: string | null; override: boolean }
interface Row { item: { id: string; code: string; name: string; uom: string }; method: string | null; mae: string | null; mapePct: string | null; history: string[]; forecast: (Cell | null)[] }
interface Grid { months: string[]; history: string[]; total: number; items: Row[] }

const METHOD: Record<string, string> = { moving_average: "Moving average", exponential: "Exponential smoothing", holt: "Trend (Holt)", seasonal_naive: "Same month last year", holt_winters: "Trend + season (Holt-Winters)" };
const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const PAGE = 50;

export default function ForecastPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("planning.mrp.manage");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const grid = useQuery({ queryKey: [PLAN, "forecasts", search, offset], queryFn: () => api<Grid>(`${PLAN}/forecasts`, { query: { q: search || undefined, limit: PAGE, offset } }) });
  const [horizon, setHorizon] = useState("6");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function generate() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ items: number; months: string[] }>(`${PLAN}/forecasts/generate`, { body: { horizon: Number(horizon) } });
      setMsg({ tone: "success", text: r.items ? `Forecast ${r.items} item${r.items === 1 ? "" : "s"} for ${r.months.length} months. Your overrides were kept.` : "No sales order history yet: nothing to forecast from." });
      await qc.invalidateQueries({ queryKey: [PLAN, "forecasts"] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Demand forecast"
        description="Monthly forecast from sales order history. Each item gets the method that predicted its recent months best (moving average, smoothing, trend, or seasonal with two years of history). Overtype a month to override it; MRP uses the forecast less the orders already booked for that month."
      />
      <Card className="flex flex-wrap items-end gap-4 p-5">
        <Field label="Search">{(p) => <Input {...p} className="w-56" placeholder="Item code or name" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />}</Field>
        {manage && (
          <div className="ml-auto flex items-end gap-3">
            <Field label="Months ahead">{(p) => <Select {...p} value={horizon} onChange={(e) => setHorizon(e.target.value)}>{[3, 6, 9, 12, 18].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}</Field>
            <Button onClick={generate} loading={busy}><RefreshCw className="size-4" aria-hidden /> Forecast from history</Button>
          </div>
        )}
      </Card>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {grid.isLoading && <LoadingBlock />}
      {grid.error && <ErrorBlock error={grid.error} />}
      {grid.data && !grid.data.items.length && <EmptyState title="No forecast yet" description={manage ? "Run “Forecast from history” once you have a few months of sales orders." : "A planner has not forecast demand yet."} />}
      {grid.data && grid.data.items.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="sticky left-0 bg-surface-muted px-4 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Last 12 months</th>
                {grid.data.months.map((m) => <th key={m} className="px-2 py-2 text-right font-medium">{monthLabel(m)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grid.data.items.map((r) => (
                <tr key={r.item.id}>
                  <td className="sticky left-0 bg-surface px-4 py-2">
                    <Link href={`/planning/items/${r.item.id}`} className="hover:underline"><span className="font-mono text-xs text-muted">{r.item.code}</span> {r.item.name}</Link>
                    {r.method && <span className="block text-xs text-muted">{METHOD[r.method] ?? r.method}{r.mapePct && ` · error ${Number(r.mapePct).toFixed(0)}%`}</span>}
                  </td>
                  <td className="px-3 py-2"><Spark values={r.history.map(Number)} /></td>
                  {grid.data.months.map((m, i) => <ForecastCell key={m} itemId={r.item.id} period={m} cell={r.forecast[i]} editable={manage} />)}
                </tr>
              ))}
            </tbody>
          </table>
          {grid.data.total > PAGE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
              <span>{offset + 1}–{Math.min(offset + PAGE, grid.data.total)} of {grid.data.total}</span>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                <Button size="sm" variant="ghost" disabled={offset + PAGE >= grid.data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ForecastCell({ itemId, period, cell, editable }: { itemId: string; period: string; cell: Cell | null; editable: boolean }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const shown = value ?? (cell ? String(Number(cell.qty)) : "");
  async function save(qty: string | null) {
    setValue(null);
    if (qty !== null && cell && Number(qty) === Number(cell.qty)) return;
    try {
      await api(`${PLAN}/forecasts`, { method: "PUT", body: { itemId, period, qty } });
      setError(false);
      await qc.invalidateQueries({ queryKey: [PLAN, "forecasts"] });
    } catch {
      setError(true);
    }
  }
  if (!editable) return <td className={`px-2 py-2 text-right tabular-nums ${cell?.override ? "font-semibold text-primary" : ""}`}>{cell ? formatQty(cell.qty) : "–"}</td>;
  return (
    <td className="px-1 py-1 text-right">
      <Input
        aria-label={`Forecast for ${period}`}
        title={cell?.override ? `Overridden (statistical ${cell.statQty ? formatQty(cell.statQty) : "–"}). Clear to reset.` : undefined}
        className={`h-8 w-20 text-right tabular-nums ${cell?.override ? "border-primary font-semibold text-primary" : ""} ${error ? "border-danger" : ""}`}
        inputMode="decimal"
        value={shown}
        onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
        onBlur={() => value !== null && save(value === "" ? null : value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </td>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 96;
  const h = 24;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg width={w} height={h} role="img" aria-label={`History: ${values.join(", ")}`} className="text-primary">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
