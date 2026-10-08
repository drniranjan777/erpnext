"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/documents";

interface Portal {
  partners: { id: string; code: string; name: string; kind: string; commission_pct: number; certified: boolean; status: string; role: string }[];
  clients: { id: string; slug: string; name: string; status: string; plan_code: string; subscription_status: string | null; current_period_end: string | null; created_at: string; active_users: number }[];
  commissions: { id: string; client: string; invoice_number: string; base_amount: number; rate_pct: number; amount: number; status: string; payout_ref: string | null; accrued_at: string; paid_at: string | null }[];
  totals: { accrued: number; paid: number };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Partner portal: client workspaces and commissions. */
export default function PartnerPortalPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["/partner-portal"], queryFn: () => api<Portal>("/partner-portal"), retry: false });
  const [f, setF] = useState({ partnerId: "", slug: "", workspaceName: "", companyName: "", gstin: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (q.error) return <div className="mx-auto max-w-3xl"><PageHeader title="Partner portal" /><Alert tone="warning">{q.error instanceof ApiError ? q.error.message : "Not available."}</Alert></div>;
  const d = q.data;
  if (!d) return <LoadingBlock />;
  const partnerId = f.partnerId || d.partners[0]?.id || "";
  async function create() {
    setMsg(null);
    try {
      await api("/partner-portal/clients", { body: { partnerId, slug: f.slug, workspaceName: f.workspaceName, companyName: f.companyName, gstin: f.gstin || null } });
      setMsg({ tone: "success", text: `Workspace ${f.slug} created: you are its owner. Switch to it from the workspace menu.` });
      setF({ ...f, slug: "", workspaceName: "", companyName: "", gstin: "" });
      qc.invalidateQueries({ queryKey: ["/partner-portal"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Partner portal" description={d.partners.map((p) => `${p.name} (${p.code}) · ${p.kind} · ${p.commission_pct} % commission${p.certified ? " · certified" : ""}`).join("; ")} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        {[["Client workspaces", String(d.clients.length)], ["Commission accrued", inr(d.totals.accrued)], ["Commission paid", inr(d.totals.paid)]].map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted">{l}</p><p className="text-xl font-semibold tabular-nums">{v}</p></Card>)}
      </div>
      <Card>
        <CardHeader title="Client workspaces" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.clients.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2"><span className="font-medium">{c.name}</span><span className="text-xs text-muted">{c.slug}</span><Badge tone={c.status === "active" ? "success" : c.status === "trial" ? "primary" : "danger"}>{c.status}</Badge><Badge>{c.plan_code}</Badge><span className="text-xs text-muted">{c.active_users} user(s) · since {formatDate(c.created_at.slice(0, 10))}{c.current_period_end ? ` · renews ${formatDate(c.current_period_end.slice(0, 10))}` : ""}</span></li>)}
          {!d.clients.length && <li className="px-4 py-6 text-center text-muted">No client workspaces yet.</li>}
        </ul>
        <div className="grid gap-2 border-t border-border p-4 text-sm sm:grid-cols-5">
          {d.partners.length > 1 && <Select aria-label="Partner" value={partnerId} onChange={(e) => setF({ ...f, partnerId: e.target.value })}>{d.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
          <Input aria-label="Workspace address" placeholder="workspace-address" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} />
          <Input aria-label="Workspace name" placeholder="Workspace name" value={f.workspaceName} onChange={(e) => setF({ ...f, workspaceName: e.target.value })} />
          <Input aria-label="Company" placeholder="Company name" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
          <Input aria-label="GSTIN" placeholder="GSTIN (optional)" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
          <Button disabled={!partnerId || f.slug.length < 3 || f.workspaceName.length < 2 || f.companyName.length < 2} onClick={create}>Create client workspace</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Commissions" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.commissions.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-1.5"><Badge tone={c.status === "paid" ? "success" : "warning"}>{c.status}</Badge><span>{c.client}</span><span className="text-xs text-muted">invoice {c.invoice_number} · {inr(c.base_amount)} × {c.rate_pct} % · {formatDateTime(c.accrued_at)}{c.payout_ref ? ` · paid ${c.payout_ref}` : ""}</span><span className="ml-auto tabular-nums">{inr(c.amount)}</span></li>)}
          {!d.commissions.length && <li className="px-4 py-6 text-center text-muted">No commissions yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
