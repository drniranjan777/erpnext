"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/documents";

interface Feature { code: string; name: string; description: string; model: boolean; enabled: boolean; modelId: string | null }
interface Gov { configured: boolean; killed: boolean; consent: { at: string; by: string | null } | null; maskPii: boolean; monthlyBudgetInr: number | null; planBudgetInr: number; planName: string; budgetInr: number; spentInr: number; features: Feature[]; defaultModel: string; usdInr: number }
interface Usage { days: number; monthCostInr: number; byFeature: { feature: string; calls: number; blocked: number; errors: number; inputTokens: number; outputTokens: number; costInr: number; avgLatencyMs: number | null; piiMasked: number }[]; byUser: { name: string | null; calls: number; costInr: number }[]; notSent: { reason: string; n: number }[] }
interface ModelChange { id: string; feature: string; model: string; note: string | null; changedBy: string | null; createdAt: string }
interface Evals { suites: { code: string; name: string }[]; runs: { id: string; suite: string; cases: number; passed: number; scorePct: number; details: { failures?: { text: string; misses: string[] }[] }; runBy: string | null; createdAt: string }[] }

const REASON: Record<string, string> = { no_consent: "No consent", budget: "Budget used up", off: "Feature off", killed: "Kill switch", not_configured: "No AI key", timeout: "Timed out", network: "Network error" };

