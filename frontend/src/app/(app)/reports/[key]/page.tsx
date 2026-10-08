"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FileSpreadsheet, FileText, Printer } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ItemPicker } from "@/components/item-picker";
import { ReportTable } from "@/components/reports/report-table";
import { PartyPicker, type PickedParty } from "@/components/party-picker";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, apiDownload, ApiError } from "@/lib/api";
import { useWarehouses } from "@/lib/masters";
import { formatCell, type Catalogue, type ReportParam, type ReportResult } from "@/lib/reports";

export default function ReportPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <ReportView />
    </Suspense>
  );
}

function ReportView() {
  const { key } = useParams<{ key: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const cat = useQuery({ queryKey: ["reports", "catalogue"], queryFn: () => api<Catalogue>("/reports") });
  const def = cat.data?.reports.find((r) => r.key === key);
  const params = def?.kind === "query" ? def.params : [];
  const applied: Record<string, string> = Object.fromEntries(params.map((p) => [p.key, search.get(p.key) ?? p.default ?? ""]));
  const missing = params.some((p) => p.required && !applied[p.key]);
  const run = useQuery({
    queryKey: ["reports", key, applied],
    queryFn: () => api<ReportResult>(`/reports/${key}`, { query: Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) }),
    enabled: def?.kind === "query" && !missing,
    retry: false,
  });
  const [error, setError] = useState<string | null>(null);

  if (cat.isLoading) return <LoadingBlock />;
  if (cat.error) return <ErrorBlock error={cat.error} />;
  if (!def) return <Alert>This report does not exist or you do not have access to it.</Alert>;
  if (def.kind === "link") {
    return (
      <Alert tone="warning">
        {def.title} has its own screen. <Link className="font-medium underline" href={def.href}>Open {def.title.toLowerCase()}</Link>
      </Alert>
    );
  }

  const apply = (values: Record<string, string>) => {
    const qs = new URLSearchParams(Object.entries(values).filter(([, v]) => v) as [string, string][]);
    router.replace(`${pathname}?${qs.toString()}`);
  };
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v) as [string, string][]);
  async function exportAs(format: "xlsx" | "csv") {
    setError(null);
    try {
      await apiDownload(`/reports/${key}/export?${qs.toString()}${format === "csv" ? "&format=csv" : ""}`, `${key}.${format}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not download the file.");
    }
  }

  const data = run.data;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <Link href="/reports" className="text-sm text-muted hover:text-foreground">← Reports</Link>
        <PageHeader
          title={def.title}
          description={def.description}
          actions={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => exportAs("xlsx")} disabled={!data}><FileSpreadsheet className="size-4" aria-hidden /> Excel</Button>
              <Button variant="secondary" onClick={() => exportAs("csv")} disabled={!data}><FileText className="size-4" aria-hidden /> CSV</Button>
              <Link href={`/reports/schedules?report=${key}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"><CalendarClock className="size-4" aria-hidden /> Schedule</Link>
              <Link href={`/print/reports/${key}?${qs.toString()}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"><Printer className="size-4" aria-hidden /> Print / PDF</Link>
            </div>
          }
        />
      </div>
      {params.length > 0 && <ParamsForm key={qs.toString()} params={params} applied={applied} onApply={apply} />}
      {error && <Alert>{error}</Alert>}
      {missing && <Alert tone="warning">Choose {params.filter((p) => p.required && !applied[p.key]).map((p) => p.label.toLowerCase()).join(", ")} to run this report.</Alert>}
      {run.isFetching && !data && <LoadingBlock />}
      {run.error && <ErrorBlock error={run.error} />}
      {data && (
        <>
          {data.truncated && <Alert tone="warning">Showing the first 10,000 rows. Narrow the filters to see the rest.</Alert>}
          {data.chart && data.rows.length > 1 && <Chart data={data} />}
          <ReportTable data={data} name={key} />
        </>
      )}
    </div>
  );
}

function ParamsForm({ params, applied, onApply }: { params: ReportParam[]; applied: Record<string, string>; onApply: (v: Record<string, string>) => void }) {
  const whs = useWarehouses();
  const [v, setV] = useState<Record<string, string>>(applied);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [party, setParty] = useState<PickedParty | null>(null);
  return (
    <Card className="flex flex-wrap items-end gap-3 p-4">
      {params.map((p) => (
        <Field key={p.key} label={p.label} required={p.required} className={p.type === "item" || p.type === "party" ? "w-72" : "w-44"}>
          {(a) =>
            p.type === "date" ? (
              <Input {...a} type="date" value={v[p.key] ?? ""} onChange={(e) => setV({ ...v, [p.key]: e.target.value })} />
            ) : p.type === "number" ? (
              <Input {...a} inputMode="numeric" value={v[p.key] ?? ""} onChange={(e) => setV({ ...v, [p.key]: e.target.value })} />
            ) : p.type === "select" ? (
              <Select {...a} value={v[p.key] ?? ""} onChange={(e) => setV({ ...v, [p.key]: e.target.value })}>{p.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            ) : p.type === "warehouse" ? (
              <Select {...a} value={v[p.key] ?? ""} onChange={(e) => setV({ ...v, [p.key]: e.target.value })}>
                <option value="">All</option>
                {whs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}
              </Select>
            ) : p.type === "party" ? (
              <PartyPicker
                id={a.id}
                role={p.label === "Vendor" ? "vendor" : "customer"}
                value={party}
                onChange={(x) => {
                  setParty(x);
                  setV({ ...v, [p.key]: x?.id ?? "" });
                }}
              />
            ) : v[p.key] ? (
              <div className="flex h-10 items-center gap-2 text-sm">
                <span className="truncate">{labels[p.key] ?? "Selected item"}</span>
                <Button size="sm" variant="ghost" onClick={() => setV({ ...v, [p.key]: "" })}>Clear</Button>
              </div>
            ) : (
              <ItemPicker
                onPick={(it) => {
                  setV({ ...v, [p.key]: it.id });
                  setLabels({ ...labels, [p.key]: `${it.code} ${it.name}` });
                }}
              />
            )
          }
        </Field>
      ))}
      <Button onClick={() => onApply(v)}>Run</Button>
    </Card>
  );
}

function Chart({ data }: { data: ReportResult }) {
  const c = data.chart!;
  const labelCol = data.columns.find((x) => x.key === c.label)!;
  const valueCol = data.columns.find((x) => x.key === c.value)!;
  const top = [...data.rows].filter((r) => r[c.value] !== null).sort((x, y) => Number(y[c.value]) - Number(x[c.value])).slice(0, 12);
  const max = Math.max(1, ...top.map((r) => Math.abs(Number(r[c.value]))));
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-medium">{valueCol.label} by {labelCol.label.toLowerCase()}{data.rows.length > 12 ? " (top 12)" : ""}</p>
      <ul className="space-y-1.5 text-sm">
        {top.map((r, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3">
            <span className="truncate">{formatCell(labelCol, r[c.label])}</span>
            <span className="h-3 rounded-full bg-surface-muted"><span className={`block h-3 rounded-full ${Number(r[c.value]) < 0 ? "bg-danger" : "bg-primary"}`} style={{ width: `${(Math.abs(Number(r[c.value])) / max) * 100}%` }} /></span>
            <span className="text-right tabular-nums">{formatCell(valueCol, r[c.value])}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
