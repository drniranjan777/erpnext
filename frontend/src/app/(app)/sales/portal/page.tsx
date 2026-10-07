"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, formatDateTime, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatQty } from "@/lib/documents";

interface Request { id: string; number: string; status: string; customerPoNo: string | null; expectedDate: string | null; notes: string | null; rejectReason: string | null; createdAt: string; customer: string; placedBy: string | null; salesOrderId: string | null; salesOrderNumber: string | null; lines: { code: string; name: string; qty: string; remarks: string | null }[] | null }
interface Login { id: string; party: string; kind: string; name: string; email: string; status: string; lastLoginAt: string | null; inviteExpiresAt: string | null }
const TONE = { submitted: "primary", accepted: "success", rejected: "danger", withdrawn: "neutral", invited: "warning", active: "success", disabled: "neutral" } as const;

export default function PortalAdminPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"orders" | "logins">(can("portal.orders.manage") ? "orders" : "logins");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Customer & dealer portal" description="Orders customers and dealers place on the portal, and who can sign in to it. The portal is at /portal." />
      <div className="flex gap-1 text-sm">
        {can("portal.orders.manage") && <button type="button" onClick={() => setTab("orders")} className={`rounded-lg px-3 py-1.5 ${tab === "orders" ? "bg-primary/10 font-medium text-primary" : "text-muted"}`}>Portal orders</button>}
        {can("portal.users.manage") && <button type="button" onClick={() => setTab("logins")} className={`rounded-lg px-3 py-1.5 ${tab === "logins" ? "bg-primary/10 font-medium text-primary" : "text-muted"}`}>Logins</button>}
      </div>
      {tab === "orders" ? <Orders /> : <Logins />}
    </div>
  );
}

function Orders() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("submitted");
  const [deciding, setDeciding] = useState<Request | null>(null);
  const q = useQuery({ queryKey: ["/portal-admin", "orders", status], queryFn: () => api<Request[]>("/portal-admin/orders", { query: { status: status || undefined } }) });
  return (
    <>
      <Select className="h-9 w-44" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="submitted">To review</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option><option value="">All</option></Select>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((r) => (
              <li key={r.id} className="space-y-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs text-muted">{r.number}</span>
                  <span className="font-medium">{r.customer}</span>
                  <span className="text-xs text-muted">{r.placedBy} · {formatDateTime(r.createdAt)}{r.customerPoNo && ` · PO ${r.customerPoNo}`}{r.expectedDate && ` · needed by ${r.expectedDate}`}</span>
                  <Badge tone={TONE[r.status as keyof typeof TONE]} className="ml-auto">{r.status}</Badge>
                  {r.salesOrderId && <Link className="text-xs text-primary hover:underline" href={`/sales/orders/${r.salesOrderId}`}>{r.salesOrderNumber ?? "draft order"}</Link>}
                  {r.status === "submitted" && <Button size="sm" onClick={() => setDeciding(r)}>Review</Button>}
                </div>
                <p className="text-xs">{r.lines?.map((l) => `${l.code} ${l.name} × ${formatQty(l.qty)}`).join(" · ")}</p>
                {(r.notes || r.rejectReason) && <p className="text-xs text-muted">{r.notes}{r.rejectReason && ` Rejected: ${r.rejectReason}`}</p>}
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">Nothing here.</li>}
          </ul>
        </Card>
      )}
      {deciding && <Decide r={deciding} onClose={() => { setDeciding(null); qc.invalidateQueries({ queryKey: ["/portal-admin"] }); }} />}
    </>
  );
}

