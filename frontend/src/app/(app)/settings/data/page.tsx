"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError, apiDownload, apiUpload } from "@/lib/api";

interface Residency { region: string; sandboxOf: string | null; note: string }
interface Copy { tenantId: string; slug: string; tables: number; rows: number }

/** Data residency, workspace export / import, and sandbox copies. */
export default function DataPage() {
  const q = useQuery({ queryKey: ["/platform/data/residency"], queryFn: () => api<Residency>("/platform/data/residency") });
  const [slug, setSlug] = useState("");
  const [imp, setImp] = useState({ slug: "", name: "", file: null as File | null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<Copy>, what: string) {
    setMsg(null);
    setBusy(true);
    try {
      const r = await fn();
      setMsg({ tone: "success", text: `${what} ${r.slug}: ${r.rows.toLocaleString("en-IN")} records in ${r.tables} tables. Switch to it from the workspace menu.` });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  const valid = (s: string) => /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(s);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Data and sandbox" description="Where the workspace's data is kept, a full export to move it to another installation or region, and sandbox copies for training and trying changes without touching live data." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {q.data?.sandboxOf && <Alert tone="warning">This workspace is a sandbox copied from {q.data.sandboxOf}. Changes here do not affect it.</Alert>}
      <Card>
        <CardHeader title="Data residency" description={q.data ? `${q.data.region}. ${q.data.note}` : ""} />
      </Card>
      <Card>
        <CardHeader title="Sandbox" description="A copy of this workspace — masters, documents, books, settings and users — without login sessions, credentials, integrations and high-volume history (audit trail, sensor readings). It starts as a 30-day trial." />
        <div className="flex flex-wrap gap-2 border-t border-border p-4 text-sm">
          <Input className="h-9 flex-1" aria-label="Sandbox address" placeholder="sandbox address, e.g. acme-training" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          <Button disabled={!valid(slug) || busy} loading={busy} onClick={() => run(() => api<Copy>("/platform/data/sandbox", { body: { slug } }), "Sandbox created:")}>Create sandbox</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Export" description="Everything of this workspace as one compressed file, to keep or to import elsewhere. Sessions, API keys, webhook and connector secrets are never exported." />
        <div className="border-t border-border p-4"><Button variant="secondary" onClick={() => apiDownload("/platform/data/export", "workspace-export.nextgen.json.gz")}>Download export</Button></div>
      </Card>
      <Card>
        <CardHeader title="Import" description="Creates a new workspace from an export file, with new ids for every record. People are matched by email; you own the new workspace." />
        <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-2">
          <input type="file" aria-label="Export file" accept=".gz,.json" onChange={(e) => setImp({ ...imp, file: e.target.files?.[0] ?? null })} className="sm:col-span-2" />
          <Input aria-label="Address" placeholder="new workspace address" value={imp.slug} onChange={(e) => setImp({ ...imp, slug: e.target.value.toLowerCase() })} />
          <Input aria-label="Name" placeholder="Name (optional)" value={imp.name} onChange={(e) => setImp({ ...imp, name: e.target.value })} />
          <Button disabled={!imp.file || !valid(imp.slug) || busy} loading={busy} onClick={() => run(() => apiUpload<Copy>(`/platform/data/import?slug=${encodeURIComponent(imp.slug)}${imp.name ? `&name=${encodeURIComponent(imp.name)}` : ""}`, imp.file!), "Imported as")}>Import</Button>
        </div>
      </Card>
    </div>
  );
}
