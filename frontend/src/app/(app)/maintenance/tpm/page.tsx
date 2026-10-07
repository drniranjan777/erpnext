"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, todayIST } from "@/lib/documents";
import { MT, type Asset } from "@/lib/maintenance";
import { textarea } from "@/lib/qms";

type Tab = "am" | "kaizen" | "fives";
interface Checklist { id: string; title: string; frequency: string; items: string[]; assetCode: string; assetName: string; lastDone: string | null; abnormalities30d: number; everyDays: number }
interface Kaizen { id: string; title: string; area: string; category: string; before: string; after: string; annualSavings: string; submittedBy: string; implementedOn: string | null }
interface FiveS { id: string; area: string; auditDate: string; auditor: string; sort: number; setInOrder: number; shine: number; standardise: number; sustain: number; total: number; change: number | null }

function useSave() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const save = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [MT] });
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      return false;
    }
  };
  return { error, save };
}

export default function TpmPage() {
  const [tab, setTab] = useState<Tab>("am");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="TPM" description="Autonomous maintenance by operators (daily checks that tag abnormalities), the kaizen register, and 5S audits by area." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "am", label: "Autonomous maintenance" }, { value: "kaizen", label: "Kaizen" }, { value: "fives", label: "5S audits" }]} />
      {tab === "am" && <Am />}
      {tab === "kaizen" && <Kaizens />}
      {tab === "fives" && <FiveSAudits />}
    </div>
  );
}

