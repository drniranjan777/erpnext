"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Power } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AI, type AgentRow } from "@/lib/ai";

interface Overview { killed: boolean; killReason: string | null; killedAt: string | null; agents: AgentRow[] }
interface Eval { agentCode: string; kind: string; raised: number; accepted: number; dismissed: number; executed: number; failed: number; expired: number; open: number; auto: number; hoursToDecide: string | null; acceptancePct: number | null }
interface Run { id: string; agentCode: string; trigger: string; status: string; findings: number; created: number; executed: number; error: string | null; startedAt: string }

export default function AgentsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("ai.agents.manage");
  const q = useQuery({ queryKey: [AI, "agents"], queryFn: () => api<Overview>(`${AI}/agents`) });
  const ev = useQuery({ queryKey: [AI, "evaluation"], queryFn: () => api<Eval[]>(`${AI}/evaluation`, { query: { days: 90 } }) });
  const runs = useQuery({ queryKey: [AI, "runs"], queryFn: () => api<Run[]>(`${AI}/runs`) });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const o = q.data!;
  async function kill(killed: boolean) {
    const reason = killed ? window.prompt("Why stop all agents?") : null;
    if (killed && reason === null) return;
    await api(`${AI}/kill-switch`, { body: { killed, reason } }).catch(() => null);
    qc.invalidateQueries({ queryKey: [AI] });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="AI agents" description="Agents watch the business on a schedule and raise recommendations in the AI Inbox. They act on their own only within the guardrails you set, as the person who allowed it." actions={manage && <Button variant={o.killed ? "primary" : "secondary"} onClick={() => kill(!o.killed)}><Power className="size-4" aria-hidden /> {o.killed ? "Resume agents" : "Stop all agents"}</Button>} />
      {o.killed && <Alert tone="warning">All agents are stopped{o.killReason ? `: ${o.killReason}` : ""}. Nothing runs or executes until they are resumed.</Alert>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        {o.agents.map((a) => <AgentCard key={a.code} a={a} manage={manage} onMsg={setMsg} />)}
      </div>
      <Card>
        <CardHeader title="How the agents are doing (90 days)" description="Acceptance = approved or executed out of those decided. The target at pilots is 60 % or more." />
        <table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Agent · finding</th><th className="px-4 py-2 text-right font-medium">Raised</th><th className="px-4 py-2 text-right font-medium">Done</th><th className="px-4 py-2 text-right font-medium">Dismissed</th><th className="px-4 py-2 text-right font-medium">Expired</th><th className="px-4 py-2 text-right font-medium">Accepted</th><th className="px-4 py-2 text-right font-medium">Hours to decide</th></tr></thead>
          <tbody className="divide-y divide-border">
            {ev.data?.map((e) => (
              <tr key={`${e.agentCode}-${e.kind}`}>
                <td className="px-4 py-2">{e.agentCode} · {e.kind.replace(/_/g, " ")}</td>
                <td className="px-4 py-2 text-right tabular-nums">{e.raised}</td>
                <td className="px-4 py-2 text-right tabular-nums">{e.accepted + e.executed}{e.auto ? ` (${e.auto} auto)` : ""}</td>
                <td className="px-4 py-2 text-right tabular-nums">{e.dismissed}</td>
                <td className="px-4 py-2 text-right tabular-nums">{e.expired}</td>
                <td className="px-4 py-2 text-right">{e.acceptancePct === null ? "–" : <Badge tone={e.acceptancePct >= 60 ? "success" : e.acceptancePct >= 40 ? "warning" : "danger"}>{e.acceptancePct} %</Badge>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{e.hoursToDecide ?? "–"}</td>
              </tr>
            ))}
            {ev.data && !ev.data.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No recommendations yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Recent runs" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {runs.data?.slice(0, 20).map((r) => <li key={r.id} className="flex flex-wrap gap-3 px-5 py-1.5"><span className="w-28 text-xs text-muted">{timeAgo(r.startedAt)}</span><span>{r.agentCode}</span><Badge tone={r.status === "ok" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{r.status}</Badge><span className="text-xs text-muted">{r.trigger} · {r.findings} found, {r.created} new{r.executed ? `, ${r.executed} done automatically` : ""}{r.error && ` · ${r.error}`}</span></li>)}
        </ul>
      </Card>
    </div>
  );
}

function AgentCard({ a, manage, onMsg }: { a: AgentRow; manage: boolean; onMsg: (m: { tone: "success" | "danger"; text: string }) => void }) {
  const qc = useQueryClient();
  const g = a.guardrails;
  const [f, setF] = useState({
    enabled: a.enabled,
    schedule: a.schedule,
    runHour: String(a.runHour),
    autoExecute: !!g.autoExecute,
    autoExecuteBelow: g.autoExecuteBelow != null ? String(g.autoExecuteBelow) : "",
    maxAmount: g.maxAmount != null ? String(g.maxAmount) : "",
    params: Object.fromEntries(Object.entries(a.params).map(([k, p]) => [k, String(g.params?.[k] ?? p.default)])),
  });
  async function save() {
    try {
      await api(`${AI}/agents/${a.code}`, {
        method: "PUT",
        body: { enabled: f.enabled, schedule: f.schedule, runHour: Number(f.runHour), guardrails: { autoExecute: f.autoExecute, autoExecuteBelow: f.autoExecuteBelow ? Number(f.autoExecuteBelow) : null, maxAmount: f.maxAmount ? Number(f.maxAmount) : null, params: Object.fromEntries(Object.entries(f.params).map(([k, v]) => [k, Number(v)])) } },
      });
      onMsg({ tone: "success", text: `${a.name} saved.` });
      qc.invalidateQueries({ queryKey: [AI] });
    } catch (err) {
      onMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  async function run() {
    try {
      const r = await api<{ status: string; findings: number; created: number; executed: number }>(`${AI}/agents/${a.code}/run`, { body: {} });
      onMsg({ tone: "success", text: r.status === "skipped" ? "Agents are stopped." : `${a.name}: ${r.findings} found, ${r.created} new in the inbox${r.executed ? `, ${r.executed} done automatically` : ""}.` });
      qc.invalidateQueries({ queryKey: [AI] });
    } catch (err) {
      onMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <Card>
      <CardHeader
        title={a.name}
        description={a.description}
        action={<span className="flex items-center gap-2">{a.open > 0 && <Badge tone="primary">{a.open} open</Badge>}<Badge tone={a.enabled ? "success" : "neutral"}>{a.enabled ? "on" : "off"}</Badge></span>}
      />
      <div className="space-y-3 border-t border-border p-4 text-sm">
        <ul className="list-inside list-disc text-xs text-muted">{a.watches.map((w) => <li key={w}>{w}</li>)}</ul>
        <p className="text-xs text-muted">{a.lastRunAt ? `Last ran ${timeAgo(a.lastRunAt)} (${a.lastStatus})` : "Never run"}{a.nextRunAt && ` · next ${new Date(a.nextRunAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}</p>
        {manage && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> On</label>
              <Field label="Runs">{(p) => <Select {...p} value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })}><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly (Monday)</option></Select>}</Field>
              {f.schedule !== "hourly" && <Field label="At (hour, IST)">{(p) => <Input {...p} className="w-20" type="number" min={0} max={23} value={f.runHour} onChange={(e) => setF({ ...f, runHour: e.target.value })} />}</Field>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(a.params).map(([k, p]) => <Field key={k} label={p.label}>{(pp) => <Input {...pp} inputMode="decimal" value={f.params[k]} onChange={(e) => setF({ ...f, params: { ...f.params, [k]: e.target.value } })} />}</Field>)}
            </div>
            <div className="rounded-lg bg-surface-muted p-3">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.autoExecute} onChange={(e) => setF({ ...f, autoExecute: e.target.checked })} /> Act without waiting for approval (as you)</label>
              {f.autoExecute && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label="Only up to (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.autoExecuteBelow} onChange={(e) => setF({ ...f, autoExecuteBelow: e.target.value })} />}</Field>
                  <Field label="Never above (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.maxAmount} onChange={(e) => setF({ ...f, maxAmount: e.target.value })} />}</Field>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={run}><Play className="size-4" aria-hidden /> Run now</Button>
              <Button onClick={save}>Save</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
