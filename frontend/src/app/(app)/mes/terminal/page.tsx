"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, LogIn, LogOut, Play, Square, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FIRST_OFF, type Execution, type Instruction, type RecipeParameter, type StartCheck } from "@/lib/mes";

interface Machine { id: string; code: string; name: string }
interface QueueOp { operationId: string; seq: number; name: string; status: string; workOrderId: string; workOrderNumber: string; itemCode: string; itemName: string; orderQty: string; goodQty: string; toolCode: string | null; hasInstructions: boolean }
interface Terminal { machine: Machine & { workCenterCode: string }; session: { operatorName: string; loginAt: string } | null; queue: QueueOp[]; running: { cardId: string; executionId: string | null } | null }
interface Prepared { operation: { id: string; name: string; seq: number; workOrderNumber: string; itemName: string; toolCode: string | null }; instruction: Instruction | null; recipe: { version: number; parameters: RecipeParameter[] } | null; required: { itemId: string; code: string; name: string }[] }

/** The operator's screen at a machine: log in, pick the next job, read and confirm the instructions, scan, check and start. */
export default function TerminalPage() {
  const machines = useQuery({ queryKey: ["/manufacturing/machines"], queryFn: () => api<Machine[]>("/manufacturing/machines") });
  const [machineId, setMachineId] = useState("");
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Machine terminal" description="For the tablet or PC at the machine." actions={<Select className="h-10 w-64" aria-label="Machine" value={machineId} onChange={(e) => setMachineId(e.target.value)}><option value="">Choose the machine…</option>{machines.data?.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</Select>} />
      {machineId ? <MachineTerminal key={machineId} machineId={machineId} /> : <p className="py-10 text-center text-muted">Choose the machine this screen is at.</p>}
    </div>
  );
}

