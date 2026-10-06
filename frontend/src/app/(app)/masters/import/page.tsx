"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { apiDownload, apiUpload, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayIST } from "@/lib/documents";
import {
  IMPORT_KINDS,
  type ImportKind,
  type RowResult,
  type SheetResult,
  type Summary,
  type TallyResult,
} from "@/lib/imports";
import { ITEM_TYPES } from "@/lib/masters";
import { cn } from "@/lib/cn";

type Result =
  { kind: "sheet"; data: SheetResult } | { kind: "tally"; data: TallyResult };

export default function ImportPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>("items");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [opts, setOpts] = useState({
    defaultItemType: "raw_material",
    postingDate: todayIST(),
    post: false,
    includeParties: true,
    includeOpeningStock: true,
    defaultGstRate: "",
  });
  const meta = IMPORT_KINDS[kind];
  const allowed = can(meta.permission);

  const reset = (k = kind) => {
    setKind(k);
    setFile(null);
    setResult(null);
    setError(null);
    if (input.current) input.current.value = "";
  };

  async function run(commit: boolean) {
    if (!file) return;
    setBusy(commit ? "commit" : "preview");
    setError(null);
    const q = new URLSearchParams();
    if (commit && summaryOf(result)?.errors) q.set("skipInvalid", "true");
    if (kind === "items" || kind === "tally")
      q.set("defaultItemType", opts.defaultItemType);
    if (kind === "opening-stock" || kind === "tally") {
      q.set("postingDate", opts.postingDate);
      if (opts.post) q.set("post", "true");
    }
    if (kind === "tally") {
      q.set("includeParties", String(opts.includeParties));
      if (opts.includeOpeningStock) q.set("includeOpeningStock", "true");
      if (opts.defaultGstRate) q.set("defaultGstRate", opts.defaultGstRate);
    }
    try {
      const path = `/imports/${kind}/${commit ? "commit" : "preview"}?${q}`;
      if (kind === "tally")
        setResult({
          kind: "tally",
          data: await apiUpload<TallyResult>(path, file),
        });
      else
        setResult({
          kind: "sheet",
          data: await apiUpload<SheetResult>(path, file),
        });
      if (commit) {
        qc.invalidateQueries({ queryKey: ["masters"] });
        qc.invalidateQueries({ queryKey: ["inventory"] });
      }
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not reach the server. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  const summary = summaryOf(result);
  const committed = result?.data.committed && busy === null && result !== null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Import data"
        description="Bring in masters and opening stock from Excel, CSV or Tally. Every file is checked row by row before anything is saved."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(IMPORT_KINDS) as ImportKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => reset(k)}
            className={cn(
              "rounded-xl border bg-surface p-4 text-left transition hover:border-primary",
              k === kind
                ? "border-primary ring-2 ring-primary/20"
                : "border-border",
            )}
          >
            <p className="font-medium">{IMPORT_KINDS[k].title}</p>
            <p className="mt-1 text-xs text-muted">
              {IMPORT_KINDS[k].description}
            </p>
          </button>
        ))}
      </div>

      {!allowed && (
        <Alert tone="warning">
          You don&apos;t have permission to import {meta.title.toLowerCase()}.
        </Alert>
      )}

      {allowed && (
        <Card>
          <CardHeader
            title={`1. ${kind === "tally" ? "Export from Tally" : "Prepare your file"}`}
            description={
              kind === "tally"
                ? "In Tally: Gateway of Tally → Export → Masters (All Masters), format XML (Data Interchange). Upload the .xml file it creates."
                : "Use our template, or your own sheet: column names like “Item Name”, “UOM”, “HSN/SAC” and “GST %” are recognised."
            }
          />
          <div className="flex flex-wrap gap-2 px-5 pb-4">
            {kind !== "tally" && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    apiDownload(
                      `/imports/${kind}/template`,
                      `${kind}-import-template.xlsx`,
                    )
                  }
                >
                  <Download className="size-4" aria-hidden /> Excel template
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    apiDownload(
                      `/imports/${kind}/template?format=csv`,
                      `${kind}-import-template.csv`,
                    )
                  }
                >
                  <Download className="size-4" aria-hidden /> CSV template
                </Button>
              </>
            )}
          </div>

          <div className="border-t border-border px-5 py-4">
            <p className="mb-3 text-sm font-medium">2. Options</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(kind === "items" || kind === "tally") && (
                <Field label="Type for items without one">
                  {(p) => (
                    <Select
                      {...p}
                      value={opts.defaultItemType}
                      onChange={(e) =>
                        setOpts({ ...opts, defaultItemType: e.target.value })
                      }
                    >
                      {Object.entries(ITEM_TYPES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {kind === "tally" && (
                <Field
                  label="GST % when Tally has none"
                  hint="Blank = report those items as errors"
                >
                  {(p) => (
                    <Select
                      {...p}
                      value={opts.defaultGstRate}
                      onChange={(e) =>
                        setOpts({ ...opts, defaultGstRate: e.target.value })
                      }
                    >
                      <option value="">Don&apos;t assume</option>
                      {["0", "5", "12", "18", "28"].map((r) => (
                        <option key={r} value={r}>
                          {r}%
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {(kind === "opening-stock" ||
                (kind === "tally" && opts.includeOpeningStock)) && (
                <Field label="Opening stock date">
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={opts.postingDate}
                      onChange={(e) =>
                        setOpts({ ...opts, postingDate: e.target.value })
                      }
                    />
                  )}
                </Field>
              )}
              <div className="flex flex-col justify-end gap-2 pb-1">
                {kind === "tally" && (
                  <Checkbox
                    label="Customers & vendors"
                    checked={opts.includeParties}
                    onChange={(e) =>
                      setOpts({ ...opts, includeParties: e.target.checked })
                    }
                  />
                )}
                {kind === "tally" && (
                  <Checkbox
                    label="Opening stock"
                    checked={opts.includeOpeningStock}
                    onChange={(e) =>
                      setOpts({
                        ...opts,
                        includeOpeningStock: e.target.checked,
                      })
                    }
                  />
                )}
                {(kind === "opening-stock" ||
                  (kind === "tally" && opts.includeOpeningStock)) && (
                  <Checkbox
                    label="Post the stock now"
                    description="Otherwise draft entries are created for review"
                    checked={opts.post}
                    onChange={(e) =>
                      setOpts({ ...opts, post: e.target.checked })
                    }
                  />
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-border px-5 py-4">
            <p className="mb-3 text-sm font-medium">3. Upload and check</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2.5 text-sm hover:border-primary">
                <FileUp className="size-4 text-muted" aria-hidden />
                {file
                  ? file.name
                  : `Choose ${meta.accept.replaceAll(",", " / ")} file`}
                <input
                  ref={input}
                  type="file"
                  accept={meta.accept}
                  className="sr-only"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setResult(null);
                    setError(null);
                  }}
                />
              </label>
              <Button
                onClick={() => run(false)}
                disabled={!file}
                loading={busy === "preview"}
              >
                <FileSpreadsheet className="size-4" aria-hidden /> Check file
              </Button>
              {(file || result) && (
                <Button variant="ghost" onClick={() => reset()}>
                  <RotateCcw className="size-4" aria-hidden /> Start over
                </Button>
              )}
            </div>
            {error && (
              <div className="mt-4">
                <Alert>{error}</Alert>
              </div>
            )}
          </div>
        </Card>
      )}

      {result && summary && (
        <Card>
          <CardHeader
            title={committed ? "Imported" : "Check results"}
            description={
              committed
                ? `${result.data.fileName}: saved.`
                : `${result.data.fileName}: nothing has been saved yet.`
            }
            action={<SummaryBadges summary={summary} committed={!!committed} />}
          />
          {committed ? (
            <div className="px-5 pb-4">
              <Alert tone="success">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-4" aria-hidden />{" "}
                  {summary.created} record{summary.created === 1 ? "" : "s"}{" "}
                  imported
                  {summary.skipped
                    ? `, ${summary.skipped} already existed`
                    : ""}
                  {summary.errors
                    ? `, ${summary.errors} row${summary.errors === 1 ? "" : "s"} with errors left out`
                    : ""}
                  .
                </span>
              </Alert>
              <NextLinks kind={kind} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 px-5 pb-4">
              {summary.created > 0 ? (
                <>
                  <Button onClick={() => run(true)} loading={busy === "commit"}>
                    Import {summary.created} row
                    {summary.created === 1 ? "" : "s"}
                  </Button>
                  {summary.errors > 0 && (
                    <p className="text-sm text-muted">
                      Rows with errors will be left out. Fix them in the file
                      and import it again later: rows already imported are
                      skipped.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">
                  Nothing new to import.{" "}
                  {summary.errors
                    ? "Fix the errors below and check the file again."
                    : ""}
                </p>
              )}
            </div>
          )}
          {result.kind === "sheet" && result.data.ignoredColumns.length > 0 && (
            <p className="border-t border-border px-5 py-2 text-xs text-muted">
              Columns not recognised (ignored):{" "}
              {result.data.ignoredColumns.join(", ")}
            </p>
          )}
          {result.kind === "tally" &&
            (result.data.warnings.length > 0 ||
              result.data.ignored.ledgers > 0) && (
              <div className="space-y-1 border-t border-border px-5 py-3 text-xs text-muted">
                {result.data.ignored.ledgers > 0 && (
                  <p>
                    {result.data.ignored.ledgers} other ledgers (bank, expense,
                    tax…) were not imported: accounting arrives in a later
                    phase.
                  </p>
                )}
                {result.data.ignored.compoundUnits > 0 && (
                  <p>
                    {result.data.ignored.compoundUnits} compound units skipped:
                    items use simple units with conversions.
                  </p>
                )}
                {result.data.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}
          {result.kind === "sheet" ? (
            <RowsTable rows={result.data.rows} />
          ) : (
            result.data.sections.map((s) => (
              <div key={s.key} className="border-t border-border">
                <div className="flex items-center justify-between px-5 py-3">
                  <p className="font-medium">{s.title}</p>
                  <SummaryBadges summary={s.summary} committed={!!committed} />
                </div>
                <RowsTable rows={s.rows} compact />
              </div>
            ))
          )}
        </Card>
      )}
    </div>
  );
}

function summaryOf(r: Result | null): Summary | null {
  return r ? r.data.summary : null;
}

function SummaryBadges({
  summary,
  committed,
}: {
  summary: Summary;
  committed: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone="success">
        {summary.created} {committed ? "imported" : "ready"}
      </Badge>
      {summary.skipped > 0 && <Badge>{summary.skipped} already exist</Badge>}
      {summary.errors > 0 && (
        <Badge tone="danger">{summary.errors} with errors</Badge>
      )}
    </div>
  );
}

function RowsTable({
  rows,
  compact,
}: {
  rows: RowResult[];
  compact?: boolean;
}) {
  const [onlyErrors, setOnlyErrors] = useState(false);
  const errors = rows.filter((r) => r.status === "error").length;
  const shown = onlyErrors ? rows.filter((r) => r.status === "error") : rows;
  return (
    <div>
      {errors > 0 && rows.length > 10 && (
        <div className="px-5 pb-2">
          <Checkbox
            label={`Show only rows with errors (${errors})`}
            checked={onlyErrors}
            onChange={(e) => setOnlyErrors(e.target.checked)}
          />
        </div>
      )}
      <div
        className={cn("overflow-auto", compact ? "max-h-80" : "max-h-[32rem]")}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-16 px-4 py-2 font-medium">Row</th>
              <th className="px-4 py-2 font-medium">Record</th>
              <th className="w-28 px-4 py-2 font-medium">Result</th>
              <th className="px-4 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border align-top">
            {shown.map((r) => (
              <tr key={r.rowNo}>
                <td className="px-4 py-2 tabular-nums text-muted">{r.rowNo}</td>
                <td className="px-4 py-2">{r.label}</td>
                <td className="px-4 py-2">
                  <Badge
                    tone={
                      r.status === "created"
                        ? "success"
                        : r.status === "error"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {r.status === "created"
                      ? "OK"
                      : r.status === "error"
                        ? "Error"
                        : "Exists"}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-xs">
                  {r.errors.map((e, i) => (
                    <p key={i} className="text-danger">
                      {e.column && (
                        <span className="font-mono text-muted">
                          {e.column}:{" "}
                        </span>
                      )}
                      {e.message}
                    </p>
                  ))}
                  {r.message && <p className="text-muted">{r.message}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NextLinks({ kind }: { kind: ImportKind }) {
  const links: [string, string][] =
    kind === "items"
      ? [["/masters/items", "View items"]]
      : kind === "parties"
        ? [["/masters/parties", "View customers & vendors"]]
        : kind === "opening-stock"
          ? [
              ["/inventory/stock-entries", "Stock entries"],
              ["/inventory/stock", "Stock levels"],
            ]
          : [
              ["/masters/items", "Items"],
              ["/masters/parties", "Customers & vendors"],
              ["/inventory/stock", "Stock levels"],
            ];
  return (
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="text-primary hover:underline">
          {label}
        </Link>
      ))}
    </div>
  );
}