function Am() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [MT, "am"], queryFn: () => api<Checklist[]>(`${MT}/am-checklists`) });
  const assets = useQuery({ queryKey: [MT, "assets"], queryFn: () => api<Asset[]>(`${MT}/assets`), enabled: can("maintenance.orders.manage") });
  const { error, save } = useSave();
  const [doing, setDoing] = useState<Checklist | null>(null);
  const [answers, setAnswers] = useState<{ ok: boolean; note: string }[]>([]);
  const [who, setWho] = useState("");
  const [nf, setNf] = useState({ assetId: "", title: "", frequency: "daily", items: "" });
  const today = todayIST();
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {q.isLoading && <LoadingBlock />}
      <div className="grid gap-3 sm:grid-cols-2">
        {q.data?.map((c) => {
          const overdue = !c.lastDone || Date.parse(today) - Date.parse(c.lastDone) >= c.everyDays * 86_400_000;
          return (
            <Card key={c.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{c.title}</p><p className="text-xs text-muted">{c.assetCode} {c.assetName} · {c.frequency} · {c.items.length} points</p></div>{overdue ? <Badge tone="warning">Due</Badge> : <Badge tone="success">Done {formatDate(c.lastDone!)}</Badge>}</div>
              {c.abnormalities30d > 0 && <p className="text-xs text-danger">{c.abnormalities30d} abnormalities tagged in 30 days</p>}
              {can("maintenance.requests.create") && <Button size="sm" variant="secondary" onClick={() => { setDoing(c); setAnswers(c.items.map(() => ({ ok: true, note: "" }))); }}>Do the check</Button>}
            </Card>
          );
        })}
      </div>
      {doing && (
        <Card>
          <CardHeader title={doing.title} description={`${doing.assetCode} · ${formatDate(today)}`} />
          <div className="space-y-2 border-t border-border p-4">
            {doing.items.map((it, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Select className="h-8 w-28" aria-label={it} value={answers[i]?.ok ? "ok" : "nok"} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? { ...a, ok: e.target.value === "ok" } : a)))}><option value="ok">OK</option><option value="nok">Not OK</option></Select>
                <span className="flex-1">{it}</span>
                {!answers[i]?.ok && <Input className="h-8 w-56" aria-label="What is wrong" placeholder="What is wrong" value={answers[i]?.note ?? ""} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? { ...a, note: e.target.value } : a)))} />}
              </div>
            ))}
            <div className="flex items-end justify-end gap-2">
              <Field label="Checked by">{(p) => <Input {...p} value={who} onChange={(e) => setWho(e.target.value)} />}</Field>
              <Button variant="secondary" onClick={() => setDoing(null)}>Cancel</Button>
              <Button disabled={who.trim().length < 2} onClick={async () => { if (await save(() => api(`${MT}/am-checklists/${doing.id}/checks`, { body: { doneBy: who, results: answers.map((a) => ({ ok: a.ok, note: a.note || null })) } }))) setDoing(null); }}>Save</Button>
            </div>
          </div>
        </Card>
      )}
      {can("maintenance.orders.manage") && (
        <Card>
          <CardHeader title="New checklist" />
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-4">
            <Field label="Asset">{(p) => <Select {...p} value={nf.assetId} onChange={(e) => setNf({ ...nf, assetId: e.target.value })}><option value="">Choose…</option>{assets.data?.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</Select>}</Field>
            <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={nf.title} onChange={(e) => setNf({ ...nf, title: e.target.value })} />}</Field>
            <Field label="How often">{(p) => <Select {...p} value={nf.frequency} onChange={(e) => setNf({ ...nf, frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select>}</Field>
            <Field label="Points (one per line)" className="sm:col-span-4">{(p) => <textarea {...p} rows={4} className={textarea} value={nf.items} onChange={(e) => setNf({ ...nf, items: e.target.value })} />}</Field>
            <div className="flex justify-end sm:col-span-4"><Button disabled={!nf.assetId || nf.title.trim().length < 3 || !nf.items.trim()} onClick={async () => { if (await save(() => api(`${MT}/am-checklists`, { body: { ...nf, items: nf.items.split("\n").map((x) => x.trim()).filter(Boolean) } }))) setNf({ assetId: "", title: "", frequency: "daily", items: "" }); }}>Save checklist</Button></div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Kaizens() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [MT, "kaizens"], queryFn: () => api<{ items: Kaizen[]; year: { count: number; implemented: number; savings: string } }>(`${MT}/kaizens`) });
  const { error, save } = useSave();
  const [f, setF] = useState({ title: "", area: "", category: "cost", before: "", after: "", annualSavings: "", submittedBy: "", implementedOn: "" });
  return (
    <div className="space-y-4">
      {q.data && <p className="text-sm text-muted">This year: {q.data.year.count} kaizens, {q.data.year.implemented} implemented, {formatMoney(q.data.year.savings)} saved a year.</p>}
      {error && <Alert>{error}</Alert>}
      {can("maintenance.requests.create") && (
        <Card className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Area">{(p) => <Input {...p} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />}</Field>
          <Field label="Improves">{(p) => <Select {...p} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{["quality", "cost", "delivery", "safety", "morale", "environment"].map((c) => <option key={c} value={c}>{c}</option>)}</Select>}</Field>
          <Field label="Before" className="sm:col-span-2">{(p) => <Input {...p} value={f.before} onChange={(e) => setF({ ...f, before: e.target.value })} />}</Field>
          <Field label="After" className="sm:col-span-2">{(p) => <Input {...p} value={f.after} onChange={(e) => setF({ ...f, after: e.target.value })} />}</Field>
          <Field label="Savings a year (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.annualSavings} onChange={(e) => setF({ ...f, annualSavings: e.target.value })} />}</Field>
          <Field label="By">{(p) => <Input {...p} value={f.submittedBy} onChange={(e) => setF({ ...f, submittedBy: e.target.value })} />}</Field>
          <Field label="Implemented on">{(p) => <Input {...p} type="date" value={f.implementedOn} onChange={(e) => setF({ ...f, implementedOn: e.target.value })} />}</Field>
          <div className="flex items-end justify-end"><Button disabled={f.title.trim().length < 3 || !f.area || f.before.length < 3 || f.after.length < 3 || f.submittedBy.length < 2} onClick={async () => { if (await save(() => api(`${MT}/kaizens`, { body: { ...f, implementedOn: f.implementedOn || null } }))) setF({ ...f, title: "", before: "", after: "", annualSavings: "" }); }}>Add kaizen</Button></div>
        </Card>
      )}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data?.items.map((k) => (
            <li key={k.id} className="space-y-1 px-5 py-3">
              <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{k.title}</span><Badge>{k.category}</Badge><span className="text-muted">{k.area} · {k.submittedBy}</span>{k.implementedOn ? <Badge tone="success">Implemented {formatDate(k.implementedOn)}</Badge> : <Badge tone="warning">Idea</Badge>}{Number(k.annualSavings) > 0 && <span className="text-muted">{formatMoney(k.annualSavings)} / year</span>}</p>
              <p className="text-xs"><span className="text-muted">Before:</span> {k.before} <span className="text-muted">→ After:</span> {k.after}</p>
            </li>
          ))}
          {q.data && !q.data.items.length && <li className="px-5 py-4 text-center text-muted">No kaizens yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

function FiveSAudits() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: [MT, "five-s"], queryFn: () => api<FiveS[]>(`${MT}/five-s`) });
  const { error, save } = useSave();
  const [f, setF] = useState({ area: "", auditor: "", sort: 3, setInOrder: 3, shine: 3, standardise: 3, sustain: 3 });
  const S = [["sort", "Sort"], ["setInOrder", "Set in order"], ["shine", "Shine"], ["standardise", "Standardise"], ["sustain", "Sustain"]] as const;
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {can("maintenance.orders.manage") && (
        <Card className="grid gap-3 p-4 sm:grid-cols-8">
          <Field label="Area" className="sm:col-span-2">{(p) => <Input {...p} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />}</Field>
          {S.map(([k, l]) => <Field key={k} label={l}>{(p) => <Select {...p} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}</Field>)}
          <Field label="Auditor">{(p) => <Input {...p} value={f.auditor} onChange={(e) => setF({ ...f, auditor: e.target.value })} />}</Field>
          <div className="flex items-end justify-end sm:col-span-8"><Button disabled={f.area.length < 2 || f.auditor.length < 2} onClick={() => save(() => api(`${MT}/five-s`, { body: f }))}>Record audit ({f.sort + f.setInOrder + f.shine + f.standardise + f.sustain} / 25)</Button></div>
        </Card>
      )}
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Area</th><th className="px-4 py-2 font-medium">Date</th>{S.map(([, l]) => <th key={l} className="px-2 py-2 text-center font-medium">{l}</th>)}<th className="px-4 py-2 text-right font-medium">Total</th></tr></thead>
          <tbody className="divide-y divide-border">
            {q.data?.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2">{a.area}<span className="block text-xs text-muted">{a.auditor}</span></td>
                <td className="px-4 py-2">{formatDate(a.auditDate)}</td>
                {S.map(([k]) => <td key={k} className="px-2 py-2 text-center tabular-nums">{a[k]}</td>)}
                <td className="px-4 py-2 text-right tabular-nums"><span className="font-semibold">{a.total}</span>/25{a.change !== null && a.change !== 0 && <span className={`ml-1 text-xs ${a.change > 0 ? "text-success" : "text-danger"}`}>{a.change > 0 ? "+" : ""}{a.change}</span>}</td>
              </tr>
            ))}
            {q.data && !q.data.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">No audits.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
