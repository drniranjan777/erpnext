"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Tabs } from "@/components/documents/document-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { HR, type OrgRow } from "@/lib/hr";

type Kind = "departments" | "designations" | "grades" | "locations";
const LABEL: Record<Kind, string> = { departments: "Departments", designations: "Designations", grades: "Grades", locations: "Locations" };

export default function OrgPage() {
  const { can } = useAuth();
  const [kind, setKind] = useState<Kind>("departments");
  const [editing, setEditing] = useState<OrgRow | "new" | null>(null);
  const q = useQuery({ queryKey: [HR, "org", kind], queryFn: () => api<OrgRow[]>(`${HR}/org/${kind}`) });
  const grades = useQuery({ queryKey: [HR, "org", "grades"], queryFn: () => api<OrgRow[]>(`${HR}/org/grades`) });
  const name = (rows: OrgRow[] | undefined, id: string | null | undefined) => rows?.find((r) => r.id === id)?.name ?? "–";
  const detail = (r: OrgRow) => {
    if (kind === "departments") return [r.parentId && `under ${name(q.data, r.parentId)}`, r.costCentre && `cost centre ${r.costCentre}`].filter(Boolean).join(" · ");
    if (kind === "designations") return r.gradeId ? `grade ${name(grades.data, r.gradeId)}` : "";
    if (kind === "grades") return [`level ${r.level}`, (r.minSalary || r.maxSalary) && `₹${r.minSalary ? Number(r.minSalary).toLocaleString("en-IN") : "—"} – ${r.maxSalary ? Number(r.maxSalary).toLocaleString("en-IN") : "—"}`].filter(Boolean).join(" · ");
    return [`state ${r.stateCode}`, r.isFactory ? "factory" : "office", r.radiusMetres && `geofence ${r.radiusMetres} m`].filter(Boolean).join(" · ");
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Organisation" description="Departments, designations, grades and work locations." actions={can("hr.masters.manage") && <Button onClick={() => setEditing("new")}><Plus className="size-4" aria-hidden /> Add {LABEL[kind].slice(0, -1).toLowerCase()}</Button>} />
      <Tabs value={kind} onChange={setKind} tabs={(Object.keys(LABEL) as Kind[]).map((k) => ({ value: k, label: LABEL[k] }))} />
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <ul className="divide-y divide-border text-sm">
            {q.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-2">
                <span className="w-24 font-mono text-xs text-muted">{r.code}</span>
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted">{detail(r)}</span>
                {!r.isActive && <Badge>inactive</Badge>}
                <span className="ml-auto text-xs text-muted">{r.employees} employees</span>
                {can("hr.masters.manage") && <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil className="size-3.5" aria-hidden /></Button>}
              </li>
            ))}
            {!q.data.length && <li className="px-5 py-6 text-center text-muted">None yet.</li>}
          </ul>
        </Card>
      )}
      {editing && <OrgDialog kind={kind} row={editing === "new" ? null : editing} rows={q.data ?? []} grades={grades.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OrgDialog({ kind, row, rows, grades, onClose }: { kind: Kind; row: OrgRow | null; rows: OrgRow[]; grades: OrgRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: row?.code ?? "",
    name: row?.name ?? "",
    isActive: row?.isActive ?? true,
    parentId: row?.parentId ?? "",
    costCentre: row?.costCentre ?? "",
    gradeId: row?.gradeId ?? "",
    level: String(row?.level ?? 1),
    minSalary: row?.minSalary ?? "",
    maxSalary: row?.maxSalary ?? "",
    stateCode: row?.stateCode ?? "36",
    isFactory: row?.isFactory ?? true,
    latitude: row?.latitude ?? "",
    longitude: row?.longitude ?? "",
    radiusMetres: row?.radiusMetres ? String(row.radiusMetres) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  async function save() {
    setError(null);
    const base = { code: f.code, name: f.name, isActive: f.isActive };
    const body =
      kind === "departments" ? { ...base, parentId: f.parentId || null, costCentre: f.costCentre || null }
      : kind === "designations" ? { ...base, gradeId: f.gradeId || null }
      : kind === "grades" ? { ...base, level: Number(f.level) || 1, minSalary: f.minSalary || null, maxSalary: f.maxSalary || null }
      : { ...base, stateCode: f.stateCode, isFactory: f.isFactory, latitude: num(f.latitude), longitude: num(f.longitude), radiusMetres: num(f.radiusMetres) };
    try {
      await api(row ? `${HR}/org/${kind}/${row.id}` : `${HR}/org/${kind}`, { method: row ? "PUT" : "POST", body });
      await qc.invalidateQueries({ queryKey: [HR, "org"] });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={row ? `Edit ${row.name}` : `New ${LABEL[kind].slice(0, -1).toLowerCase()}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={set("code")} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={set("name")} />}</Field>
        {kind === "departments" && (
          <>
            <Field label="Part of">{(p) => <Select {...p} value={f.parentId} onChange={set("parentId")}><option value="">—</option>{rows.filter((r) => r.id !== row?.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>
            <Field label="Cost centre">{(p) => <Input {...p} value={f.costCentre} onChange={set("costCentre")} />}</Field>
          </>
        )}
        {kind === "designations" && <Field label="Grade">{(p) => <Select {...p} value={f.gradeId} onChange={set("gradeId")}><option value="">—</option>{grades.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>}
        {kind === "grades" && (
          <>
            <Field label="Level">{(p) => <Input {...p} type="number" min={1} value={f.level} onChange={set("level")} />}</Field>
            <Field label="Minimum monthly salary">{(p) => <Input {...p} inputMode="decimal" value={f.minSalary} onChange={set("minSalary")} />}</Field>
            <Field label="Maximum monthly salary">{(p) => <Input {...p} inputMode="decimal" value={f.maxSalary} onChange={set("maxSalary")} />}</Field>
          </>
        )}
        {kind === "locations" && (
          <>
            <Field label="GST state code" hint="Decides professional tax and labour welfare fund rules">{(p) => <Input {...p} maxLength={2} value={f.stateCode} onChange={set("stateCode")} />}</Field>
            <Field label="Type">{(p) => <Select {...p} value={f.isFactory ? "1" : "0"} onChange={(e) => setF({ ...f, isFactory: e.target.value === "1" })}><option value="1">Factory</option><option value="0">Office</option></Select>}</Field>
            <Field label="Latitude">{(p) => <Input {...p} inputMode="decimal" value={f.latitude} onChange={set("latitude")} />}</Field>
            <Field label="Longitude">{(p) => <Input {...p} inputMode="decimal" value={f.longitude} onChange={set("longitude")} />}</Field>
            <Field label="Geofence radius (m)" hint="For mobile attendance check-in">{(p) => <Input {...p} type="number" value={f.radiusMetres} onChange={set("radiusMetres")} />}</Field>
          </>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>
      </div>
    </Dialog>
  );
}
