"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, FileSignature, Plus, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { HR } from "@/lib/hr";
import { inr, PAY, type SalaryTemplate } from "@/lib/payroll";
import { REQ_TONE, STAGE_TONE, type Candidate, type Requisition } from "@/lib/talent";

type Dlg = { kind: "candidate" } | { kind: "interview"; c: Candidate } | { kind: "feedback"; interviewId: string } | { kind: "offer"; c: Candidate } | { kind: "accept"; c: Candidate } | null;

export default function RequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [HR, "requisitions", id], queryFn: () => api<Requisition & { candidates: Candidate[] }>(`${HR}/recruitment/requisitions/${id}`) });
  const [dlg, setDlg] = useState<Dlg>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: [HR, "requisitions"] });
  async function act(path: string, body: unknown = {}) {
    setError(null);
    try {
      await api(path, { body });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const r = q.data!;
  const manage = can("hr.recruitment.manage");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={r.title}
        description={`${r.number} · ${[r.designation, r.department, r.location].filter(Boolean).join(" · ")} · ${r.openings} opening(s)${r.maxCtc ? ` · budget ${inr(r.maxCtc)}` : ""}`}
        actions={
          <span className="flex gap-2">
            {manage && r.status === "approved" && <Button onClick={() => setDlg({ kind: "candidate" })}><Plus className="size-4" aria-hidden /> Add candidate</Button>}
            {manage && r.status === "approved" && <Button variant="ghost" onClick={() => window.confirm("Close this requisition?") && act(`${HR}/recruitment/requisitions/${r.id}/close`)}>Close</Button>}
          </span>
        }
      />
      <Badge tone={REQ_TONE[r.status]}>{r.status === "approved" ? "open" : r.status}</Badge>
      {r.description && <p className="text-sm text-muted">{r.description}</p>}
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="space-y-3">
        {r.candidates.map((c) => (
          <Card key={c.id}>
            <CardHeader
              title={c.name}
              description={[c.email, c.mobile, c.source, c.expectedCtc && `expects ${inr(c.expectedCtc)}`, c.noticeDays !== null && `${c.noticeDays} days' notice`].filter(Boolean).join(" · ")}
              action={<Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge>}
            />
            <div className="space-y-2 border-t border-border px-5 py-3 text-sm">
              {c.interviews?.map((i) => (
                <p key={i.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Round {i.round}</span>
                  <span className="text-muted">{new Date(i.scheduledAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} · {i.mode.replace("_", " ")}{i.interviewer && ` · ${i.interviewer}`}</span>
                  <Badge tone={i.result === "selected" ? "success" : i.result === "rejected" ? "danger" : "neutral"}>{i.result}{i.score ? ` ${i.score}/5` : ""}</Badge>
                  {i.feedback && <span className="text-xs text-muted">“{i.feedback}”</span>}
                  {i.result === "pending" && <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: "feedback", interviewId: i.id })}>Feedback</Button>}
                </p>
              ))}
              {c.offer && (
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Offer</span>
                  <span>{inr(c.offer.ctcAnnual)} a year, joining {formatDate(c.offer.joiningDate)}</span>
                  <Badge tone={c.offer.status === "accepted" ? "success" : c.offer.status === "approved" ? "primary" : c.offer.status === "pending" ? "warning" : "neutral"}>{c.offer.status}</Badge>
                  {c.offer.status === "pending" && can("hr.recruitment.approve") && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => act(`${HR}/recruitment/offers/${c.offer!.id}/decide`, { approve: true })}><Check className="size-3.5" aria-hidden /> Approve</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(`${HR}/recruitment/offers/${c.offer!.id}/decide`, { approve: false })}><X className="size-3.5" aria-hidden /> Reject</Button>
                    </>
                  )}
                  {manage && c.offer.status === "approved" && (
                    <>
                      <Button size="sm" onClick={() => setDlg({ kind: "accept", c })}><UserCheck className="size-3.5" aria-hidden /> Accepted: hire</Button>
                      <Button size="sm" variant="ghost" onClick={() => act(`${HR}/recruitment/offers/${c.offer!.id}/respond`, { answer: "declined" })}>Declined</Button>
                    </>
                  )}
                  {manage && ["pending", "approved"].includes(c.offer.status) && <Button size="sm" variant="ghost" onClick={() => act(`${HR}/recruitment/offers/${c.offer!.id}/respond`, { answer: "withdrawn" })}>Withdraw</Button>}
                </p>
              )}
              {c.employeeId && <Link className="text-primary hover:underline" href={`${HR}/employees/${c.employeeId}`}>Employee record</Link>}
              {manage && !["hired", "rejected", "withdrawn"].includes(c.stage) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "interview", c })}><CalendarPlus className="size-3.5" aria-hidden /> Schedule interview</Button>
                  {(!c.offer || !["pending", "approved", "accepted"].includes(c.offer.status)) && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "offer", c })}><FileSignature className="size-3.5" aria-hidden /> Make offer</Button>}
                  <Button size="sm" variant="ghost" onClick={() => act(`${HR}/recruitment/candidates/${c.id}/stage`, { stage: "rejected" })}>Reject</Button>
                </div>
              )}
            </div>
          </Card>
        ))}
        {!r.candidates.length && <p className="text-sm text-muted">No candidates yet.</p>}
      </div>
      {dlg?.kind === "candidate" && <CandidateDialog requisitionId={r.id} onClose={() => setDlg(null)} onDone={() => { setDlg(null); refresh(); }} />}
      {dlg?.kind === "interview" && <InterviewDialog c={dlg.c} onClose={() => setDlg(null)} onDone={() => { setDlg(null); refresh(); }} />}
      {dlg?.kind === "feedback" && <FeedbackDialog interviewId={dlg.interviewId} onClose={() => setDlg(null)} onDone={() => { setDlg(null); refresh(); }} />}
      {dlg?.kind === "offer" && <OfferDialog c={dlg.c} maxCtc={r.maxCtc} onClose={() => setDlg(null)} onDone={() => { setDlg(null); refresh(); }} />}
      {dlg?.kind === "accept" && <AcceptDialog c={dlg.c} onClose={() => setDlg(null)} onDone={(code) => { setDlg(null); setNotice(`Hired as ${code}. Onboarding tasks are on the People → Onboarding & exit page.`); refresh(); }} />}
    </div>
  );
}