/** AI governance: what AI may do in this workspace, what it costs, and how well it performs. */
export default function GovernancePage() {
  const qc = useQueryClient();
  const gov = useQuery({ queryKey: ["/ai/governance"], queryFn: () => api<Gov>("/ai/governance") });
  const usage = useQuery({ queryKey: ["/ai/governance", "usage"], queryFn: () => api<Usage>("/ai/governance/usage", { query: { days: 30 } }) });
  const models = useQuery({ queryKey: ["/ai/governance", "models"], queryFn: () => api<ModelChange[]>("/ai/governance/models") });
  const evals = useQuery({ queryKey: ["/ai/governance", "evals"], queryFn: () => api<Evals>("/ai/governance/evals") });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState<string | null>(null);
  const [model, setModel] = useState({ feature: "copilot", model: "", note: "" });

  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/ai/governance"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  const save = (body: Record<string, unknown>, done = "Saved.") => run(() => api("/ai/governance", { body }), done);

  if (gov.isLoading) return <LoadingBlock />;
  if (gov.error) return <ErrorBlock error={gov.error} />;
  const g = gov.data!;
  const usedPct = g.budgetInr ? Math.min(100, Math.round((g.spentInr / g.budgetInr) * 100)) : 100;
  const latest = (suite: string) => evals.data?.runs.find((r) => r.suite === suite);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="AI governance" description="Decide what AI may do in this workspace, whether data may go to the AI provider, how much it may cost, and check how well it performs." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {!g.configured && <Alert tone="warning">No AI key is set on this server, so every feature runs on its built-in rules. Policy set here applies as soon as a key is added.</Alert>}
      {g.killed && <Alert tone="danger">The AI kill switch is on (AI → Agents): nothing is sent to the model.</Alert>}

      <Card>
        <CardHeader title="Data and consent" description="Model features send the text of questions, tickets and documents to the AI provider (Anthropic). Nothing is sent until an administrator allows it." />
        <div className="space-y-4 border-t border-border p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            {g.consent ? (
              <>
                <Badge tone="success">Allowed</Badge>
                <span className="text-muted">by {g.consent.by ?? "a former user"} on {formatDateTime(g.consent.at)}</span>
                <Button size="sm" variant="ghost" loading={busy} onClick={() => save({ externalConsent: false }, "Consent withdrawn. Model features now use their built-in rules.")}>Withdraw</Button>
              </>
            ) : (
              <>
                <Badge tone="neutral">Not allowed</Badge>
                <Button size="sm" loading={busy} onClick={() => save({ externalConsent: true }, "Consent recorded.")}>Allow sending data to the AI provider</Button>
              </>
            )}
          </div>
          <Checkbox
            checked={g.maskPii}
            onChange={(e) => save({ maskPii: e.target.checked })}
            label="Mask personal data before it leaves"
            description="Emails, phone numbers, PAN, Aadhaar and bank account numbers are replaced with placeholders and put back in the answer. GSTINs are kept."
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Features" description="A feature that is switched off is unavailable to everyone in the workspace." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {g.features.map((f) => (
            <li key={f.code} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Checkbox checked={f.enabled} onChange={(e) => save({ features: { [f.code]: e.target.checked } }, `${f.name} switched ${e.target.checked ? "on" : "off"}.`)} aria-label={f.name} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{f.name} {f.model ? <Badge tone="neutral" className="ml-1">uses the model</Badge> : <Badge tone="success" className="ml-1">runs here</Badge>}</p>
                <p className="text-xs text-muted">{f.description}</p>
              </div>
              {f.modelId && <span className="font-mono text-xs text-muted">{f.modelId}</span>}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Budget" description={`The ${g.planName} plan includes ${formatMoney(g.planBudgetInr)} of AI a month. You can set a lower cap; when it is used up, features fall back to their rules until the 1st.`} />
        <div className="space-y-3 border-t border-border p-4 text-sm">
          <div>
            <div className="mb-1 flex justify-between text-xs"><span>{formatMoney(g.spentInr)} used this month</span><span>of {formatMoney(g.budgetInr)}</span></div>
            <div className="h-2 rounded-full bg-surface-muted"><div className={`h-2 rounded-full ${usedPct >= 90 ? "bg-danger" : "bg-primary"}`} style={{ width: `${usedPct}%` }} /></div>
          </div>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save({ monthlyBudgetInr: budget === "" || budget === null ? null : Number(budget) }, "Budget saved."); }}>
            <Input className="h-9 w-40" type="number" min={0} step={50} aria-label="Monthly cap (₹)" placeholder="Plan budget" value={budget ?? (g.monthlyBudgetInr ?? "")} onChange={(e) => setBudget(e.target.value)} />
            <Button size="sm" type="submit" loading={busy}>Save cap</Button>
            <span className="text-xs text-muted">Leave empty to use the plan budget. Costs use list prices at ₹{g.usdInr}/US$.</span>
          </form>
        </div>
      </Card>

      <Card>
        <CardHeader title="Usage, last 30 days" description={usage.data ? `${formatMoney(usage.data.monthCostInr)} this month.` : undefined} />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2 font-medium">Feature</th><th className="px-4 py-2 text-right font-medium">Calls</th><th className="px-4 py-2 text-right font-medium">Not sent</th><th className="px-4 py-2 text-right font-medium">Tokens in / out</th><th className="px-4 py-2 text-right font-medium">Avg time</th><th className="px-4 py-2 text-right font-medium">Masked</th><th className="px-4 py-2 text-right font-medium">Cost</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {usage.data?.byFeature.map((u) => (
              <tr key={u.feature}>
                <td className="px-4 py-2">{g.features.find((f) => f.code === u.feature)?.name ?? u.feature}</td>
                <td className="px-4 py-2 text-right tabular-nums">{u.calls}{u.errors ? <span className="text-danger"> · {u.errors} failed</span> : null}</td>
                <td className="px-4 py-2 text-right tabular-nums">{u.blocked}</td>
                <td className="px-4 py-2 text-right tabular-nums">{u.inputTokens.toLocaleString("en-IN")} / {u.outputTokens.toLocaleString("en-IN")}</td>
                <td className="px-4 py-2 text-right tabular-nums">{u.avgLatencyMs ? `${(u.avgLatencyMs / 1000).toFixed(1)} s` : "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{u.piiMasked}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMoney(u.costInr)}</td>
              </tr>
            ))}
            {usage.data && !usage.data.byFeature.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No model calls yet.</td></tr>}
          </tbody>
        </table></div>
        {usage.data && (usage.data.notSent.length > 0 || usage.data.byUser.length > 0) && (
          <div className="grid gap-4 border-t border-border p-4 text-xs md:grid-cols-2">
            {usage.data.notSent.length > 0 && <p><span className="text-muted">Not sent: </span>{usage.data.notSent.map((r) => `${REASON[r.reason] ?? r.reason.replace("http_", "HTTP ")} (${r.n})`).join(" · ")}</p>}
            {usage.data.byUser.length > 0 && <p><span className="text-muted">Top users: </span>{usage.data.byUser.map((u) => `${u.name ?? "system"} ${formatMoney(u.costInr)}`).join(" · ")}</p>}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Models" description={`Each model feature uses ${g.defaultModel} unless you choose another. Every change is kept.`} />
        <form className="flex flex-wrap items-center gap-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); run(() => api("/ai/governance/models", { body: { ...model, note: model.note || undefined } }), "Model changed.").then(() => setModel((m) => ({ ...m, model: "", note: "" }))); }}>
          <Select className="h-9 w-44" aria-label="Feature" value={model.feature} onChange={(e) => setModel({ ...model, feature: e.target.value })}>
            {g.features.filter((f) => f.model).map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
          </Select>
          <Input className="h-9 w-64 font-mono text-xs" aria-label="Model id" placeholder="claude-haiku-4-5-20251001" value={model.model} onChange={(e) => setModel({ ...model, model: e.target.value })} />
          <Input className="h-9 flex-1" aria-label="Reason" placeholder="Why (optional)" value={model.note} onChange={(e) => setModel({ ...model, note: e.target.value })} />
          <Button size="sm" type="submit" disabled={!model.model.trim()} loading={busy}>Use model</Button>
        </form>
        <ul className="max-h-56 divide-y divide-border overflow-auto border-t border-border text-sm">
          {models.data?.map((m) => (
            <li key={m.id} className="flex flex-wrap gap-3 px-4 py-1.5">
              <span>{g.features.find((f) => f.code === m.feature)?.name ?? m.feature}</span>
              <span className="font-mono text-xs">{m.model}</span>
              {m.note && <span className="text-xs text-muted">{m.note}</span>}
              <span className="ml-auto text-xs text-muted">{m.changedBy ?? "–"} · {timeAgo(m.createdAt)}</span>
            </li>
          ))}
          {models.data && !models.data.length && <li className="px-4 py-4 text-center text-muted">No changes yet.</li>}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Evaluations" description="Fixed test sets for the features that run on rules. Run them after an upgrade to see whether quality moved." />
        <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-3">
          {evals.data?.suites.map((s) => {
            const r = latest(s.code);
            return (
              <div key={s.code} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{s.name}</p>
                <p className="my-1 text-2xl font-semibold tabular-nums">{r ? `${r.scorePct} %` : "–"}</p>
                <p className="mb-2 text-xs text-muted">{r ? `${r.passed} of ${r.cases} · ${timeAgo(r.createdAt)}` : "Not run yet"}</p>
                <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => api(`/ai/governance/evals/${s.code}`, { body: {} }), `${s.name} evaluated.`)}><FlaskConical className="size-4" aria-hidden /> Run</Button>
                {r?.details.failures?.length ? <ul className="mt-2 space-y-1 text-xs text-danger">{r.details.failures.slice(0, 4).map((f) => <li key={f.text}>{f.text}: {f.misses.join(", ")}</li>)}</ul> : null}
              </div>
            );
          })}
        </div>
        {evals.data && evals.data.runs.length > 0 && (
          <ul className="max-h-48 divide-y divide-border overflow-auto border-t border-border text-xs">
            {evals.data.runs.map((r) => (
              <li key={r.id} className="flex gap-3 px-4 py-1.5">
                <span className="w-32">{evals.data.suites.find((s) => s.code === r.suite)?.name ?? r.suite}</span>
                <span className="tabular-nums">{r.scorePct} %</span>
                <span className="ml-auto text-muted">{r.runBy ?? "–"} · {formatDateTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
