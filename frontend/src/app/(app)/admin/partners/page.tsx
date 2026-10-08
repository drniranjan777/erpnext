"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";

interface Partner { id: string; code: string; name: string; kind: string; email: string; gstin: string | null; commission_pct: number; certified: boolean; status: string; clients: number; members: number; accrued: number; paid: number }

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const blank = { code: "", name: "", kind: "both", email: "", gstin: "", commissionPct: "20", certified: false, status: "active" };

/** Platform admin: partners, their members, commissions and payouts. */
export default function PartnersAdminPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["/admin/partners"], queryFn: () => api<Partner[]>("/admin/partners") });
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [member, setMember] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run<T>(fn: () => Promise<T>, done: (r: T) => string) {
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: "success", text: done(r) });
      qc.invalidateQueries({ queryKey: ["/admin/partners"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const body = { code: f.code, name: f.name, kind: f.kind, email: f.email, gstin: f.gstin || null, commissionPct: Number(f.commissionPct), certified: f.certified, status: f.status };
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Partners" description="Resellers and implementation partners: their members, client workspaces, and commission on client subscriptions." actions={<Button variant="secondary" onClick={() => run(() => api<{ accrued: number }>("/admin/partners/commissions/accrue", { body: {} }), (r) => `${r.accrued} new commission(s) accrued.`)}>Accrue commissions</Button>} />
      {q.error && <ErrorBlock error={q.error} />}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data?.map((p) => (
            <li key={p.id} className="space-y-2 px-4 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted">{p.code}</span>
                <Badge>{p.kind}</Badge>
                {p.certified && <Badge tone="success">certified</Badge>}
                {p.status !== "active" && <Badge tone="danger">{p.status}</Badge>}
                <span className="text-xs text-muted">{p.commission_pct} % · {p.clients} client(s) · {p.members} member(s) · accrued {inr(p.accrued)} · paid {inr(p.paid)}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => { setEditing(p.id); setF({ code: p.code, name: p.name, kind: p.kind, email: p.email, gstin: p.gstin ?? "", commissionPct: String(p.commission_pct), certified: p.certified, status: p.status }); }}>Edit</Button>
                  {p.accrued > 0 && <Button size="sm" onClick={() => { const ref = window.prompt("Payout reference (UTR / NEFT)"); if (ref) run(() => api<{ paid: number }>(`/admin/partners/${p.id}/payout`, { body: { reference: ref } }), (r) => `${r.paid} commission(s) marked paid.`); }}>Pay {inr(p.accrued)}</Button>}
                </span>
              </p>
              <p className="flex gap-2">
                <Input className="h-8 w-72" type="email" aria-label="Member email" placeholder="Add a member by email" value={member[p.id] ?? ""} onChange={(e) => setMember({ ...member, [p.id]: e.target.value })} />
                <Button size="sm" variant="secondary" disabled={!member[p.id]} onClick={() => run(() => api(`/admin/partners/${p.id}/members`, { body: { email: member[p.id], role: "member" } }), () => "Member added.").then(() => setMember({ ...member, [p.id]: "" }))}>Add member</Button>
              </p>
            </li>
          ))}
          {q.data && !q.data.length && <li className="px-4 py-6 text-center text-muted">No partners yet.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title={editing ? "Edit partner" : "New partner"} />
        <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-4">
          <Input aria-label="Code" placeholder="Code (DECCAN-ERP)" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="reseller">Reseller</option><option value="implementer">Implementer</option><option value="both">Both</option></Select>
          <Input aria-label="Email" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input aria-label="GSTIN" placeholder="GSTIN" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
          <Input aria-label="Commission" type="number" min={0} max={50} placeholder="Commission %" value={f.commissionPct} onChange={(e) => setF({ ...f, commissionPct: e.target.value })} />
          <Select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="suspended">Suspended</option></Select>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.certified} onChange={(e) => setF({ ...f, certified: e.target.checked })} /> certified</label>
          <span className="flex gap-2 sm:col-span-4">
            <Button disabled={!f.code || f.name.length < 2 || !f.email} onClick={() => run(() => (editing ? api(`/admin/partners/${editing}`, { method: "PUT", body }) : api("/admin/partners", { body })), () => "Saved.").then(() => { setEditing(null); setF(blank); })}>{editing ? "Save changes" : "Add partner"}</Button>
            {editing && <Button variant="secondary" onClick={() => { setEditing(null); setF(blank); }}>Cancel</Button>}
          </span>
        </div>
      </Card>
    </div>
  );
}
