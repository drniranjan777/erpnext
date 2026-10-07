"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CRM, type Stage } from "@/lib/crm";
import { todayIST } from "@/lib/documents";
import { inr } from "@/lib/payroll";

interface Territory { id: string; code: string; name: string; stateCodes: string[]; ownerId: string | null; owner: string | null; isActive: boolean; openLeads: number }
interface Form { id: string; name: string; key: string; source: string; ownerId: string | null; isActive: boolean; submissions: number }
interface Target { userId: string; name: string; target: number; won: number; pipeline: number }
interface Member { userId: string; fullName: string }
type Tab = "targets" | "territories" | "stages" | "forms";

export default function CrmSetupPage() {
  const { can } = useAuth();
  const manage = can("crm.setup.manage");
  const [tab, setTab] = useState<Tab>("targets");
  const members = useQuery({ queryKey: ["iam", "users"], queryFn: () => api<Member[]>("/iam/users"), retry: false });
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="CRM setup" description="Sales targets, territories (which states each salesperson covers), pipeline stages and website enquiry forms." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "targets", label: "Targets" }, { value: "territories", label: "Territories" }, { value: "stages", label: "Stages" }, { value: "forms", label: "Web forms" }]} />
      {tab === "targets" && <Targets manage={manage} members={members.data ?? []} />}
      {tab === "territories" && <Territories manage={manage} members={members.data ?? []} />}
      {tab === "stages" && <Stages manage={manage} />}
      {tab === "forms" && <Forms manage={manage} members={members.data ?? []} />}
    </div>
  );
}

function useSave(key: unknown[]) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  async function save(path: string, body: unknown, method: "POST" | "PUT" = "POST") {
    setError(null);
    try {
      await api(path, { method, body });
      await qc.invalidateQueries({ queryKey: key });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      return false;
    }
  }
  return { error, save };
}

function Targets({ manage, members }: { manage: boolean; members: Member[] }) {
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const q = useQuery({ queryKey: [CRM, "targets", month], queryFn: () => api<Target[]>(`${CRM}/targets`, { query: { month } }) });
  const { error, save } = useSave([CRM, "targets"]);
  const [f, setF] = useState({ userId: "", amount: "" });
  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-border p-4"><Input className="h-9 w-44" type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /><span className="text-xs text-muted">Achievement is the value of opportunities won in the month.</span></div>
      {q.isLoading && <LoadingBlock />}
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((t) => {
          const pct = t.target ? Math.round((t.won / t.target) * 100) : null;
          return (
            <li key={t.userId} className="px-5 py-2">
              <p className="flex justify-between"><span className="font-medium">{t.name}</span><span className="tabular-nums">{inr(t.won)} of {inr(t.target)}{pct !== null && ` · ${pct} %`} · {inr(t.pipeline)} in pipeline</span></p>
              {t.target > 0 && <div className="mt-1 h-1.5 rounded bg-surface-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.min(100, pct ?? 0)}%` }} /></div>}
            </li>
          );
        })}
        {q.data && !q.data.length && <li className="px-5 py-4 text-muted">No targets for this month.</li>}
      </ul>
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Salesperson">{(p) => <Select {...p} value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Choose…</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>}</Field>
          <Field label="Target (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Button size="sm" disabled={!f.userId || !Number(f.amount)} onClick={async () => (await save(`${CRM}/targets`, { userId: f.userId, month, amount: Number(f.amount) })) && setF({ userId: "", amount: "" })}><Plus className="size-4" aria-hidden /> Set</Button>
        </div>
      )}
    </Card>
  );
}

function Territories({ manage, members }: { manage: boolean; members: Member[] }) {
  const q = useQuery({ queryKey: [CRM, "territories"], queryFn: () => api<Territory[]>(`${CRM}/territories`) });
  const { error, save } = useSave([CRM, "territories"]);
  const [f, setF] = useState({ code: "", name: "", states: "", ownerId: "" });
  return (
    <Card>
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((t) => <li key={t.id} className="flex flex-wrap gap-3 px-5 py-2"><span className="w-20 font-mono text-xs text-muted">{t.code}</span><span className="font-medium">{t.name}</span><span className="text-xs text-muted">states {t.stateCodes.join(", ") || "–"} · {t.owner ?? "no owner"}</span><span className="ml-auto text-xs">{t.openLeads} open leads</span></li>)}
        {q.data && !q.data.length && <li className="px-5 py-4 text-muted">No territories: new leads stay unassigned until someone takes them.</li>}
      </ul>
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Code">{(p) => <Input {...p} className="w-24" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
          <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="State codes" hint="e.g. 36, 37, 29">{(p) => <Input {...p} className="w-40" value={f.states} onChange={(e) => setF({ ...f, states: e.target.value })} />}</Field>
          <Field label="Owner">{(p) => <Select {...p} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">—</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>}</Field>
          <Button size="sm" disabled={!f.code || f.name.trim().length < 2} onClick={async () => (await save(`${CRM}/territories`, { code: f.code, name: f.name, stateCodes: f.states.split(/[,\s]+/).filter(Boolean), ownerId: f.ownerId || null })) && setF({ code: "", name: "", states: "", ownerId: "" })}><Plus className="size-4" aria-hidden /> Add</Button>
        </div>
      )}
    </Card>
  );
}

