"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { askConfirm } from "@/components/ui/ask";

type Op = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "exists";
interface Condition { field: string; op: Op; value?: string }
type Action =
  | { type: "notify"; roleIds?: string[]; userIds?: string[]; title: string; body: string }
  | { type: "email"; to: string; subject: string; body: string }
  | { type: "webhook"; url: string }
  | { type: "connector"; connector: string; action: string };
interface Automation { id: string; name: string; event: string; conditions: Condition[]; actions: Action[]; enabled: boolean; runCount: number; lastRunAt: string | null }
interface Run { id: string; event: string; status: string; results: { action: string; ok: boolean; detail: string }[]; createdAt: string }
interface Role { id: string; name: string }

const OPS: Record<Op, string> = { eq: "is", ne: "is not", gt: ">", gte: "≥", lt: "<", lte: "≤", in: "is one of", contains: "contains", exists: "is filled" };
const FIELDS = ["docType", "status", "amount", "number", "title", "currency", "connector", "customer", "product"];
const CONNECTOR_ACTIONS = [["shiprocket", "create_shipment", "Shiprocket: book shipment (delivery notes)"], ["delhivery", "create_shipment", "Delhivery: create waybill (delivery notes)"], ["razorpay_links", "payment_link", "Razorpay: payment link (sales invoices)"]] as const;

