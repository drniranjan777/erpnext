"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Play, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ReportTable } from "@/components/reports/report-table";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, apiDownload, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ColumnType, ReportColumn } from "@/lib/reports";

interface Field_ { key: string; label: string; type: ColumnType; role: "dimension" | "measure"; agg?: string }
interface Dataset { key: string; title: string; description: string; hasDate: boolean; fields: Field_[] }
type Op = "eq" | "ne" | "contains" | "gt" | "gte" | "lt" | "lte" | "in" | "empty" | "not_empty";
interface Spec {
  dataset: string;
  fields: string[];
  filters: { field: string; op: Op; value?: string }[];
  period: { preset: string; from?: string; to?: string };
  group: boolean;
  aggregates: Record<string, string>;
  sort: { field: string; dir: "asc" | "desc" } | null;
  limit: number;
}
interface Result { title: string; columns: ReportColumn[]; rows: Record<string, string | number | null>[]; totals: Record<string, string>; truncated: boolean }

const PERIODS: [string, string][] = [["fytd", "This financial year"], ["mtd", "This month"], ["last_month", "Last month"], ["qtd", "This quarter"], ["last_7", "Last 7 days"], ["last_30", "Last 30 days"], ["last_90", "Last 90 days"], ["today", "Today"], ["last_fy", "Last financial year"], ["all", "All time"], ["custom", "Custom…"]];
const OPS: [Op, string][] = [["eq", "is"], ["ne", "is not"], ["contains", "contains"], ["in", "is one of"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["empty", "is empty"], ["not_empty", "is not empty"]];
const NUMERIC_OPS: Op[] = ["eq", "ne", "gt", "gte", "lt", "lte"];

const blank = (ds: Dataset): Spec => ({ dataset: ds.key, fields: ds.fields.slice(0, 3).map((f) => f.key), filters: [], period: { preset: "fytd" }, group: false, aggregates: {}, sort: null, limit: 1000 });

export default function BuilderPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Builder />
    </Suspense>
  );
}

function Builder() {
  const search = useSearchParams();
  const savedId = search.get("saved");
  const datasets = useQuery({ queryKey: ["report-builder", "datasets"], queryFn: () => api<Dataset[]>("/report-builder/datasets") });
  const saved = useQuery({ queryKey: ["report-builder", "saved", savedId], queryFn: () => api<{ id: string; name: string; description: string | null; spec: Spec; shared: boolean; mine: boolean }>(`/report-builder/saved/${savedId}`), enabled: !!savedId });
  if (datasets.isLoading || (savedId && saved.isLoading)) return <LoadingBlock />;
  if (datasets.error) return <ErrorBlock error={datasets.error} />;
  if (saved.error) return <ErrorBlock error={saved.error} />;
  if (!datasets.data?.length) return <Alert tone="warning">You do not have access to any data to report on.</Alert>;
  const initial = saved.data?.spec ?? blank(datasets.data[0]);
  return <Editor key={savedId ?? "new"} datasets={datasets.data} initial={initial} saved={saved.data ?? null} />;
}

