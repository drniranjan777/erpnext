"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import type { Branch, Company } from "@/lib/types";
import { DataTable } from "@/components/ui/data-table";

interface DocTypeInfo {
  value: string;
  label: string;
  defaultPattern: string;
  gstDocument: boolean;
}

interface Series {
  id: string;
  docType: string;
  docTypeLabel: string;
  companyId: string;
  companyName: string;
  branch: { id: string; code: string; name: string } | null;
  name: string;
  pattern: string;
  padding: number;
  reset: "yearly" | "monthly" | "never";
  startAt: number;
  isDefault: boolean;
  isActive: boolean;
  nextNumber: string;
  version: number;
}

const RESET_LABEL = { yearly: "Every financial year", monthly: "Every month", never: "Never" };
const KEY = ["platform", "number-series"];

export default function NumberSeriesPage() {
  const series = useQuery({ queryKey: KEY, queryFn: () => api<Series[]>("/platform/number-series") });
  const docTypes = useQuery({ queryKey: ["platform", "doc-types"], queryFn: () => api<DocTypeInfo[]>("/platform/document-types") });
  const [editing, setEditing] = useState<Series | "new" | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Number series"
        description="How document numbers are generated. Numbers are assigned on submit and never skip or repeat."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> New series
          </Button>
        }
      />
      <Card>
        {series.isLoading && <LoadingBlock />}
        {series.error && <div className="p-5"><ErrorBlock error={series.error} /></div>}
        {series.data?.length === 0 && (
          <EmptyState title="No custom series yet" description="A default series is created automatically the first time each document type is submitted." />
        )}
        {!!series.data?.length && (
          <div className="overflow-x-auto">
            <DataTable
              rows={series.data ?? []}
              rowKey={(s) => String(s.id)}
              exportName="settings-number-series"
              storageKey="settings-number-series-0"
              columns={[
                { key: "document", label: "Document", locked: true, className: "whitespace-normal", render: (s) => <><p className="font-medium">{s.docTypeLabel}</p>
                                    <p className="text-xs text-muted">
                                      {s.companyName}
                                      {s.branch ? ` · ${s.branch.code}` : " · all branches"}
                                    </p></> },
                { key: "series", label: "Series", className: "whitespace-normal", render: (s) => <><span className="mr-1.5">{s.name}</span>
                                    {s.isDefault && <Badge tone="primary">Default</Badge>} {!s.isActive && <Badge>Inactive</Badge>}</> },
                { key: "pattern", label: "Pattern", className: "font-mono text-xs", render: (s) => <>{s.pattern}</> },
                { key: "next-number", label: "Next number", className: "font-mono", render: (s) => <>{s.nextNumber}</> },
                { key: "restarts", label: "Restarts", className: "text-muted whitespace-normal", render: (s) => <>{RESET_LABEL[s.reset]}</> },
                { key: "col5", label: "", align: "right", noSort: true, render: (s) => <><Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                                      <Pencil className="size-4" />
                                    </Button></> },
              ]}
            />
          </div>
        )}
      </Card>
      <Card className="px-5 py-4 text-sm text-muted">
        <p className="font-medium text-foreground">Pattern tokens</p>
        <p className="mt-1">
          <code>{"{FY}"}</code> 26-27 · <code>{"{FY4}"}</code> 2026-27 · <code>{"{YYYY}"}</code> · <code>{"{YY}"}</code> · <code>{"{MM}"}</code> ·{" "}
          <code>{"{BRANCH}"}</code> branch code · <code>{"{SEQ}"}</code> running number (required). GST invoices must stay within 16 characters.
        </p>
      </Card>
      {editing && docTypes.data && (
        <SeriesDialog series={editing === "new" ? null : editing} docTypes={docTypes.data} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function SeriesDialog({ series, docTypes, onClose }: { series: Series | null; docTypes: DocTypeInfo[]; onClose: () => void }) {
  const qc = useQueryClient();
  const companies = useQuery({ queryKey: ["org", "companies"], queryFn: () => api<Company[]>("/org/companies") });
  const branches = useQuery({ queryKey: ["org", "branches"], queryFn: () => api<Branch[]>("/org/branches") });
  const [form, setForm] = useState({
    docType: series?.docType ?? docTypes[0]?.value ?? "",
    companyId: series?.companyId ?? "",
    branchId: series?.branch?.id ?? "",
    name: series?.name ?? "",
    pattern: series?.pattern ?? docTypes[0]?.defaultPattern ?? "",
    padding: series?.padding ?? 4,
    reset: series?.reset ?? "yearly",
    startAt: series?.startAt ?? 1,
    isDefault: series?.isDefault ?? true,
    isActive: series?.isActive ?? true,
  });
  const companyId = form.companyId || companies.data?.[0]?.id || "";
  const branchCode = branches.data?.find((b) => b.id === form.branchId)?.code ?? "HO";

  const [preview, setPreview] = useState<{ sample: string; errors: string[]; warnings: string[] } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ sample: string; errors: string[]; warnings: string[] }>("/platform/number-series/preview", {
        body: { docType: form.docType, pattern: form.pattern, padding: form.padding, startAt: form.startAt, branchCode },
      })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [form.docType, form.pattern, form.padding, form.startAt, branchCode]);

  const save = useMutation({
    mutationFn: () =>
      series
        ? api(`/platform/number-series/${series.id}`, {
            method: "PATCH",
            body: { version: series.version, name: form.name, pattern: form.pattern, padding: form.padding, reset: form.reset, isDefault: form.isDefault, isActive: form.isActive },
          })
        : api("/platform/number-series", { body: { ...form, companyId, branchId: form.branchId || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog
      open
      onClose={onClose}
      title={series ? `Edit series: ${series.name}` : "New number series"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!form.name || !!preview?.errors.length} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && !Object.keys(errors).length && <Alert>{(save.error as Error).message}</Alert>}
        {series && <Alert tone="warning">Changing the pattern affects only numbers issued from now on.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Document type" required>
            {(p) => (
              <Select
                {...p}
                disabled={!!series}
                value={form.docType}
                onChange={(e) => {
                  const dt = docTypes.find((d) => d.value === e.target.value);
                  setForm((f) => ({ ...f, docType: e.target.value, pattern: dt?.defaultPattern ?? f.pattern }));
                }}
              >
                {docTypes.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Series name" required error={errors.name}>
            {(p) => <Input {...p} placeholder="e.g. Hyderabad plant" value={form.name} onChange={(e) => set("name", e.target.value)} />}
          </Field>
          <Field label="Company" required>
            {(p) => (
              <Select {...p} disabled={!!series} value={companyId} onChange={(e) => set("companyId", e.target.value)}>
                {companies.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Branch" hint="Leave as 'All branches' for one company-wide sequence">
            {(p) => (
              <Select {...p} disabled={!!series} value={form.branchId} onChange={(e) => set("branchId", e.target.value)}>
                <option value="">All branches</option>
                {branches.data
                  ?.filter((b) => b.companyId === companyId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Pattern" required className="sm:col-span-2" error={errors.pattern ?? preview?.errors[0]}>
            {(p) => <Input {...p} className="font-mono" value={form.pattern} onChange={(e) => set("pattern", e.target.value)} />}
          </Field>
          <Field label="Digits in running number">
            {(p) => <Input {...p} type="number" min={1} max={10} value={form.padding} onChange={(e) => set("padding", Number(e.target.value))} />}
          </Field>
          <Field label="Restart numbering">
            {(p) => (
              <Select {...p} value={form.reset} onChange={(e) => set("reset", e.target.value as Series["reset"])}>
                <option value="yearly">Every financial year</option>
                <option value="monthly">Every month</option>
                <option value="never">Never</option>
              </Select>
            )}
          </Field>
          {!series && (
            <Field label="First number">
              {(p) => <Input {...p} type="number" min={1} value={form.startAt} onChange={(e) => set("startAt", Number(e.target.value))} />}
            </Field>
          )}
        </div>
        <div className="rounded-lg bg-surface-muted px-4 py-3">
          <p className="text-xs text-muted">Preview</p>
          <p className="font-mono text-lg">{preview?.sample ?? "…"}</p>
          {preview?.warnings.map((w) => (
            <p key={w} className="text-xs text-warning">
              {w}
            </p>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox label="Default for this document type" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
          <Checkbox label="Active" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
        </div>
      </div>
    </Dialog>
  );
}