/** Workflow automations: when an event happens and conditions hold, run actions. */
export default function AutomationsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["/automations"], queryFn: () => api<{ events: Record<string, string>; automations: Automation[] }>("/automations") });
  const roles = useQuery({ queryKey: ["/iam/roles"], queryFn: () => api<Role[]>("/iam/roles") });
  const [open, setOpen] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["/automations", open, "runs"], queryFn: () => api<Run[]>(`/automations/${open}/runs`), enabled: !!open });
  const [f, setF] = useState({ name: "", event: "document.approved" });
  const [conds, setConds] = useState<Condition[]>([{ field: "docType", op: "eq", value: "" }]);
  const [acts, setActs] = useState<Action[]>([]);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/automations"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const setAct = (i: number, a: Action) => setActs(acts.map((x, j) => (j === i ? a : x)));
  const describe = (a: Action) => (a.type === "notify" ? `notify: ${a.title}` : a.type === "email" ? `email ${a.to}` : a.type === "webhook" ? `call ${a.url}` : `${a.connector} ${a.action.replace("_", " ")}`);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Automations" description="When something happens — a document submitted, approved, rejected or cancelled, a member joins, a connector imports orders or leads — and the conditions hold, the actions run in the background. Texts can use {{number}}, {{amount}}, {{docType}} and other fields of the event." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data?.automations.map((a) => (
            <li key={a.id} className="space-y-1 px-4 py-2">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "on" : "off"}</Badge>
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-muted">when {q.data?.events[a.event]?.toLowerCase()}{a.conditions.length ? ` and ${a.conditions.map((c) => `${c.field} ${OPS[c.op]} ${c.value ?? ""}`).join(" and ")}` : ""} → {a.actions.map(describe).join("; ")} · ran {a.runCount} time(s){a.lastRunAt ? `, last ${timeAgo(a.lastRunAt)}` : ""}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setOpen(open === a.id ? null : a.id)}>Runs</Button>
                  <Button size="sm" variant="secondary" onClick={() => run(() => api(`/automations/${a.id}`, { method: "PUT", body: { name: a.name, event: a.event, conditions: a.conditions, actions: a.actions, enabled: !a.enabled } }), a.enabled ? "Switched off." : "Switched on.")}>{a.enabled ? "Switch off" : "Switch on"}</Button>
                  <Button size="sm" variant="secondary" aria-label="Delete" onClick={async () => await askConfirm(`Delete ${a.name}?`) && run(() => api(`/automations/${a.id}`, { method: "DELETE" }), "Deleted.")}><Trash2 className="size-4" aria-hidden /></Button>
                </span>
              </p>
              {open === a.id && runs.data?.map((r) => <p key={r.id} className="pl-6 text-xs"><Badge tone={r.status === "ok" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{r.status}</Badge> {formatDateTime(r.createdAt)} · {r.results.map((x) => `${x.ok ? "✓" : "✗"} ${x.detail}`).join(" · ")}</p>)}
            </li>
          ))}
          {q.data && !q.data.automations.length && <li className="px-4 py-6 text-center text-muted">No automations yet.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="New automation" />
        <div className="space-y-3 border-t border-border p-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label="Name" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Select aria-label="When" value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })}>{Object.entries(q.data?.events ?? {}).map(([k, v]) => <option key={k} value={k}>When {v.toLowerCase()}</option>)}</Select>
          </div>
          <p className="font-medium">Only if</p>
          {conds.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Select className="h-9 w-40" aria-label="Field" value={c.field} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>{FIELDS.map((x) => <option key={x}>{x}</option>)}</Select>
              <Select className="h-9 w-32" aria-label="Test" value={c.op} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)))}>{Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              {c.op !== "exists" && <Input className="h-9 flex-1" aria-label="Value" placeholder={c.op === "in" ? "a, b, c" : "value (purchase_order, delivery_note…)"} value={c.value ?? ""} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />}
              <Button size="sm" variant="secondary" aria-label="Remove condition" onClick={() => setConds(conds.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setConds([...conds, { field: "amount", op: "gt", value: "" }])}><Plus className="size-4" aria-hidden /> Condition</Button>
          <p className="font-medium">Then</p>
          {acts.map((a, i) => (
            <div key={i} className="space-y-1 rounded-lg border border-border p-2">
              <p className="flex items-center justify-between text-xs font-medium uppercase text-muted">{a.type}<button type="button" className="text-danger" onClick={() => setActs(acts.filter((_, j) => j !== i))}>Remove</button></p>
              {a.type === "notify" && (
                <>
                  <Select aria-label="Role" value={a.roleIds?.[0] ?? ""} onChange={(e) => setAct(i, { ...a, roleIds: e.target.value ? [e.target.value] : [] })}><option value="">Notify people with role…</option>{roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
                  <Input aria-label="Title" placeholder="Title, e.g. {{number}} approved" value={a.title} onChange={(e) => setAct(i, { ...a, title: e.target.value })} />
                  <Input aria-label="Message" placeholder="Message" value={a.body} onChange={(e) => setAct(i, { ...a, body: e.target.value })} />
                </>
              )}
              {a.type === "email" && (
                <>
                  <Input aria-label="To" type="email" placeholder="To" value={a.to} onChange={(e) => setAct(i, { ...a, to: e.target.value })} />
                  <Input aria-label="Subject" placeholder="Subject" value={a.subject} onChange={(e) => setAct(i, { ...a, subject: e.target.value })} />
                  <Input aria-label="Body" placeholder="Body" value={a.body} onChange={(e) => setAct(i, { ...a, body: e.target.value })} />
                </>
              )}
              {a.type === "webhook" && <Input aria-label="URL" placeholder="https://…" value={a.url} onChange={(e) => setAct(i, { ...a, url: e.target.value })} />}
              {a.type === "connector" && <Select aria-label="Connector action" value={`${a.connector}:${a.action}`} onChange={(e) => { const [connector, action] = e.target.value.split(":"); setAct(i, { type: "connector", connector, action }); }}>{CONNECTOR_ACTIONS.map(([c, x, l]) => <option key={`${c}:${x}`} value={`${c}:${x}`}>{l}</option>)}</Select>}
            </div>
          ))}
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setActs([...acts, { type: "notify", roleIds: [], title: "", body: "" }])}>+ Notify</Button>
            <Button size="sm" variant="secondary" onClick={() => setActs([...acts, { type: "email", to: "", subject: "", body: "" }])}>+ Email</Button>
            <Button size="sm" variant="secondary" onClick={() => setActs([...acts, { type: "webhook", url: "" }])}>+ Webhook</Button>
            <Button size="sm" variant="secondary" onClick={() => setActs([...acts, { type: "connector", connector: "shiprocket", action: "create_shipment" }])}>+ Connector</Button>
          </span>
          <Button disabled={f.name.length < 2 || !acts.length} onClick={() => run(() => api("/automations", { body: { name: f.name, event: f.event, conditions: conds.filter((c) => c.op === "exists" || c.value), actions: acts } }), "Automation saved.").then(() => { setF({ name: "", event: "document.approved" }); setActs([]); })}>Save automation</Button>
        </div>
      </Card>
    </div>
  );
}
