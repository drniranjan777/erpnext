"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, BadgeCheck, Eye, FileText, LogOut, Pencil, Upload } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { Info } from "@/components/documents/doc-page";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, apiDownload, ApiError, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, todayIST } from "@/lib/documents";
import { EVENT_LABEL, HR, STATUS_TONE, type Employee, type OrgRow } from "@/lib/hr";

type Tab = "profile" | "record" | "documents";

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const key = [HR, "employees", id];
  const q = useQuery({ queryKey: key, queryFn: () => api<Employee>(`${HR}/employees/${id}`) });
  const [tab, setTab] = useState<Tab>("profile");
  const [dialog, setDialog] = useState<"move" | "exit" | "letter" | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const e = q.data!;
  const refresh = () => qc.invalidateQueries({ queryKey: [HR] });
  async function reveal(field: "pan" | "aadhaar" | "bankAccount") {
    try {
      const r = await api<{ value: string | null }>(`${HR}/employees/${e.id}/reveal`, { body: { field } });
      setShown({ ...shown, [field]: r.value ?? "–" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  async function confirm() {
    try {
      await api(`${HR}/employees/${e.id}/confirm`, { body: {} });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const secret = (field: "pan" | "aadhaar" | "bankAccount", masked: string | null, has: boolean) => (
    <span className="inline-flex items-center gap-2 font-mono">
      {shown[field] ?? (has ? masked : "–")}
      {has && e.canSeeSensitive && !shown[field] && <Button size="sm" variant="ghost" className="h-6 px-1" aria-label={`Show ${field}`} onClick={() => reveal(field)}><Eye className="size-3.5" aria-hidden /></Button>}
    </span>
  );
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={e.fullName}
        description={`${e.code} · ${e.designation ?? "No designation"}${e.department ? `, ${e.department}` : ""}${e.location ? ` · ${e.location}` : ""}`}
        actions={
          e.canManage && (
            <span className="flex flex-wrap gap-2">
              <Link href={`${HR}/employees/${e.id}/edit`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"><Pencil className="size-4" aria-hidden /> Edit</Link>
              <Button variant="secondary" onClick={() => setDialog("move")}><ArrowRightLeft className="size-4" aria-hidden /> Transfer / promote</Button>
              {e.employmentType === "probation" && !e.confirmedOn && <Button variant="secondary" onClick={confirm}><BadgeCheck className="size-4" aria-hidden /> Confirm</Button>}
              {can("hr.letters.manage") && <Button variant="secondary" onClick={() => setDialog("letter")}><FileText className="size-4" aria-hidden /> Issue letter</Button>}
              {e.status === "active" && <Button variant="ghost" onClick={() => setDialog("exit")}><LogOut className="size-4" aria-hidden /> Record exit</Button>}
            </span>
          )
        }
      />
      <div className="flex flex-wrap gap-2"><Badge tone={STATUS_TONE[e.status]}>{e.status === "notice" ? `On notice until ${formatDate(e.exitDate!)}` : e.status}</Badge><Badge>{e.category}</Badge><Badge>{e.employmentType}</Badge>{e.login && <Badge tone="primary">Login: {e.login}</Badge>}</div>
      {error && <Alert>{error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "profile", label: "Profile" }, { value: "record", label: "Service record", count: e.events.length }, { value: "documents", label: "Documents & letters", count: e.documents.length + e.letters.length }]} />
      {tab === "profile" && (
        <>
          <Card>
            <CardHeader title="Job" />
            <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-4">
              <Info label="Joined" value={formatDate(e.dateOfJoining)} />
              <Info label="Confirmed" value={e.confirmedOn ? formatDate(e.confirmedOn) : e.probationEnd ? `Probation to ${formatDate(e.probationEnd)}` : "–"} />
              <Info label="Grade" value={e.grade ?? "–"} />
              <Info label="Reports to" value={e.reportsToId ? <Link className="text-primary hover:underline" href={`${HR}/employees/${e.reportsToId}`}>{e.manager}</Link> : "–"} />
              {e.reports.length > 0 && <Info label="Team" value={e.reports.map((r) => <Link key={r.id} className="mr-2 text-primary hover:underline" href={`${HR}/employees/${r.id}`}>{r.fullName}</Link>)} />}
              <Info label="Notice period" value={`${e.noticeDays} days`} />
              <Info label="Work email" value={e.workEmail ?? "–"} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Personal" />
            <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-4">
              <Info label="Date of birth" value={e.dateOfBirth ? formatDate(e.dateOfBirth) : "–"} />
              <Info label="Gender" value={e.gender ?? "–"} />
              <Info label="Mobile" value={e.mobile ?? "–"} />
              <Info label="Father / spouse" value={e.fatherOrSpouseName ?? "–"} />
              <Info label="Address" value={[e.currentAddress.line1, e.currentAddress.city, e.currentAddress.pincode].filter(Boolean).join(", ") || "–"} />
              <Info label="Emergency" value={e.emergencyContact ? `${e.emergencyContact} ${e.emergencyPhone ?? ""}` : "–"} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Statutory and bank" description={e.canSeeSensitive ? "Showing a full number is recorded in the audit log." : undefined} />
            <dl className="grid gap-4 border-t border-border px-5 py-4 text-sm sm:grid-cols-4">
              <Info label="PAN" value={secret("pan", e.panMasked, e.hasPan)} />
              <Info label="Aadhaar" value={secret("aadhaar", e.aadhaarLast4 ? `XXXX XXXX ${e.aadhaarLast4}` : null, e.hasAadhaar)} />
              <Info label="UAN" value={e.uan ?? "–"} mono />
              <Info label="ESIC" value={e.esicNumber ?? "–"} mono />
              <Info label="Bank" value={e.bankName ?? "–"} />
              <Info label="Account" value={secret("bankAccount", e.bankAccountLast4 ? `••${e.bankAccountLast4}` : null, e.hasBankAccount)} />
              <Info label="IFSC" value={e.ifsc ?? "–"} mono />
              <Info label="Payroll" value={[e.pfApplicable && "PF", e.esiApplicable && "ESI", e.ptApplicable && "PT", e.lwfApplicable && "LWF"].filter(Boolean).join(" · ") + ` · ${e.taxRegime} regime`} />
            </dl>
          </Card>
          {e.family.length > 0 && (
            <Card>
              <CardHeader title="Family and nominees" />
              <ul className="divide-y divide-border border-t border-border text-sm">
                {e.family.map((m, i) => <li key={i} className="flex flex-wrap gap-3 px-5 py-2"><span className="font-medium">{m.name}</span><span className="text-muted">{m.relation}{m.dateOfBirth && ` · born ${formatDate(m.dateOfBirth)}`}{m.isDependent && " · dependent"}</span>{m.nomineeFor.length > 0 && <Badge tone="primary">Nominee {m.nomineeFor.join(", ").toUpperCase()} {Number(m.nomineeSharePct)}%</Badge>}</li>)}
              </ul>
            </Card>
          )}
        </>
      )}
      {tab === "record" && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {e.events.map((v) => (
              <li key={v.id} className="px-5 py-3">
                <p className="flex flex-wrap items-center gap-2"><Badge>{EVENT_LABEL[v.kind] ?? v.kind}</Badge><span className="font-medium">{formatDate(v.effectiveDate)}</span>{v.remarks && <span className="text-muted">{v.remarks}</span>}</p>
                {Object.keys(v.to).length > 0 && <p className="mt-1 text-xs text-muted">{Object.entries(v.to).map(([k, to]) => `${k}: ${v.from[k] ? `${v.from[k]} → ` : ""}${to}`).join(" · ")}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tab === "documents" && <Documents e={e} onChange={refresh} />}
      {dialog === "move" && <MoveDialog e={e} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === "exit" && <ExitDialog e={e} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />}
      {dialog === "letter" && <LetterDialog e={e} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); setTab("documents"); }} />}
    </div>
  );
}

function Documents({ e, onChange }: { e: Employee; onChange: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ kind: "id_proof", title: "" });
  const [error, setError] = useState<string | null>(null);
  async function upload() {
    const picked = file.current?.files?.[0];
    if (!picked) return setError("Choose a file");
    setError(null);
    try {
      await apiUpload(`${HR}/employees/${e.id}/documents`, picked, { kind: f.kind, title: f.title || picked.name });
    } catch (err) {
      return setError(err instanceof ApiError ? err.message : "Upload failed");
    }
    if (file.current) file.current.value = "";
    setF({ ...f, title: "" });
    onChange();
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Documents" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {e.documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-2">
              <Badge>{d.kind.replace("_", " ")}</Badge>
              <button className="text-primary hover:underline" onClick={() => apiDownload(`${HR}/employees/${e.id}/documents/${d.id}`, d.fileName)}>{d.title}</button>
              {d.expiryDate && <span className="text-xs text-muted">expires {formatDate(d.expiryDate)}</span>}
            </li>
          ))}
          {!e.documents.length && <li className="px-5 py-3 text-muted">No documents.</li>}
        </ul>
        {e.canManage && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-4">
            {error && <Alert>{error}</Alert>}
            <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(ev) => setF({ ...f, kind: ev.target.value })}>{["id_proof", "address_proof", "education", "experience", "offer", "appointment", "medical", "other"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</Select>}</Field>
            <Field label="Title">{(p) => <Input {...p} value={f.title} onChange={(ev) => setF({ ...f, title: ev.target.value })} />}</Field>
            <input ref={file} type="file" accept="application/pdf,image/*" aria-label="File" className="text-sm" />
            <Button size="sm" onClick={upload}><Upload className="size-4" aria-hidden /> Upload</Button>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Letters" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {e.letters.map((l) => <li key={l.id} className="flex items-center gap-3 px-5 py-2"><Badge>{l.kind}</Badge><Link className="text-primary hover:underline" href={`/print/letters/${l.id}`} target="_blank">{l.title}</Link><span className="text-xs text-muted">{formatDate(l.issuedOn)}</span></li>)}
          {!e.letters.length && <li className="px-5 py-3 text-muted">No letters issued.</li>}
        </ul>
      </Card>
    </div>
  );
}

function MoveDialog({ e, onClose, onDone }: { e: Employee; onClose: () => void; onDone: () => void }) {
  const opt = (kind: string) => ({ queryKey: [HR, "org", kind], queryFn: () => api<OrgRow[]>(`${HR}/org/${kind}`) });
  const depts = useQuery(opt("departments"));
  const desigs = useQuery(opt("designations"));
  const grades = useQuery(opt("grades"));
  const locs = useQuery(opt("locations"));
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`) });
  const [f, setF] = useState({ kind: "transfer", effectiveDate: todayIST(), departmentId: e.departmentId ?? "", designationId: e.designationId ?? "", gradeId: e.gradeId ?? "", locationId: e.locationId ?? "", reportsToId: e.reportsToId ?? "", remarks: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    const body: Record<string, unknown> = { kind: f.kind, effectiveDate: f.effectiveDate, remarks: f.remarks || null };
    for (const k of ["departmentId", "designationId", "gradeId", "locationId", "reportsToId"] as const) if ((f[k] || null) !== (e[k] ?? null)) body[k] = f[k] || null;
    try {
      await api(`${HR}/employees/${e.id}/move`, { body });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const sel = (label: string, k: "departmentId" | "designationId" | "gradeId" | "locationId", rows: OrgRow[] | undefined) => <Field label={label}>{(p) => <Select {...p} value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })}><option value="">—</option>{rows?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>;
  return (
    <Dialog open onClose={onClose} title="Transfer or promote" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Record</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What">{(p) => <Select {...p} value={f.kind} onChange={(ev) => setF({ ...f, kind: ev.target.value })}><option value="transfer">Transfer</option><option value="promotion">Promotion</option><option value="redesignation">Re-designation</option></Select>}</Field>
        <Field label="With effect from">{(p) => <Input {...p} type="date" value={f.effectiveDate} onChange={(ev) => setF({ ...f, effectiveDate: ev.target.value })} />}</Field>
        {sel("Department", "departmentId", depts.data)}
        {sel("Designation", "designationId", desigs.data)}
        {sel("Grade", "gradeId", grades.data)}
        {sel("Location", "locationId", locs.data)}
        <Field label="Reports to" className="sm:col-span-2">{(p) => <Select {...p} value={f.reportsToId} onChange={(ev) => setF({ ...f, reportsToId: ev.target.value })}><option value="">—</option>{people.data?.filter((m) => m.id !== e.id).map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>
        <Field label="Remarks" className="sm:col-span-2">{(p) => <Input {...p} value={f.remarks} onChange={(ev) => setF({ ...f, remarks: ev.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function ExitDialog({ e, onClose, onDone }: { e: Employee; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ exitDate: todayIST(), reason: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${HR}/employees/${e.id}/exit`, { body: f });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Exit: ${e.fullName}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={f.reason.trim().length < 3}>Record</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Last working day" hint="A future date puts them on notice until then">{(p) => <Input {...p} type="date" value={f.exitDate} onChange={(ev) => setF({ ...f, exitDate: ev.target.value })} />}</Field>
        <Field label="Reason">{(p) => <Input {...p} value={f.reason} onChange={(ev) => setF({ ...f, reason: ev.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}

function LetterDialog({ e, onClose, onDone }: { e: Employee; onClose: () => void; onDone: () => void }) {
  const templates = useQuery({ queryKey: [HR, "templates"], queryFn: () => api<{ id: string; name: string; body: string; isActive: boolean }[]>(`${HR}/letter-templates`) });
  const [templateId, setTemplateId] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const t = templates.data?.find((x) => x.id === templateId);
  const KNOWN = new Set(["employee.name", "employee.first_name", "employee.code", "designation", "department", "grade", "location", "manager", "doj", "confirmed_on", "exit_date", "company", "today", "date"]);
  const fields = t ? [...new Set([...t.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))].filter((k) => !KNOWN.has(k)) : [];
  async function issue() {
    setError(null);
    try {
      await api(`${HR}/employees/${e.id}/letters`, { body: { templateId, extra } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="Issue a letter" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={issue} disabled={!templateId}>Issue</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Template">{(p) => <Select {...p} value={templateId} onChange={(ev) => { setTemplateId(ev.target.value); setExtra({}); }}><option value="">Choose…</option>{templates.data?.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        {fields.map((k) => <Field key={k} label={k}>{(p) => <Input {...p} value={extra[k] ?? ""} onChange={(ev) => setExtra({ ...extra, [k]: ev.target.value })} />}</Field>)}
        {templates.data && !templates.data.length && <p className="text-sm text-muted">No templates yet: add them under HR → Letter templates.</p>}
      </div>
    </Dialog>
  );
}
