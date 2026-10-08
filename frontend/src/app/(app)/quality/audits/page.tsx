"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { QMS } from "@/lib/qms";
import { DataTable } from "@/components/ui/data-table";

interface Row { id: string; title: string; standard: string; area: string; plannedDate: string; auditor: string; auditee: string | null; status: "planned" | "done"; doneOn: string | null; overdue: boolean; ncs: number; openFindings: number }

export default function AuditsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [year, setYear] = useState(todayIST().slice(0, 4));
  const q = useQuery({ queryKey: [QMS, "audits", year], queryFn: () => api<Row[]>(`${QMS}/audits`, { query: { year } }) });
  const [f, setF] = useState({ title: "", standard: "ISO 9001", area: "", plannedDate: todayIST(), auditor: "", auditee: "" });
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setError(null);
    try {
      await api(`${QMS}/audits`, { body: { ...f, auditee: f.auditee || null } });
      setF({ ...f, title: "", area: "", auditee: "" });
      qc.invalidateQueries({ queryKey: [QMS, "audits"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Internal audits" description="The audit programme for the year by standard and area. Record findings as you audit; nonconformities get a CAPA and stay open until it closes." />
      {can("quality.audits.manage") && (
        <Card>
          <CardHeader title="Plan an audit" />
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-6">
            {error && <div className="sm:col-span-6"><Alert>{error}</Alert></div>}
            <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
            <Field label="Standard">{(p) => <Input {...p} list="standards" value={f.standard} onChange={(e) => setF({ ...f, standard: e.target.value })} />}</Field>
            <Field label="Area / process">{(p) => <Input {...p} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />}</Field>
            <Field label="Planned for">{(p) => <Input {...p} type="date" value={f.plannedDate} onChange={(e) => setF({ ...f, plannedDate: e.target.value })} />}</Field>
            <Field label="Auditor">{(p) => <Input {...p} value={f.auditor} onChange={(e) => setF({ ...f, auditor: e.target.value })} />}</Field>
            <datalist id="standards">{["ISO 9001", "IATF 16949", "ISO 14001", "ISO 45001", "GMP (Schedule M)", "FSSC 22000", "ISO 13485"].map((s) => <option key={s} value={s} />)}</datalist>
            <div className="flex justify-end sm:col-span-6"><Button onClick={add} disabled={!f.title.trim() || !f.area.trim() || !f.auditor.trim()}><Plus className="size-4" aria-hidden /> Add to programme</Button></div>
          </div>
        </Card>
      )}
      <div className="flex items-center gap-2 text-sm"><span className="text-muted">Year</span><Input className="h-9 w-24" inputMode="numeric" aria-label="Year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} /></div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <DataTable
            rows={q.data}
            rowKey={(r) => String(r.id)}
            exportName="quality-audits"
            storageKey="quality-audits-0"
            empty={<p className="px-4 py-6 text-center text-sm text-muted">No audits planned this year.</p>}
            columns={[
              { key: "audit", label: "Audit", locked: true, className: "whitespace-normal", render: (r) => <><Link href={`/quality/audits/${r.id}`} className="font-medium hover:underline">{r.title}</Link><span className="block text-xs text-muted">{r.auditor}{r.auditee && ` → ${r.auditee}`}</span></> },
              { key: "standard-area", label: "Standard · area", className: "whitespace-normal", render: (r) => <>{r.standard}<span className="block text-xs text-muted">{r.area}</span></> },
              { key: "when", label: "When", className: "whitespace-normal", render: (r) => <>{formatDate(r.doneOn ?? r.plannedDate)}</> },
              { key: "findings", label: "Findings", className: "whitespace-normal", render: (r) => <>{r.ncs ? <Badge tone="danger">{r.ncs} NC</Badge> : "–"}{r.openFindings > 0 && <span className="ml-2 text-xs text-muted">{r.openFindings} open</span>}</> },
              { key: "status", label: "Status", className: "whitespace-normal", render: (r) => <>{r.status === "done" ? <Badge tone="success">Done</Badge> : r.overdue ? <Badge tone="danger">Overdue</Badge> : <Badge>Planned</Badge>}</> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