function MachineTerminal({ machineId }: { machineId: string }) {
  const qc = useQueryClient();
  const t = useQuery({ queryKey: ["/mes/terminal", machineId], queryFn: () => api<Terminal>(`/mes/machines/${machineId}/terminal`), refetchInterval: 15000 });
  const [operator, setOperator] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/mes/terminal", machineId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  if (!t.data) return null;
  const { session, queue, running } = t.data;
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Card className="flex flex-wrap items-center gap-3 p-4">
        {session ? (
          <>
            <span className="text-lg">Logged in: <strong>{session.operatorName}</strong> <span className="text-sm text-muted">since {timeAgo(session.loginAt)}</span></span>
            <Button variant="ghost" className="ml-auto" onClick={() => act(() => api(`/mes/machines/${machineId}/logout`, { body: {} }))}><LogOut className="size-4" aria-hidden /> Log out</Button>
          </>
        ) : (
          <form className="flex w-full flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (operator.trim()) act(() => api(`/mes/machines/${machineId}/login`, { body: { operatorName: operator.trim() } })); }}>
            <Input className="h-12 flex-1 text-lg" aria-label="Operator name or badge" placeholder="Operator name or badge" value={operator} onChange={(e) => setOperator(e.target.value)} />
            <Button type="submit" className="h-12 px-6"><LogIn className="size-5" aria-hidden /> Log in</Button>
          </form>
        )}
      </Card>
      {running?.executionId ? (
        <RunningJob executionId={running.executionId} onDone={() => qc.invalidateQueries({ queryKey: ["/mes/terminal", machineId] })} />
      ) : running ? (
        <Alert tone="warning">A job card was started on this machine outside the terminal. Stop it from the shop-floor kiosk first.</Alert>
      ) : picked ? (
        <StartJob machineId={machineId} operationId={picked} operator={session?.operatorName ?? null} onCancel={() => setPicked(null)} onStarted={() => { setPicked(null); qc.invalidateQueries({ queryKey: ["/mes/terminal", machineId] }); }} />
      ) : (
        <Card>
          <CardHeader title={`Next jobs on ${t.data.machine.workCenterCode}`} />
          <ul className="divide-y divide-border border-t border-border">
            {queue.map((q) => (
              <li key={q.operationId}>
                <button type="button" className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted" onClick={() => setPicked(q.operationId)}>
                  <span className="font-mono text-sm">{q.workOrderNumber}</span>
                  <span className="text-lg font-medium">{q.itemName}</span>
                  <span className="text-muted">{q.seq} · {q.name}{q.toolCode ? ` · ${q.toolCode}` : ""}</span>
                  {!q.hasInstructions && <Badge tone="warning">no instructions</Badge>}
                  <span className="ml-auto tabular-nums">{Number(q.goodQty)} of {Number(q.orderQty)}</span>
                </button>
              </li>
            ))}
            {!queue.length && <li className="px-4 py-8 text-center text-muted">Nothing released for this work centre.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}

function CheckList({ checks }: { checks: StartCheck[] }) {
  return (
    <ul className="space-y-1">
      {checks.map((c, i) => (
        <li key={`${c.code}-${i}`} className={`flex items-start gap-2 rounded-lg px-3 py-2 ${c.ok ? "bg-success-soft" : c.blocking ? "bg-danger-soft" : "bg-warning-soft"}`}>
          {c.ok ? <Check className="mt-0.5 size-5 text-success" aria-hidden /> : c.blocking ? <X className="mt-0.5 size-5 text-danger" aria-hidden /> : <AlertTriangle className="mt-0.5 size-5 text-warning" aria-hidden />}
          <span><span className="font-medium">{c.label}</span>{c.detail && <span className="block text-sm">{c.detail}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

function StartJob({ machineId, operationId, operator, onCancel, onStarted }: { machineId: string; operationId: string; operator: string | null; onCancel: () => void; onStarted: () => void }) {
  const p = useQuery({ queryKey: ["/mes/jobs/prepare", operationId, machineId], queryFn: () => api<Prepared>("/mes/jobs/prepare", { query: { operationId, machineId } }) });
  const [acked, setAcked] = useState<number[]>([]);
  const [tool, setTool] = useState("");
  const [mats, setMats] = useState<{ code: string; batchNo: string }[]>([]);
  const [checks, setChecks] = useState<StartCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!p.data) return null;
  const { instruction, recipe, required, operation } = p.data;
  const body = () => ({ operationId, machineId, operatorName: operator, toolCode: tool || null, materials: mats.filter((m) => m.code.trim()).map((m) => ({ code: m.code.trim(), batchNo: m.batchNo.trim() || null })), stepsAcked: acked });
  async function run(start: boolean) {
    setError(null);
    setBusy(true);
    try {
      if (start) {
        await api("/mes/jobs/start", { body: body() });
        onStarted();
      } else setChecks((await api<{ checks: StartCheck[] }>("/mes/jobs/check", { body: body() })).checks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={`${operation.workOrderNumber} · ${operation.itemName} · ${operation.seq} ${operation.name}`} description={instruction ? `${instruction.title} (version ${instruction.version})` : "No released work instructions for this operation."} action={<Button variant="ghost" onClick={onCancel}>Back</Button>} />
        {instruction && (
          <ol className="space-y-2 border-t border-border p-4">
            {instruction.steps.map((s, i) => (
              <li key={i} className={`rounded-lg border p-3 ${s.caution ? "border-warning bg-warning-soft" : "border-border"}`}>
                <p className="text-lg font-medium">{i + 1}. {s.title}{s.caution && <AlertTriangle className="ml-2 inline size-5 text-warning" aria-label="Caution" />}</p>
                {s.body && <p className="whitespace-pre-line">{s.body}</p>}
                {/* eslint-disable-next-line @next/next/no-img-element -- pictures linked from the instruction */}
                {s.imageUrl && <img src={s.imageUrl} alt={s.title} className="mt-2 max-h-64 rounded border border-border" />}
                {s.confirm && (
                  <label className="mt-2 flex items-center gap-2 text-lg"><input type="checkbox" className="size-6" checked={acked.includes(i)} onChange={(e) => setAcked(e.target.checked ? [...acked, i] : acked.filter((x) => x !== i))} /> Done</label>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      {recipe && (
        <Card>
          <CardHeader title={`Recipe version ${recipe.version}`} description="Values with a PLC address are sent to the machine when the job starts; set the others by hand." />
          <ul className="grid gap-2 border-t border-border p-4 sm:grid-cols-2">
            {recipe.parameters.map((r) => <li key={r.name} className="flex justify-between rounded border border-border px-3 py-2"><span>{r.name}{r.target ? "" : " (by hand)"}</span><span className="font-semibold tabular-nums">{r.value} {r.unit ?? ""}</span></li>)}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title="Scan" />
        <div className="space-y-3 border-t border-border p-4">
          {operation.toolCode && <Input className="h-12 text-lg" aria-label="Tool" placeholder={`Scan the tool (${operation.toolCode})`} value={tool} onChange={(e) => setTool(e.target.value)} />}
          {(instruction?.scanMaterials || mats.length > 0) && <p className="text-sm text-muted">Materials for this operation: {required.map((r) => `${r.code} ${r.name}`).join(", ") || "none"}</p>}
          {mats.map((m, i) => (
            <div key={i} className="flex gap-2">
              <Input className="h-11 flex-1" aria-label="Material code" placeholder="Item code" value={m.code} onChange={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
              <Input className="h-11 w-40" aria-label="Batch" placeholder="Batch" value={m.batchNo} onChange={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, batchNo: e.target.value } : x)))} />
              <Button variant="ghost" onClick={() => setMats(mats.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
          <Button variant="secondary" onClick={() => setMats([...mats, { code: "", batchNo: "" }])}>Add material scan</Button>
        </div>
      </Card>
      {error && <Alert>{error}</Alert>}
      {checks && <CheckList checks={checks} />}
      <div className="flex gap-2">
        <Button variant="secondary" className="h-14 flex-1 text-lg" loading={busy} onClick={() => run(false)}>Check</Button>
        <Button className="h-14 flex-1 text-lg" loading={busy} onClick={() => run(true)}><Play className="size-5" aria-hidden /> Start{operator ? ` as ${operator}` : ""}</Button>
      </div>
    </div>
  );
}

function RunningJob({ executionId, onDone }: { executionId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const x = useQuery({ queryKey: ["/mes/executions", executionId], queryFn: () => api<Execution>(`/mes/executions/${executionId}`), refetchInterval: 10000 });
  const [values, setValues] = useState<Record<string, string>>({});
  const [good, setGood] = useState<string | null>(null);
  const [reject, setReject] = useState("0");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>, after?: () => void) {
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/mes/executions", executionId] });
      after?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const e = x.data;
  if (!e) return null;
  const chars = e.instruction?.characteristics ?? [];
  const readings = () => chars.filter((c) => values[c.name] !== undefined && values[c.name] !== "").map((c) => ({ name: c.name, value: Number(values[c.name]) }));
  const [foLabel, foTone] = FIRST_OFF[e.firstOff.status];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={`Running: ${e.jobCard.workOrderNumber} · ${e.jobCard.itemName} · ${e.jobCard.operation}`} description={`${e.operatorName ?? "–"} · started ${timeAgo(e.jobCard.startedAt)} · ${e.jobCard.goodQty} good, ${e.jobCard.rejectQty} rejected so far`} action={<Link className="text-sm text-primary hover:underline" href={`/print/batch-record/${e.id}`}>Batch record</Link>} />
        <div className="flex flex-wrap gap-3 border-t border-border p-4">
          <Badge tone={foTone}>First-off: {foLabel}</Badge>
          {e.recipe?.download && <Badge tone={e.recipe.download.status === "done" ? "success" : e.recipe.download.status === "failed" ? "danger" : "warning"}>Recipe {e.recipe.download.status === "done" ? "sent to the machine" : e.recipe.download.status}</Badge>}
          {e.checksDue.length > 0 && <Badge tone="danger">Check due: {e.checksDue.join(", ")}</Badge>}
        </div>
      </Card>
      {error && <Alert>{error}</Alert>}
      {chars.length > 0 && (
        <Card>
          <CardHeader title={e.firstOff.status === "pending" || e.firstOff.status === "rejected" ? "First-off piece" : "In-line check"} description={chars.map((c) => `${c.name}${c.unit ? ` (${c.unit})` : ""}: ${c.min ?? "–"} to ${c.max ?? "–"}${c.everyMinutes ? `, every ${c.everyMinutes} min` : ""}`).join(" · ")} />
          <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
            {chars.map((c) => <label key={c.name} className="flex flex-col text-sm">{c.name}<Input className="h-12 w-32 text-lg" type="number" step="any" value={values[c.name] ?? ""} onChange={(ev) => setValues({ ...values, [c.name]: ev.target.value })} /></label>)}
            {e.firstOff.status === "pending" || e.firstOff.status === "rejected" ? (
              can("mes.firstoff.approve") ? (
                <span className="flex gap-2">
                  <Button className="h-12" onClick={() => act(() => api(`/mes/executions/${e.id}/first-off`, { body: { approved: true, readings: readings() } }), () => setValues({}))}>Approve first-off</Button>
                  <Button variant="danger" className="h-12" onClick={() => act(() => api(`/mes/executions/${e.id}/first-off`, { body: { approved: false, readings: readings(), note: window.prompt("Why is it rejected?") } }))}>Reject</Button>
                </span>
              ) : (
                <p className="text-muted">Waiting for quality to approve the first piece.</p>
              )
            ) : (
              <Button className="h-12" disabled={!readings().length} onClick={() => act(() => api(`/mes/executions/${e.id}/inline`, { body: { readings: readings() } }), () => setValues({}))}>Record check</Button>
            )}
          </div>
          {e.inlineChecks.length > 0 && <p className="border-t border-border px-4 py-2 text-xs text-muted">Last check {timeAgo(e.inlineChecks[e.inlineChecks.length - 1].at)}: {e.inlineChecks[e.inlineChecks.length - 1].readings.map((r) => `${r.name} ${r.value}${r.ok ? "" : " ✗"}`).join(", ")}</p>}
        </Card>
      )}
      <Card>
        <CardHeader title="Stop the job" description="Good pieces start from the machine's count; correct them if needed." />
        <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
          <label className="flex flex-col text-sm">Good<Input className="h-12 w-32 text-lg" type="number" min={0} value={good ?? String(e.jobCard.goodQty)} onChange={(ev) => setGood(ev.target.value)} /></label>
          <label className="flex flex-col text-sm">Rejected<Input className="h-12 w-32 text-lg" type="number" min={0} value={reject} onChange={(ev) => setReject(ev.target.value)} /></label>
          {Number(reject) > 0 && <label className="flex flex-1 flex-col text-sm">Why rejected<Input className="h-12" value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>}
          <Button className="h-12" variant="danger" onClick={() => act(() => api(`/manufacturing/job-cards/${e.jobCard.id}/stop`, { body: { goodQty: good ?? String(e.jobCard.goodQty), rejectQty: reject || "0", rejectReason: Number(reject) ? reason : null } }), onDone)}><Square className="size-5" aria-hidden /> Stop</Button>
        </div>
      </Card>
    </div>
  );
}
