"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { AI, humanKey, SEVERITY_TONE, type Recommendation } from "@/lib/ai";

const STATUSES = ["open", "executed", "accepted", "dismissed", "failed", "expired"];

/** Recommendations from the agents: approve to run the proposed action (with your permissions), or dismiss with a reason. */
export default function InboxPage() {
  const [status, setStatus] = useState("open");
  const [agent, setAgent] = useState("");
  const q = useQuery({ queryKey: [AI, "inbox", status, agent], queryFn: () => api<Recommendation[]>(`${AI}/inbox`, { query: { status, agent: agent || undefined } }) });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="AI Inbox" description="What the agents found. Approving runs the proposed action through the normal screens' rules, as you; nothing is posted without a person or a guardrail you set." actions={<Link href={`${AI}/agents`}><Button variant="secondary"><Bot className="size-4" aria-hidden /> Agents</Button></Link>} />
      <div className="flex flex-wrap gap-2">
        <Select className="h-9 w-40" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select className="h-9 w-44" aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All agents</option>{["inventory", "purchase", "sales", "finance", "production", "maintenance", "quality", "hr", "compliance", "support"].map((a) => <option key={a} value={a}>{a}</option>)}</Select>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && !q.data.length && <Card className="px-5 py-10 text-center text-sm text-muted">{status === "open" ? "Nothing needs you right now." : "Nothing here."}</Card>}
      <div className="space-y-3">{q.data?.map((r) => <Rec key={r.id} r={r} />)}</div>
    </div>
  );
}

function Rec({ r }: { r: Recommendation }) {
  const qc = useQueryClient();
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function decide(approve: boolean) {
    setError(null);
    setBusy(true);
    try {
      await api(`${AI}/inbox/${r.id}/decide`, { body: { approve, note: note || null } });
      qc.invalidateQueries({ queryKey: [AI] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  const evidence = Object.entries(r.evidence).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
        <Badge>{r.agentCode}</Badge>
        <p className="min-w-0 flex-1 font-medium">{r.link ? <Link className="hover:underline" href={r.link}>{r.title}</Link> : r.title}</p>
        <span className="text-xs text-muted">{timeAgo(r.createdAt)}</span>
      </div>
      <p className="text-sm">{r.body}</p>
      {evidence.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Why{r.confidence && ` · confidence ${Math.round(Number(r.confidence) * 100)} %`}</summary>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">{evidence.map(([k, v]) => <div key={k}><dt className="inline">{humanKey(k)}: </dt><dd className="inline font-medium text-foreground">{String(v)}</dd></div>)}</dl>
        </details>
      )}
      {error && <Alert>{error}</Alert>}
      {r.status === "open" || r.status === "failed" ? (
        dismissing ? (
          <div className="flex flex-wrap gap-2">
            <Input className="h-9 flex-1" autoFocus placeholder="Why not? (helps tune the agent)" aria-label="Reason" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" variant="secondary" disabled={note.trim().length < 2 || busy} onClick={() => decide(false)}>Dismiss</Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissing(false)}>Back</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={() => decide(true)}><Check className="size-4" aria-hidden /> {r.action ? r.action.label : "Noted"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissing(true)}><X className="size-4" aria-hidden /> Dismiss</Button>
            {r.action?.amount ? <span className="self-center text-xs text-muted">about ₹{r.action.amount.toLocaleString("en-IN")}</span> : null}
          </div>
        )
      ) : (
        <p className="text-xs text-muted">
          {r.status}{r.autoExecuted ? " automatically" : ""}{r.decidedBy && ` by ${r.decidedBy}`}{r.decidedAt && ` ${timeAgo(r.decidedAt)}`}{r.decisionNote && `: ${r.decisionNote}`}
          {r.result?.link && <> · <Link className="text-primary hover:underline" href={r.result.link}>open what it made</Link></>}
          {r.result?.sentTo && ` · sent to ${r.result.sentTo}`}
          {r.error && <span className="text-danger"> · {r.error}</span>}
        </p>
      )}
    </Card>
  );
}