function Editor({ datasets, initial, saved }: { datasets: Dataset[]; initial: Spec; saved: { id: string; name: string; description: string | null; shared: boolean; mine: boolean } | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [spec, setSpec] = useState<Spec>(initial);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const ds = datasets.find((d) => d.key === spec.dataset) ?? datasets[0];
  const set = (p: Partial<Spec>) => setSpec((s) => ({ ...s, ...p }));
  const fieldOf = (k: string) => ds.fields.find((f) => f.key === k);
  const measures = spec.fields.map(fieldOf).filter((f): f is Field_ => !!f && f.role === "measure");

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<Result>("/report-builder/run", { body: spec }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  async function download(format: "xlsx" | "csv") {
    try {
      await apiDownload("/report-builder/export", `${saved?.name ?? "custom-report"}.${format}`, false, { spec, format, title: saved?.name ?? "Custom report" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not download the file.");
    }
  }
  async function remove() {
    if (!saved) return;
    try {
      await api(`/report-builder/saved/${saved.id}`, { method: "DELETE" });
      qc.invalidateQueries({ queryKey: ["report-builder"] });
      router.push("/reports");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div>
        <Link href="/reports" className="text-sm text-muted hover:text-foreground">← Reports</Link>
        <PageHeader
          title={saved?.name ?? "Build a report"}
          description={saved?.description ?? "Choose the data, the columns, filters and grouping. Save it to run again, share it or have it emailed on a schedule."}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => download("xlsx")}><FileSpreadsheet className="size-4" aria-hidden /> Excel</Button>
              <Button variant="secondary" onClick={() => download("csv")}><FileText className="size-4" aria-hidden /> CSV</Button>
              {(!saved || saved.mine || (saved.shared && can("platform.customization.manage"))) && <Button variant="secondary" onClick={() => setSaving(true)}><Save className="size-4" aria-hidden /> {saved ? "Save" : "Save as…"}</Button>}
              {saved && (saved.mine || (saved.shared && can("platform.customization.manage"))) && <Button variant="ghost" onClick={remove} aria-label="Delete this report"><Trash2 className="size-4" aria-hidden /></Button>}
              <Button onClick={run} loading={busy}><Play className="size-4" aria-hidden /> Run</Button>
            </div>
          }
        />
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <Field label="Data">
              {(p) => (
                <Select {...p} value={spec.dataset} onChange={(e) => { const d = datasets.find((x) => x.key === e.target.value)!; setSpec(blank(d)); setResult(null); }}>
                  {datasets.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}
                </Select>
              )}
            </Field>
            <p className="text-xs text-muted">{ds.description}</p>
            {ds.hasDate && (
              <>
                <Field label="Period">{(p) => <Select {...p} value={spec.period.preset} onChange={(e) => set({ period: { preset: e.target.value } })}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
                {spec.period.preset === "custom" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="From">{(p) => <Input {...p} type="date" value={spec.period.from ?? ""} onChange={(e) => set({ period: { ...spec.period, from: e.target.value } })} />}</Field>
                    <Field label="To">{(p) => <Input {...p} type="date" value={spec.period.to ?? ""} onChange={(e) => set({ period: { ...spec.period, to: e.target.value } })} />}</Field>
                  </div>
                )}
              </>
            )}
          </Card>
          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">Columns</p>
            {(["dimension", "measure"] as const).map((role) => (
              <div key={role} className="mb-2">
                <p className="text-xs tracking-wide text-muted uppercase">{role === "dimension" ? "Describe by" : "Measures"}</p>
                {ds.fields.filter((f) => f.role === role).map((f) => (
                  <Checkbox key={f.key} label={f.label} checked={spec.fields.includes(f.key)} onChange={(e) => set({ fields: e.target.checked ? [...spec.fields, f.key] : spec.fields.filter((k) => k !== f.key), sort: spec.sort?.field === f.key && !e.target.checked ? null : spec.sort })} />
                ))}
              </div>
            ))}
          </Card>
          <Card className="space-y-3 p-4">
            <Checkbox label="Group and total the measures" description="One row per combination of the descriptive columns" checked={spec.group} onChange={(e) => set({ group: e.target.checked })} />
            {spec.group && measures.map((m) => (
              <Field key={m.key} label={m.label}>
                {(p) => (
                  <Select {...p} value={spec.aggregates[m.key] ?? m.agg ?? "sum"} onChange={(e) => set({ aggregates: { ...spec.aggregates, [m.key]: e.target.value } })}>
                    <option value="sum">Sum</option><option value="avg">Average</option><option value="min">Lowest</option><option value="max">Highest</option><option value="count">Count of rows</option>
                  </Select>
                )}
              </Field>
            ))}
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Field label="Sort by">{(p) => <Select {...p} value={spec.sort?.field ?? ""} onChange={(e) => set({ sort: e.target.value ? { field: e.target.value, dir: spec.sort?.dir ?? "desc" } : null })}><option value="">—</option>{spec.fields.map((k) => <option key={k} value={k}>{fieldOf(k)?.label ?? k}</option>)}</Select>}</Field>
              <Field label="Order">{(p) => <Select {...p} value={spec.sort?.dir ?? "desc"} disabled={!spec.sort} onChange={(e) => spec.sort && set({ sort: { ...spec.sort, dir: e.target.value as "asc" | "desc" } })}><option value="desc">High → low</option><option value="asc">Low → high</option></Select>}</Field>
            </div>
            <Field label="Row limit">{(p) => <Input {...p} inputMode="numeric" value={String(spec.limit)} onChange={(e) => set({ limit: Math.min(10_000, Math.max(1, Number(e.target.value) || 1)) })} />}</Field>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Filters</p>
              <Button size="sm" variant="ghost" onClick={() => set({ filters: [...spec.filters, { field: ds.fields[0].key, op: "eq", value: "" }] })}><Plus className="size-4" aria-hidden /> Add filter</Button>
            </div>
            {spec.filters.map((f, i) => {
              const fd = fieldOf(f.field);
              const numeric = fd && ["number", "qty", "money", "percent", "date"].includes(fd.type);
              const ops = OPS.filter(([o]) => (numeric ? NUMERIC_OPS.includes(o) || o === "empty" || o === "not_empty" : !["gt", "gte", "lt", "lte"].includes(o)));
              const upd = (p: Partial<Spec["filters"][number]>) => set({ filters: spec.filters.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <div key={i} className="grid grid-cols-[1fr_9rem_1fr_auto] items-center gap-2">
                  <Select aria-label="Field" value={f.field} onChange={(e) => upd({ field: e.target.value, op: "eq", value: "" })}>{ds.fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select>
                  <Select aria-label="Condition" value={f.op} onChange={(e) => upd({ op: e.target.value as Op })}>{ops.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</Select>
                  {f.op === "empty" || f.op === "not_empty" ? <span /> : <Input aria-label="Value" type={fd?.type === "date" ? "date" : "text"} placeholder={f.op === "in" ? "Values, comma separated" : "Value"} value={f.value ?? ""} onChange={(e) => upd({ value: e.target.value })} />}
                  <Button size="sm" variant="ghost" aria-label="Remove filter" onClick={() => set({ filters: spec.filters.filter((_, j) => j !== i) })}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
              );
            })}
            {!spec.filters.length && <p className="text-sm text-muted">No filters: everything in the period.</p>}
          </Card>
          {result ? (
            <>
              {result.truncated && <Alert tone="warning">Showing the first {spec.limit.toLocaleString("en-IN")} rows. Raise the limit or narrow the filters.</Alert>}
              <ReportTable data={result} />
            </>
          ) : (
            <Card className="p-8 text-center text-sm text-muted">Choose the columns and press Run.</Card>
          )}
        </div>
      </div>
      {saving && <SaveDialog spec={spec} saved={saved} canShare={can("platform.customization.manage")} onClose={() => setSaving(false)} onSaved={(id) => { setSaving(false); qc.invalidateQueries({ queryKey: ["report-builder"] }); router.replace(`/reports/builder?saved=${id}`); }} />}
    </div>
  );
}

function SaveDialog({ spec, saved, canShare, onClose, onSaved }: { spec: Spec; saved: { id: string; name: string; description: string | null; shared: boolean } | null; canShare: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ name: saved?.name ?? "", description: saved?.description ?? "", shared: saved?.shared ?? false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(asNew: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body = { name: f.name, description: f.description || null, shared: f.shared, spec };
      const r = saved && !asNew ? await api<{ id: string }>(`/report-builder/saved/${saved.id}`, { method: "PUT", body }) : await api<{ id: string }>("/report-builder/saved", { body });
      onSaved(r.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={saved ? "Save report" : "Save as a new report"} footer={<>{saved && <Button variant="secondary" onClick={() => go(true)} loading={busy}>Save as new</Button>}<Button onClick={() => go(false)} loading={busy}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="space-y-3">
        <Field label="Name" required>{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Description">{(p) => <Input {...p} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        {canShare && <Checkbox label="Share with everyone in the workspace" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} />}
      </div>
    </Dialog>
  );
}