function Stages({ manage }: { manage: boolean }) {
  const q = useQuery({ queryKey: [CRM, "stages"], queryFn: () => api<Stage[]>(`${CRM}/stages`) });
  const { error, save } = useSave([CRM, "stages"]);
  const [f, setF] = useState({ name: "", probability: "", sequence: "" });
  return (
    <Card>
      <ul className="divide-y divide-border text-sm">
        {q.data?.map((s) => <li key={s.id} className="flex items-center gap-3 px-5 py-2"><span className="w-6 text-xs text-muted">{s.sequence}</span><span className="font-medium">{s.name}</span><Badge tone={s.kind === "won" ? "success" : s.kind === "lost" ? "danger" : "neutral"}>{s.kind}</Badge><span className="ml-auto tabular-nums">{s.probability} %</span>{manage && s.kind === "open" && <Button size="sm" variant="ghost" onClick={() => save(`${CRM}/stages/${s.id}`, { ...s, isActive: !s.isActive }, "PUT")}>{s.isActive ? "Hide" : "Show"}</Button>}</li>)}
      </ul>
      {manage && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Stage">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Probability %">{(p) => <Input {...p} className="w-24" type="number" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} />}</Field>
          <Field label="Order">{(p) => <Input {...p} className="w-20" type="number" value={f.sequence} onChange={(e) => setF({ ...f, sequence: e.target.value })} />}</Field>
          <Button size="sm" disabled={f.name.trim().length < 2 || !f.sequence} onClick={async () => (await save(`${CRM}/stages`, { name: f.name, probability: Number(f.probability) || 0, sequence: Number(f.sequence) })) && setF({ name: "", probability: "", sequence: "" })}><Plus className="size-4" aria-hidden /> Add</Button>
        </div>
      )}
    </Card>
  );
}

function Forms({ manage, members }: { manage: boolean; members: Member[] }) {
  const q = useQuery({ queryKey: [CRM, "forms"], queryFn: () => api<Form[]>(`${CRM}/forms`), enabled: manage });
  const { error, save } = useSave([CRM, "forms"]);
  const [f, setF] = useState({ name: "", ownerId: "" });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippet = (key: string) => `<script>
  // Call from your enquiry form's submit handler.
  async function sendEnquiry(form) {
    const data = Object.fromEntries(new FormData(form));
    const res = await fetch("${origin}/api/v1/public/crm/forms/${key}/leads", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
    });
    return res.ok; // fields: name, email or phone, company, city, state, product, message; leave "website" empty
  }
</script>`;
  if (!manage) return <p className="text-sm text-muted">You need the CRM setup permission to manage web forms.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Your website sends each enquiry as JSON with the snippet below. Leads land in CRM, assigned to the form&apos;s owner or the territory owner. A hidden “website” field catches bots.</p>
      {q.data?.map((x) => (
        <Card key={x.id} className="px-5 py-3 text-sm">
          <p className="flex items-center gap-2"><span className="font-medium">{x.name}</span><Badge>{x.submissions} enquiries</Badge>{!x.isActive && <Badge tone="danger">off</Badge>}<Button className="ml-auto" size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(snippet(x.key))}><Copy className="size-3.5" aria-hidden /> Copy snippet</Button><Button size="sm" variant="ghost" onClick={() => save(`${CRM}/forms/${x.id}`, { name: x.name, source: x.source, ownerId: x.ownerId, isActive: !x.isActive }, "PUT")}>{x.isActive ? "Turn off" : "Turn on"}</Button></p>
          <pre className="mt-2 overflow-x-auto rounded bg-surface-muted p-2 text-xs">{snippet(x.key)}</pre>
        </Card>
      ))}
      <Card className="flex flex-wrap items-end gap-2 p-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Form name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Leads go to">{(p) => <Select {...p} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">Territory owner</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}</Select>}</Field>
        <Button size="sm" disabled={f.name.trim().length < 2} onClick={async () => (await save(`${CRM}/forms`, { name: f.name, ownerId: f.ownerId || null })) && setF({ name: "", ownerId: "" })}><Plus className="size-4" aria-hidden /> Create form</Button>
      </Card>
    </div>
  );
}