function Decide({ r, onClose }: { r: Request; onClose: () => void }) {
  const warehouses = useQuery({ queryKey: ["/inventory/warehouses"], queryFn: () => api<{ id: string; name: string }[]>("/inventory/warehouses") });
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function decide(accept: boolean) {
    setError(null);
    try {
      const res = await api<{ salesOrderId?: string }>(`/portal-admin/orders/${r.id}/decide`, { body: { accept, reason: reason || null, warehouseId: warehouseId || null } });
      if (accept && res.salesOrderId) setDone(res.salesOrderId);
      else onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  if (done) {
    return (
      <Dialog open onClose={onClose} title="Draft sales order made" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Link href={`/sales/orders/${done}`}><Button>Open the order</Button></Link></>}>
        <p className="text-sm">It is priced from the price list. Check prices and dates, then submit it; the customer sees it on the portal once submitted.</p>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={`${r.number}: ${r.customer}`} footer={<><Button variant="ghost" onClick={() => decide(false)} disabled={reason.trim().length < 3}>Reject</Button><Button onClick={() => decide(true)}>Accept into a sales order</Button></>}>
      {error && <Alert>{error}</Alert>}
      <ul className="mb-3 text-sm">{r.lines?.map((l, i) => <li key={i}>{l.code} {l.name} × {formatQty(l.qty)}{l.remarks && ` (${l.remarks})`}</li>)}</ul>
      <div className="grid gap-3">
        <Field label="Ship from">{(p) => <Select {...p} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Decide later</option>{warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}</Field>
        <Field label="Reason, if rejecting" hint="Shown to the customer">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function Logins() {
  const qc = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["/portal-admin", "users"], queryFn: () => api<Login[]>("/portal-admin/users") });
  async function act(id: string, what: "reissue" | "disable") {
    setError(null);
    try {
      const r = await api<{ inviteUrl?: string }>(`/portal-admin/users/${id}/${what}`, { body: {} });
      if (r.inviteUrl) setLink(r.inviteUrl);
      qc.invalidateQueries({ queryKey: ["/portal-admin", "users"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <>
      <div className="flex justify-end"><Button onClick={() => setInviting(true)}><Plus className="size-4" aria-hidden /> Give a login</Button></div>
      {error && <Alert>{error}</Alert>}
      {link && <InviteLink url={link} />}
      {q.isLoading && <LoadingBlock />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
                <span className="font-medium">{u.name}</span>
                <span className="text-xs text-muted">{u.email} · {u.party}</span>
                <Badge>{u.kind}</Badge>
                <span className="text-xs text-muted">{u.lastLoginAt ? `last in ${formatDateTime(u.lastLoginAt)}` : "never signed in"}</span>
                <Badge tone={TONE[u.status as keyof typeof TONE]} className="ml-auto">{u.status}</Badge>
                <Button size="sm" variant="ghost" onClick={() => act(u.id, "reissue")}>{u.status === "disabled" ? "Re-enable" : "New link"}</Button>
                {u.status !== "disabled" && <Button size="sm" variant="ghost" onClick={() => act(u.id, "disable")}>Disable</Button>}
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">No portal logins yet.</li>}
          </ul>
        </Card>
      )}
      {inviting && <InviteDialog onClose={(url) => { setInviting(false); if (url) setLink(url); qc.invalidateQueries({ queryKey: ["/portal-admin", "users"] }); }} />}
    </>
  );
}

function InviteLink({ url }: { url: string }) {
  return (
    <Alert tone="success">
      <span className="block">Invitation emailed. You can also share this link (valid 7 days):</span>
      <span className="mt-1 flex items-center gap-2"><code className="break-all text-xs">{url}</code><button type="button" aria-label="Copy link" onClick={() => navigator.clipboard?.writeText(url)}><Copy className="size-4" aria-hidden /></button></span>
    </Alert>
  );
}

function InviteDialog({ onClose }: { onClose: (url?: string) => void }) {
  const customers = useQuery({ queryKey: ["/masters/parties", "customers"], queryFn: () => api<{ items: { id: string; name: string; email: string | null }[] }>("/masters/parties", { query: { role: "customer", limit: 200 } }) });
  const [f, setF] = useState({ partyId: "", kind: "customer", name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      const r = await api<{ inviteUrl: string }>("/portal-admin/users", { body: f });
      onClose(r.inviteUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={() => onClose()} title="Give a portal login" description="The contact gets an email with a link to set their password." footer={<><Button variant="secondary" onClick={() => onClose()}>Cancel</Button><Button onClick={save} disabled={!f.partyId || f.name.trim().length < 2 || !f.email.includes("@")}>Send invitation</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Customer">{(p) => <Select {...p} value={f.partyId} onChange={(e) => setF({ ...f, partyId: e.target.value })}><option value="">Choose…</option>{customers.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Portal" hint="A dealer also sees schemes, claims and their stock; the customer must be set up as a distributor">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="customer">Customer</option><option value="dealer">Dealer</option></Select>}</Field>
        <Field label="Contact name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Contact email">{(p) => <Input {...p} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