function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  async function submit<T>(path: string, body: unknown): Promise<T | null> {
    setError(null);
    try {
      return await api<T>(path, { body });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
      return null;
    }
  }
  return { error, submit };
}

function CandidateDialog({ requisitionId, onClose, onDone }: { requisitionId: string; onClose: () => void; onDone: () => void }) {
  const { error, submit } = useSubmit();
  const [f, setF] = useState({ name: "", email: "", mobile: "", source: "", currentCtc: "", expectedCtc: "", noticeDays: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => (v ? Number(v) : null);
  return (
    <Dialog open onClose={onClose} title="Add candidate" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => (await submit(`${HR}/recruitment/candidates`, { requisitionId, name: f.name, email: f.email || null, mobile: f.mobile || null, source: f.source || null, currentCtc: n(f.currentCtc), expectedCtc: n(f.expectedCtc), noticeDays: n(f.noticeDays) })) && onDone()}>Add</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        <Field label="Source">{(p) => <Input {...p} placeholder="Referral, portal, campus…" value={f.source} onChange={set("source")} />}</Field>
        <Field label="Email">{(p) => <Input {...p} type="email" value={f.email} onChange={set("email")} />}</Field>
        <Field label="Mobile">{(p) => <Input {...p} inputMode="numeric" value={f.mobile} onChange={set("mobile")} />}</Field>
        <Field label="Current CTC">{(p) => <Input {...p} inputMode="decimal" value={f.currentCtc} onChange={set("currentCtc")} />}</Field>
        <Field label="Expected CTC">{(p) => <Input {...p} inputMode="decimal" value={f.expectedCtc} onChange={set("expectedCtc")} />}</Field>
        <Field label="Notice period (days)">{(p) => <Input {...p} type="number" value={f.noticeDays} onChange={set("noticeDays")} />}</Field>
      </div>
    </Dialog>
  );
}

function InterviewDialog({ c, onClose, onDone }: { c: Candidate; onClose: () => void; onDone: () => void }) {
  const { error, submit } = useSubmit();
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`) });
  const [f, setF] = useState({ round: String((c.interviews?.length ?? 0) + 1), date: todayIST(), time: "11:00", interviewerId: "", mode: "in_person" });
  return (
    <Dialog open onClose={onClose} title={`Interview: ${c.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => (await submit(`${HR}/recruitment/candidates/${c.id}/interviews`, { round: Number(f.round), scheduledAt: `${f.date}T${f.time}:00+05:30`, interviewerId: f.interviewerId || null, mode: f.mode })) && onDone()}>Schedule</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Round">{(p) => <Input {...p} type="number" min={1} value={f.round} onChange={(e) => setF({ ...f, round: e.target.value })} />}</Field>
        <Field label="Mode">{(p) => <Select {...p} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="in_person">In person</option><option value="phone">Phone</option><option value="video">Video</option></Select>}</Field>
        <Field label="Date">{(p) => <Input {...p} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Time">{(p) => <Input {...p} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
        <Field label="Interviewer" className="sm:col-span-2" hint="They can give feedback from their own login">{(p) => <Select {...p} value={f.interviewerId} onChange={(e) => setF({ ...f, interviewerId: e.target.value })}><option value="">—</option>{people.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>
      </div>
    </Dialog>
  );
}

function FeedbackDialog({ interviewId, onClose, onDone }: { interviewId: string; onClose: () => void; onDone: () => void }) {
  const { error, submit } = useSubmit();
  const [f, setF] = useState({ result: "selected", score: "3", feedback: "" });
  return (
    <Dialog open onClose={onClose} title="Interview feedback" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={f.feedback.trim().length < 3} onClick={async () => (await submit(`${HR}/recruitment/interviews/${interviewId}/feedback`, { result: f.result, score: Number(f.score), feedback: f.feedback })) && onDone()}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Result">{(p) => <Select {...p} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })}><option value="selected">Selected</option><option value="hold">On hold</option><option value="rejected">Rejected</option></Select>}</Field>
        <Field label="Score (1–5)">{(p) => <Select {...p} value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select>}</Field>
        <Field label="Feedback" className="sm:col-span-2">{(p) => <Input {...p} value={f.feedback} onChange={(e) => setF({ ...f, feedback: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function OfferDialog({ c, maxCtc, onClose, onDone }: { c: Candidate; maxCtc: string | null; onClose: () => void; onDone: () => void }) {
  const { error, submit } = useSubmit();
  const templates = useQuery({ queryKey: [PAY, "templates"], queryFn: () => api<SalaryTemplate[]>(`${PAY}/templates`), retry: false });
  const letters = useQuery({ queryKey: [HR, "templates"], queryFn: () => api<{ id: string; name: string; kind: string; isActive: boolean }[]>(`${HR}/letter-templates`) });
  const [f, setF] = useState({ ctcAnnual: c.expectedCtc ? String(Number(c.expectedCtc)) : "", joiningDate: todayIST(), salaryTemplateId: "", letterTemplateId: "" });
  const over = maxCtc && Number(f.ctcAnnual) > Number(maxCtc);
  return (
    <Dialog open onClose={onClose} title={`Offer: ${c.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!Number(f.ctcAnnual)} onClick={async () => (await submit(`${HR}/recruitment/offers`, { candidateId: c.id, ctcAnnual: Number(f.ctcAnnual), joiningDate: f.joiningDate, salaryTemplateId: f.salaryTemplateId || null, letterTemplateId: f.letterTemplateId || null })) && onDone()}>Make offer</Button></>}>
      {error && <Alert>{error}</Alert>}
      {over && <Alert tone="warning">Above the requisition budget of {inr(maxCtc)}: the offer needs approval.</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="CTC a year (₹)">{(p) => <Input {...p} inputMode="decimal" value={f.ctcAnnual} onChange={(e) => setF({ ...f, ctcAnnual: e.target.value })} />}</Field>
        <Field label="Joining date">{(p) => <Input {...p} type="date" value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} />}</Field>
        <Field label="Salary template" hint="Sets their salary when hired">{(p) => <Select {...p} value={f.salaryTemplateId} onChange={(e) => setF({ ...f, salaryTemplateId: e.target.value })}><option value="">—</option>{templates.data?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
        <Field label="Offer letter">{(p) => <Select {...p} value={f.letterTemplateId} onChange={(e) => setF({ ...f, letterTemplateId: e.target.value })}><option value="">—</option>{letters.data?.filter((t) => t.isActive && t.kind === "offer").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
      </div>
    </Dialog>
  );
}

function AcceptDialog({ c, onClose, onDone }: { c: Candidate; onClose: () => void; onDone: (code: string) => void }) {
  const { error, submit } = useSubmit();
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`) });
  const [f, setF] = useState({ joiningDate: c.offer?.joiningDate ?? todayIST(), employmentType: "probation", category: "staff", reportsToId: "", probationMonths: "6" });
  return (
    <Dialog open onClose={onClose} title={`Hire ${c.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => { const r = await submit<{ code: string }>(`${HR}/recruitment/offers/${c.offer!.id}/accept`, { ...f, reportsToId: f.reportsToId || null, probationMonths: Number(f.probationMonths) }); if (r) onDone(r.code); }}>Hire</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Joining date">{(p) => <Input {...p} type="date" value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} />}</Field>
        <Field label="Category">{(p) => <Select {...p} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="staff">Staff</option><option value="worker">Worker</option><option value="management">Management</option></Select>}</Field>
        <Field label="Employment">{(p) => <Select {...p} value={f.employmentType} onChange={(e) => setF({ ...f, employmentType: e.target.value })}><option value="probation">Probation</option><option value="permanent">Permanent</option><option value="contract">Contract</option><option value="trainee">Trainee</option><option value="apprentice">Apprentice</option></Select>}</Field>
        {f.employmentType === "probation" && <Field label="Probation (months)">{(p) => <Input {...p} type="number" value={f.probationMonths} onChange={(e) => setF({ ...f, probationMonths: e.target.value })} />}</Field>}
        <Field label="Reports to" className="sm:col-span-2">{(p) => <Select {...p} value={f.reportsToId} onChange={(e) => setF({ ...f, reportsToId: e.target.value })}><option value="">—</option>{people.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>
      </div>
      <p className="mt-3 text-xs text-muted">Creates the employee record (complete PAN, bank and the rest on their profile), their salary from the offer, and the onboarding checklist.</p>
    </Dialog>
  );
}
