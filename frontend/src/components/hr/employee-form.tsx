"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { HR, type Employee, type FamilyMember, type OrgRow } from "@/lib/hr";

const useOrg = (kind: string) => useQuery({ queryKey: [HR, "org", kind], queryFn: () => api<OrgRow[]>(`${HR}/org/${kind}`) });

/** Employee master. Placement (department, designation…) is set on joining; later changes are transfers / promotions. */
export function EmployeeForm({ employee }: { employee?: Employee }) {
  const router = useRouter();
  const depts = useOrg("departments");
  const desigs = useOrg("designations");
  const grades = useOrg("grades");
  const locs = useOrg("locations");
  const people = useQuery({ queryKey: [HR, "people"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>(`${HR}/employees/search`), enabled: !employee });
  const e = employee;
  const [f, setF] = useState({
    code: e?.code ?? "",
    firstName: e?.firstName ?? "",
    lastName: e?.lastName ?? "",
    gender: e?.gender ?? "",
    dateOfBirth: e?.dateOfBirth ?? "",
    bloodGroup: e?.bloodGroup ?? "",
    maritalStatus: e?.maritalStatus ?? "",
    fatherOrSpouseName: e?.fatherOrSpouseName ?? "",
    personalEmail: e?.personalEmail ?? "",
    mobile: e?.mobile ?? "",
    line1: e?.currentAddress.line1 ?? "",
    city: e?.currentAddress.city ?? "",
    pincode: e?.currentAddress.pincode ?? "",
    emergencyContact: e?.emergencyContact ?? "",
    emergencyPhone: e?.emergencyPhone ?? "",
    dateOfJoining: e?.dateOfJoining ?? "",
    probationEnd: e?.probationEnd ?? "",
    employmentType: e?.employmentType ?? "probation",
    category: e?.category ?? "staff",
    departmentId: e?.departmentId ?? "",
    designationId: e?.designationId ?? "",
    gradeId: e?.gradeId ?? "",
    locationId: e?.locationId ?? "",
    reportsToId: e?.reportsToId ?? "",
    workEmail: e?.workEmail ?? "",
    noticeDays: String(e?.noticeDays ?? 30),
    pan: "",
    aadhaar: "",
    uan: e?.uan ?? "",
    pfNumber: e?.pfNumber ?? "",
    esicNumber: e?.esicNumber ?? "",
    bankName: e?.bankName ?? "",
    bankAccount: "",
    ifsc: e?.ifsc ?? "",
    taxRegime: e?.taxRegime ?? "new",
  });
  const [flags, setFlags] = useState({ pfApplicable: e?.pfApplicable ?? true, esiApplicable: e?.esiApplicable ?? true, ptApplicable: e?.ptApplicable ?? true, lwfApplicable: e?.lwfApplicable ?? true });
  const [family, setFamily] = useState<FamilyMember[]>(e?.family ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: ev.target.value });
  const opt = (v: string) => v || null;

  async function save() {
    setBusy(true);
    setError(null);
    setErrors({});
    const body: Record<string, unknown> = {
      code: f.code || undefined,
      firstName: f.firstName,
      lastName: opt(f.lastName),
      gender: opt(f.gender),
      dateOfBirth: opt(f.dateOfBirth),
      bloodGroup: opt(f.bloodGroup),
      maritalStatus: opt(f.maritalStatus),
      fatherOrSpouseName: opt(f.fatherOrSpouseName),
      personalEmail: opt(f.personalEmail),
      mobile: opt(f.mobile),
      currentAddress: { line1: f.line1 || undefined, city: f.city || undefined, pincode: f.pincode || undefined },
      emergencyContact: opt(f.emergencyContact),
      emergencyPhone: opt(f.emergencyPhone),
      dateOfJoining: f.dateOfJoining,
      probationEnd: opt(f.probationEnd),
      employmentType: f.employmentType,
      category: f.category,
      workEmail: opt(f.workEmail),
      noticeDays: Number(f.noticeDays) || 0,
      uan: opt(f.uan),
      pfNumber: opt(f.pfNumber),
      esicNumber: opt(f.esicNumber),
      bankName: opt(f.bankName),
      ifsc: opt(f.ifsc),
      taxRegime: f.taxRegime,
      ...flags,
      family: family.map((m) => ({ ...m, dateOfBirth: m.dateOfBirth || null, nomineeSharePct: m.nomineeSharePct || null })),
    };
    // Secrets are only sent when typed (blank keeps what is stored).
    if (f.pan) body.pan = f.pan;
    if (f.aadhaar) body.aadhaar = f.aadhaar;
    if (f.bankAccount) body.bankAccount = f.bankAccount;
    if (!e) Object.assign(body, { departmentId: opt(f.departmentId), designationId: opt(f.designationId), gradeId: opt(f.gradeId), locationId: opt(f.locationId), reportsToId: opt(f.reportsToId) });
    try {
      const r = await api<Employee>(e ? `${HR}/employees/${e.id}` : `${HR}/employees`, { method: e ? "PUT" : "POST", body: e ? { ...body, version: e.version } : body });
      router.push(`${HR}/employees/${r.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setError(err.message);
      } else setError("Could not reach the server.");
      setBusy(false);
    }
  }

  const sel = (label: string, k: keyof typeof f, rows: OrgRow[] | undefined, disabled = false) => <Field label={label}>{(p) => <Select {...p} disabled={disabled} value={f[k]} onChange={set(k)}><option value="">—</option>{rows?.filter((r) => r.isActive || r.id === f[k]).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>;

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card>
        <CardHeader title="Personal" />
        <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-4">
          <Field label="Employee code" hint={e ? undefined : "Blank = next EMP number"}>{(p) => <Input {...p} className="font-mono uppercase" value={f.code} onChange={set("code")} />}</Field>
          <Field label="First name" required error={errors.firstName}>{(p) => <Input {...p} value={f.firstName} onChange={set("firstName")} />}</Field>
          <Field label="Last name">{(p) => <Input {...p} value={f.lastName} onChange={set("lastName")} />}</Field>
          <Field label="Gender">{(p) => <Select {...p} value={f.gender} onChange={set("gender")}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></Select>}</Field>
          <Field label="Date of birth" error={errors.dateOfBirth}>{(p) => <Input {...p} type="date" value={f.dateOfBirth} onChange={set("dateOfBirth")} />}</Field>
          <Field label="Father / spouse name">{(p) => <Input {...p} value={f.fatherOrSpouseName} onChange={set("fatherOrSpouseName")} />}</Field>
          <Field label="Marital status">{(p) => <Select {...p} value={f.maritalStatus} onChange={set("maritalStatus")}><option value="">—</option><option value="single">Single</option><option value="married">Married</option><option value="widowed">Widowed</option><option value="divorced">Divorced</option></Select>}</Field>
          <Field label="Blood group">{(p) => <Input {...p} value={f.bloodGroup} onChange={set("bloodGroup")} />}</Field>
          <Field label="Mobile" error={errors.mobile}>{(p) => <Input {...p} inputMode="numeric" value={f.mobile} onChange={set("mobile")} />}</Field>
          <Field label="Personal email" error={errors.personalEmail}>{(p) => <Input {...p} type="email" value={f.personalEmail} onChange={set("personalEmail")} />}</Field>
          <Field label="Address" className="sm:col-span-2">{(p) => <Input {...p} value={f.line1} onChange={set("line1")} />}</Field>
          <Field label="City">{(p) => <Input {...p} value={f.city} onChange={set("city")} />}</Field>
          <Field label="PIN code">{(p) => <Input {...p} inputMode="numeric" value={f.pincode} onChange={set("pincode")} />}</Field>
          <Field label="Emergency contact">{(p) => <Input {...p} value={f.emergencyContact} onChange={set("emergencyContact")} />}</Field>
          <Field label="Emergency phone">{(p) => <Input {...p} value={f.emergencyPhone} onChange={set("emergencyPhone")} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Job" description={e ? "Department, designation, grade, location and manager change through a transfer or promotion on the employee's page." : undefined} />
        <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-4">
          <Field label="Date of joining" required error={errors.dateOfJoining}>{(p) => <Input {...p} type="date" value={f.dateOfJoining} onChange={set("dateOfJoining")} />}</Field>
          <Field label="Employment">{(p) => <Select {...p} value={f.employmentType} onChange={set("employmentType")}>{["probation", "permanent", "contract", "trainee", "apprentice", "consultant"].map((k) => <option key={k} value={k}>{k}</option>)}</Select>}</Field>
          <Field label="Category">{(p) => <Select {...p} value={f.category} onChange={set("category")}><option value="staff">Staff</option><option value="worker">Worker</option><option value="management">Management</option></Select>}</Field>
          <Field label="Probation ends" error={errors.probationEnd}>{(p) => <Input {...p} type="date" value={f.probationEnd} onChange={set("probationEnd")} />}</Field>
          {sel("Department", "departmentId", depts.data, !!e)}
          {sel("Designation", "designationId", desigs.data, !!e)}
          {sel("Grade", "gradeId", grades.data, !!e)}
          {sel("Location", "locationId", locs.data, !!e)}
          {!e && <Field label="Reports to">{(p) => <Select {...p} value={f.reportsToId} onChange={set("reportsToId")}><option value="">—</option>{people.data?.map((m) => <option key={m.id} value={m.id}>{m.fullName} ({m.code})</option>)}</Select>}</Field>}
          <Field label="Work email" error={errors.workEmail}>{(p) => <Input {...p} type="email" value={f.workEmail} onChange={set("workEmail")} />}</Field>
          <Field label="Notice period (days)">{(p) => <Input {...p} inputMode="numeric" value={f.noticeDays} onChange={set("noticeDays")} />}</Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Statutory and bank" description="PAN, Aadhaar and the account number are stored encrypted and shown masked. Leave them blank to keep what is stored." />
        <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-4">
          <Field label="PAN" error={errors.pan} hint={e?.hasPan ? `Stored: ${e.panMasked}` : undefined}>{(p) => <Input {...p} className="font-mono uppercase" autoComplete="off" value={f.pan} onChange={set("pan")} />}</Field>
          <Field label="Aadhaar" error={errors.aadhaar} hint={e?.hasAadhaar ? `Stored: XXXX XXXX ${e.aadhaarLast4}` : undefined}>{(p) => <Input {...p} inputMode="numeric" autoComplete="off" value={f.aadhaar} onChange={set("aadhaar")} />}</Field>
          <Field label="UAN" error={errors.uan}>{(p) => <Input {...p} inputMode="numeric" value={f.uan} onChange={set("uan")} />}</Field>
          <Field label="ESIC number" error={errors.esicNumber}>{(p) => <Input {...p} inputMode="numeric" value={f.esicNumber} onChange={set("esicNumber")} />}</Field>
          <Field label="Bank">{(p) => <Input {...p} value={f.bankName} onChange={set("bankName")} />}</Field>
          <Field label="Account number" error={errors.bankAccount} hint={e?.hasBankAccount ? `Stored: ••${e.bankAccountLast4}` : undefined}>{(p) => <Input {...p} inputMode="numeric" autoComplete="off" value={f.bankAccount} onChange={set("bankAccount")} />}</Field>
          <Field label="IFSC" error={errors.ifsc}>{(p) => <Input {...p} className="font-mono uppercase" value={f.ifsc} onChange={set("ifsc")} />}</Field>
          <Field label="Income-tax regime">{(p) => <Select {...p} value={f.taxRegime} onChange={set("taxRegime")}><option value="new">New</option><option value="old">Old</option></Select>}</Field>
          <div className="flex flex-wrap gap-4 sm:col-span-4">
            {(["pfApplicable", "esiApplicable", "ptApplicable", "lwfApplicable"] as const).map((k) => <Checkbox key={k} label={{ pfApplicable: "PF", esiApplicable: "ESI", ptApplicable: "Professional tax", lwfApplicable: "LWF" }[k]} checked={flags[k]} onChange={(ev) => setFlags({ ...flags, [k]: ev.target.checked })} />)}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Family and nominees" description="Nominee shares for PF and gratuity must add up to 100%." />
        <div className="space-y-2 border-t border-border p-5">
          {family.map((m, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input className="h-9 w-48" aria-label="Name" placeholder="Name" value={m.name} onChange={(ev) => setFamily(family.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
              <Select className="h-9 w-32" aria-label="Relation" value={m.relation} onChange={(ev) => setFamily(family.map((x, j) => (j === i ? { ...x, relation: ev.target.value } : x)))}>{["spouse", "father", "mother", "son", "daughter", "brother", "sister", "other"].map((r) => <option key={r} value={r}>{r}</option>)}</Select>
              <Input className="h-9 w-40" type="date" aria-label="Date of birth" value={m.dateOfBirth ?? ""} onChange={(ev) => setFamily(family.map((x, j) => (j === i ? { ...x, dateOfBirth: ev.target.value } : x)))} />
              <Checkbox label="Dependent" checked={m.isDependent} onChange={(ev) => setFamily(family.map((x, j) => (j === i ? { ...x, isDependent: ev.target.checked } : x)))} />
              <Checkbox label="Nominee (PF, gratuity)" checked={m.nomineeFor.length > 0} onChange={(ev) => setFamily(family.map((x, j) => (j === i ? { ...x, nomineeFor: ev.target.checked ? ["pf", "gratuity"] : [] } : x)))} />
              {m.nomineeFor.length > 0 && <Input className="h-9 w-24" aria-label="Share %" placeholder="Share %" inputMode="decimal" value={m.nomineeSharePct ?? ""} onChange={(ev) => setFamily(family.map((x, j) => (j === i ? { ...x, nomineeSharePct: ev.target.value } : x)))} />}
              <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => setFamily(family.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setFamily([...family, { name: "", relation: "spouse", dateOfBirth: null, isDependent: false, nomineeFor: [], nomineeSharePct: null }])}><Plus className="size-4" aria-hidden /> Add family member</Button>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>Cancel</Button>
        <Button onClick={save} loading={busy}>Save</Button>
      </div>
    </div>
  );
}
