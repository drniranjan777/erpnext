"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { askConfirm } from "@/components/ui/ask";

interface PrintFormat {
  id: string;
  docType: string;
  docTypeLabel: string;
  name: string;
  template: string;
  css: string;
  paperSize: string;
  isDefault: boolean;
  version: number;
  updatedAt: string;
}

const KEY = ["platform", "print-formats"];

export default function PrintFormatsPage() {
  const formats = useQuery({ queryKey: KEY, queryFn: () => api<PrintFormat[]>("/platform/print-formats") });
  const [editing, setEditing] = useState<PrintFormat | "new" | null>(null);
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api<void>(`/platform/print-formats/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  if (editing) return <Designer format={editing === "new" ? null : editing} onClose={() => setEditing(null)} />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Print formats"
        description="Design how documents look when printed or saved as PDF: your logo text, layout, terms and signature blocks."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> New format
          </Button>
        }
      />
      <Card>
        {formats.isLoading && <LoadingBlock />}
        {formats.error && <div className="p-5"><ErrorBlock error={formats.error} /></div>}
        {formats.data?.length === 0 && (
          <EmptyState title="Using the standard formats" description="Every document prints with a built-in A4 layout. Create a format to customise it." />
        )}
        <ul className="divide-y divide-border">
          {formats.data?.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {f.name} {f.isDefault && <Badge tone="primary">Default</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {f.docTypeLabel} · {f.paperSize} · updated {timeAgo(f.updatedAt)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`}>
                <Pencil className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={async () => await askConfirm(`Delete "${f.name}"?`) && del.mutate(f.id)} aria-label={`Delete ${f.name}`}>
                <Trash2 className="size-4 text-danger" />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Designer({ format, onClose }: { format: PrintFormat | null; onClose: () => void }) {
  const qc = useQueryClient();
  const docTypes = useQuery({ queryKey: ["platform", "doc-types"], queryFn: () => api<{ value: string; label: string }[]>("/platform/document-types") });
  const [docType, setDocType] = useState(format?.docType ?? "purchase_requisition");
  const [name, setName] = useState(format?.name ?? "");
  // null = untouched: new formats show the built-in template until edited.
  const [templateDraft, setTemplate] = useState<string | null>(format?.template ?? null);
  const [cssDraft, setCss] = useState<string | null>(format?.css ?? null);
  const [paperSize, setPaperSize] = useState(format?.paperSize ?? "A4");
  const [isDefault, setIsDefault] = useState(format?.isDefault ?? false);
  const [sampleDoc, setSampleDoc] = useState("");

  // New formats start from the built-in template.
  const builtIn = useQuery({
    queryKey: ["platform", "print-formats", "built-in", docType],
    queryFn: () => api<{ template: string; css: string }>("/platform/print-formats/built-in", { query: { docType } }),
    enabled: !format,
  });
  const template = templateDraft ?? builtIn.data?.template ?? "";
  const css = cssDraft ?? builtIn.data?.css ?? "";

  const recent = useQuery({
    queryKey: ["documents", "search", docType],
    queryFn: () => api<{ id: string; number: string | null; title: string | null }[]>("/documents", { query: { docType, limit: 20 } }),
  });

  const [preview, setPreview] = useState<{ html?: string; error?: string }>({});
  useEffect(() => {
    if (!template) return;
    const t = setTimeout(() => {
      api<{ html: string }>("/platform/print-formats/preview", { body: { docType, template, css, documentId: sampleDoc || undefined } })
        .then((r) => setPreview({ html: r.html }))
        .catch((e) => setPreview({ error: e instanceof ApiError ? (e.fieldErrors.template ?? e.message) : "Preview failed" }));
    }, 400);
    return () => clearTimeout(t);
  }, [docType, template, css, sampleDoc]);

  const save = useMutation({
    mutationFn: () =>
      format
        ? api(`/platform/print-formats/${format.id}`, { method: "PATCH", body: { version: format.version, name, template, css, paperSize, isDefault } })
        : api("/platform/print-formats", { body: { docType, name, template, css, paperSize, isDefault } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title={format ? `Edit print format: ${format.name}` : "New print format"}
        actions={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={name.trim().length < 2 || !!preview.error} onClick={() => save.mutate()}>
              Save format
            </Button>
          </>
        }
      />
      {save.error && <Alert>{(save.error as Error).message}</Alert>}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Document type">
                {(p) => (
                  <Select {...p} disabled={!!format} value={docType} onChange={(e) => setDocType(e.target.value)}>
                    {docTypes.data?.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Format name" required>
                {(p) => <Input {...p} placeholder="e.g. With company letterhead" value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Field label="Paper">
                {(p) => (
                  <Select {...p} value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
                    <option>A4</option>
                    <option>A5</option>
                    <option>Letter</option>
                  </Select>
                )}
              </Field>
              <div className="flex items-end pb-2">
                <Checkbox label="Default for this document type" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Template (HTML + Handlebars)" description="Use {{company.name}}, {{doc.displayNumber}}, {{#each lines}}…{{/each}}. Helpers: money, qty, date, datetime, upper, eq." />
            <textarea
              aria-label="Template"
              spellCheck={false}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              className="block h-[420px] w-full resize-y rounded-b-xl border-0 bg-surface-muted p-4 font-mono text-xs leading-relaxed focus:outline-none"
            />
          </Card>
          <Card>
            <CardHeader title="CSS overrides" />
            <textarea
              aria-label="CSS"
              spellCheck={false}
              value={css}
              onChange={(e) => setCss(e.target.value)}
              className="block h-40 w-full resize-y rounded-b-xl border-0 bg-surface-muted p-4 font-mono text-xs focus:outline-none"
            />
          </Card>
        </div>
        <Card className="flex flex-col">
          <CardHeader
            title="Live preview"
            action={
              <select aria-label="Preview with" className="h-8 rounded-lg border border-border bg-surface px-2 text-xs" value={sampleDoc} onChange={(e) => setSampleDoc(e.target.value)}>
                <option value="">Sample data</option>
                {recent.data
                  ?.filter((d) => d.number)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.number}
                    </option>
                  ))}
              </select>
            }
          />
          {preview.error && (
            <div className="p-4">
              <Alert>{preview.error}</Alert>
            </div>
          )}
          <div className="flex-1 bg-surface-muted p-3">
            {preview.html && (
              <iframe title="Format preview" srcDoc={preview.html} sandbox="" className="h-[760px] w-full rounded bg-white p-[10mm] shadow" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
