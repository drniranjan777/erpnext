"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CRM, grade, GRADE_TONE, LEAD_TONE, SOURCES, type Lead } from "@/lib/crm";
import { formatDate } from "@/lib/documents";
import { inr } from "@/lib/payroll";

interface Member { userId: string; fullName: string }
const PAGE = 50;

export default function LeadsPage() {
  const { can } = useAuth();
  const manage = can("crm.leads.manage");
  const qc = useQueryClient();
  const [f, setF] = useState({ q: "", status: "", source: "", grade: "" });
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [importSource, setImportSource] = useState("indiamart");
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: [CRM, "leads", f, offset], queryFn: () => api<{ total: number; items: Lead[] }>(`${CRM}/leads`, { query: { q: f.q || undefined, status: f.status || undefined, source: f.source || undefined, grade: f.grade || undefined, limit: PAGE, offset } }) });
  const members = useQuery({ queryKey: ["iam", "users"], queryFn: () => api<Member[]>("/iam/users"), enabled: manage, retry: false });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setOffset(0); };
  async function importFile(fl: File) {
    setMsg(null);
    try {
      const r = await apiUpload<{ rows: number; created: number; alreadyImported: number; skippedRows: number[] }>(`${CRM}/leads/import?source=${importSource}`, fl);
      setMsg({ tone: "success", text: `${r.created} new lead(s) from ${r.rows} row(s); ${r.alreadyImported} were already imported${r.skippedRows.length ? `; rows ${r.skippedRows.join(", ")} had no name, phone or email` : ""}.` });
      qc.invalidateQueries({ queryKey: [CRM] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Import failed" });
    } finally {
      if (file.current) file.current.value = "";
    }
  }
  async function assign(ownerId: string) {
    if (!ownerId) return;
    await api(`${CRM}/leads/assign`, { body: { leadIds: [...picked], ownerId } });
    setPicked(new Set());
    qc.invalidateQueries({ queryKey: [CRM, "leads"] });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Leads"
        description="Sorted by score. A: hot, B: warm, C: cold."
        actions={
          manage && (
            <span className="flex flex-wrap gap-2">
              <Select className="h-10 w-36" aria-label="Import source" value={importSource} onChange={(e) => setImportSource(e.target.value)}>{["indiamart", "tradeindia", "justdial", "exhibition", "other"].map((s) => <option key={s} value={s}>{SOURCES[s]}</option>)}</Select>
              <input ref={file} type="file" accept=".csv,.xlsx" className="hidden" aria-label="Lead file" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
              <Button variant="secondary" onClick={() => file.current?.click()}><Upload className="size-4" aria-hidden /> Import</Button>
              <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Lead</Button>
            </span>
          )
        }
      />
      <div className="flex flex-wrap gap-3">
        <Input className="h-9 w-64" placeholder="Name, company, phone, email" aria-label="Search" value={f.q} onChange={set("q")} />
        <Select className="h-9 w-36" aria-label="Status" value={f.status} onChange={set("status")}><option value="">Open</option>{Object.keys(LEAD_TONE).map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select className="h-9 w-36" aria-label="Source" value={f.source} onChange={set("source")}><option value="">All sources</option>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select className="h-9 w-28" aria-label="Grade" value={f.grade} onChange={set("grade")}><option value="">Any grade</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></Select>
        {picked.size > 0 && members.data && (
          <Select className="h-9 w-56" aria-label="Assign to" value="" onChange={(e) => assign(e.target.value)}><option value="">Assign {picked.size} to…</option>{members.data.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>
        )}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr>{manage && <th className="w-8 px-3 py-2" />}<th className="px-4 py-2 font-medium">Lead</th><th className="px-4 py-2 font-medium">Source</th><th className="px-4 py-2 text-right font-medium">Value</th><th className="px-4 py-2 font-medium">Owner</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 text-right font-medium">Score</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((l) => (
                <tr key={l.id}>
                  {manage && <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${l.name}`} checked={picked.has(l.id)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} /></td>}
                  <td className="px-4 py-2"><Link className="font-medium hover:underline" href={`${CRM}/leads/${l.id}`}>{l.name}</Link>{l.duplicateOfId && <Badge tone="warning" className="ml-1">possible duplicate</Badge>}<span className="block text-xs text-muted">{[l.company, l.city, l.phone].filter(Boolean).join(" · ")}</span></td>
                  <td className="px-4 py-2">{SOURCES[l.source] ?? l.source}<span className="block text-xs text-muted">{formatDate(l.createdAt.slice(0, 10))}</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr(l.estimatedValue)}</td>
                  <td className="px-4 py-2">{l.owner ?? <span className="text-warning">unassigned</span>}<span className="block text-xs text-muted">{l.territory}</span></td>
                  <td className="px-4 py-2"><Badge tone={LEAD_TONE[l.status]}>{l.status}</Badge></td>
                  <td className="px-4 py-2 text-right"><Badge tone={GRADE_TONE[grade(l.score)]}>{grade(l.score)} · {l.score}</Badge></td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No leads.</td></tr>}
            </tbody>
          </table>
          {q.data.total > PAGE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
              <span>{offset + 1}–{Math.min(offset + PAGE, q.data.total)} of {q.data.total}</span>
              <span className="flex gap-2"><Button size="sm" variant="ghost" disabled={!offset} onClick={() => setOffset(offset - PAGE)}>Previous</Button><Button size="sm" variant="ghost" disabled={offset + PAGE >= q.data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button></span>
            </div>
          )}
        </Card>
      )}
      {adding && <NewLead onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewLead({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", company: "", phone: "", email: "", city: "", stateCode: "", source: "walk_in", product: "", requirement: "", estimatedValue: "", nextFollowUp: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => v || null;
  async function save() {
    setError(null);
    try {
      await api(`${CRM}/leads`, { body: { ...f, company: n(f.company), phone: n(f.phone), email: n(f.email), city: n(f.city), stateCode: n(f.stateCode), product: n(f.product), requirement: n(f.requirement), estimatedValue: f.estimatedValue ? Number(f.estimatedValue) : null, nextFollowUp: n(f.nextFollowUp) } });
      await qc.invalidateQueries({ queryKey: [CRM] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New lead" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={f.name.trim().length < 2}><UserCheck className="size-4" aria-hidden /> Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact name">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        <Field label="Company">{(p) => <Input {...p} value={f.company} onChange={set("company")} />}</Field>
        <Field label="Phone">{(p) => <Input {...p} value={f.phone} onChange={set("phone")} />}</Field>
        <Field label="Email">{(p) => <Input {...p} type="email" value={f.email} onChange={set("email")} />}</Field>
        <Field label="City">{(p) => <Input {...p} value={f.city} onChange={set("city")} />}</Field>
        <Field label="State code" hint="Decides the territory">{(p) => <Input {...p} maxLength={2} value={f.stateCode} onChange={set("stateCode")} />}</Field>
        <Field label="Source">{(p) => <Select {...p} value={f.source} onChange={set("source")}>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
        <Field label="Estimated value (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.estimatedValue} onChange={set("estimatedValue")} />}</Field>
        <Field label="Product">{(p) => <Input {...p} value={f.product} onChange={set("product")} />}</Field>
        <Field label="Follow up on">{(p) => <Input {...p} type="date" value={f.nextFollowUp} onChange={set("nextFollowUp")} />}</Field>
        <Field label="Requirement" className="sm:col-span-2">{(p) => <Input {...p} value={f.requirement} onChange={set("requirement")} />}</Field>
      </div>
    </Dialog>
  );
}
