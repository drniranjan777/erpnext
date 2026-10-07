"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { formatDate } from "@/lib/documents";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Checklist { id: string; area: string; questions: string[] }
interface Summary { byLayer: { layer: number; audits: number; compliancePct: number | null; findings: number }[]; findings: { area: string; layer: number; date: string; question: string; note: string | null; fixedOnSpot: boolean }[] }

const LAYER = ["", "Layer 1 · supervisors, daily", "Layer 2 · managers, weekly", "Layer 3 · plant head, monthly"];

/** Layered process audits: short checklists audited at three management layers. */
export default function LpaPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const audit = can("auto.lpa.audit");
  const lists = useQuery({ queryKey: ["/auto/lpa/checklists"], queryFn: () => api<Checklist[]>("/auto/lpa/checklists") });
  const sum = useQuery({ queryKey: ["/auto/lpa/summary"], queryFn: () => api<Summary>("/auto/lpa/summary") });
  const [pick, setPick] = useState("");
  const [layer, setLayer] = useState("1");
  const [answers, setAnswers] = useState<Record<string, { answer: string; note: string; fixed: boolean }>>({});
  const [newList, setNewList] = useState({ area: "", questions: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const c = lists.data?.find((x) => x.id === pick);
  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/auto/lpa"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Layered process audits" description="The same short checklist is audited by supervisors daily, managers weekly and the plant head monthly. Every finding is described; fix it on the spot where possible." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {sum.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {sum.data.byLayer.map((l) => <Card key={l.layer} className="p-4 text-sm"><p className="text-muted">{LAYER[l.layer]}</p><p className="text-2xl font-semibold">{l.compliancePct === null ? "–" : `${l.compliancePct} %`}</p><p className="text-xs">{l.audits} audit(s) in 30 days · {l.findings} finding(s)</p></Card>)}
        </div>
      )}
      {audit && (
        <Card>
          <CardHeader title="Audit now" />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Select className="h-9 w-64" aria-label="Checklist" value={pick} onChange={(e) => { setPick(e.target.value); setAnswers({}); }}><option value="">Area…</option>{lists.data?.map((l) => <option key={l.id} value={l.id}>{l.area}</option>)}</Select>
              <Select className="h-9 w-64" aria-label="Layer" value={layer} onChange={(e) => setLayer(e.target.value)}>{[1, 2, 3].map((l) => <option key={l} value={l}>{LAYER[l]}</option>)}</Select>
            </div>
            {c?.questions.map((q) => {
              const a = answers[q] ?? { answer: "yes", note: "", fixed: false };
              return (
                <div key={q} className="flex flex-wrap items-center gap-2 rounded border border-border p-2">
                  <span className="flex-1">{q}</span>
                  {(["yes", "no", "na"] as const).map((v) => <label key={v} className="flex items-center gap-1"><input type="radio" name={q} checked={a.answer === v} onChange={() => setAnswers({ ...answers, [q]: { ...a, answer: v } })} /> {v.toUpperCase()}</label>)}
                  {a.answer === "no" && <><Input className="h-8 w-60" aria-label="Finding" placeholder="What was found" value={a.note} onChange={(e) => setAnswers({ ...answers, [q]: { ...a, note: e.target.value } })} /><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.fixed} onChange={(e) => setAnswers({ ...answers, [q]: { ...a, fixed: e.target.checked } })} /> fixed on the spot</label></>}
                </div>
              );
            })}
            {c && <Button onClick={() => run(() => api("/auto/lpa/audits", { body: { checklistId: c.id, layer: Number(layer), answers: c.questions.map((q) => { const a = answers[q] ?? { answer: "yes", note: "", fixed: false }; return { question: q, answer: a.answer, note: a.note || null, fixedOnSpot: a.fixed }; }) } }), "Audit recorded.")}>Record audit</Button>}
          </div>
        </Card>
      )}
      <Card>
        <CardHeader title="Findings (30 days)" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {sum.data?.findings.map((x, i) => <li key={i} className="flex flex-wrap gap-2 px-4 py-1.5"><Badge tone={x.fixedOnSpot ? "success" : "danger"}>{x.fixedOnSpot ? "fixed" : "open"}</Badge><span>{x.area} · L{x.layer} · {formatDate(x.date)}</span><span className="flex-1">{x.question}: {x.note}</span></li>)}
          {sum.data && !sum.data.findings.length && <li className="px-4 py-4 text-center text-muted">No findings.</li>}
        </ul>
      </Card>
      {audit && (
        <Card>
          <CardHeader title="New checklist" />
          <div className="space-y-2 border-t border-border p-4 text-sm">
            <Input aria-label="Area" placeholder="Area" value={newList.area} onChange={(e) => setNewList({ ...newList, area: e.target.value })} />
            <textarea aria-label="Questions" rows={4} className="w-full rounded-lg border border-border bg-surface px-3 py-2" placeholder="One question per line" value={newList.questions} onChange={(e) => setNewList({ ...newList, questions: e.target.value })} />
            <Button size="sm" disabled={!newList.area || !newList.questions.trim()} onClick={() => run(() => api("/auto/lpa/checklists", { body: { area: newList.area, questions: newList.questions.split("\n").map((x) => x.trim()).filter(Boolean) } }), "Checklist added.").then(() => setNewList({ area: "", questions: "" }))}>Add checklist</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
