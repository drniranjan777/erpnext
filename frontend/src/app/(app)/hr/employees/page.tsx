"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/documents";
import { HR, STATUS_TONE, type OrgRow } from "@/lib/hr";

interface Row { id: string; code: string; fullName: string; status: keyof typeof STATUS_TONE; category: string; employmentType: string; dateOfJoining: string; mobile: string | null; department: string | null; designation: string | null; location: string | null; manager: string | null }
const PAGE = 50;

export default function EmployeesPage() {
  const { can } = useAuth();
  const [f, setF] = useState({ q: "", status: "", departmentId: "", locationId: "" });
  const [offset, setOffset] = useState(0);
  const depts = useQuery({ queryKey: [HR, "org", "departments"], queryFn: () => api<OrgRow[]>(`${HR}/org/departments`) });
  const locs = useQuery({ queryKey: [HR, "org", "locations"], queryFn: () => api<OrgRow[]>(`${HR}/org/locations`) });
  const q = useQuery({ queryKey: [HR, "employees", f, offset], queryFn: () => api<{ total: number; items: Row[] }>(`${HR}/employees`, { query: { q: f.q || undefined, status: f.status || undefined, departmentId: f.departmentId || undefined, locationId: f.locationId || undefined, limit: PAGE, offset } }) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setOffset(0); };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Employees" actions={can("hr.employees.manage") && <Link href={`${HR}/employees/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" aria-hidden /> Add employee</Link>} />
      <div className="flex flex-wrap gap-3">
        <Input className="h-9 w-64" placeholder="Code, name or mobile" aria-label="Search" value={f.q} onChange={set("q")} />
        <Select className="h-9 w-40" aria-label="Status" value={f.status} onChange={set("status")}><option value="">Current</option><option value="active">Active</option><option value="notice">On notice</option><option value="exited">Left</option></Select>
        <Select className="h-9 w-48" aria-label="Department" value={f.departmentId} onChange={set("departmentId")}><option value="">All departments</option>{depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Select className="h-9 w-48" aria-label="Location" value={f.locationId} onChange={set("locationId")}><option value="">All locations</option>{locs.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {q.data && (
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Employee</th><th className="px-4 py-2 font-medium">Designation · department</th><th className="px-4 py-2 font-medium">Location</th><th className="px-4 py-2 font-medium">Joined</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><Link href={`${HR}/employees/${r.id}`} className="font-medium hover:underline">{r.fullName}</Link><span className="block font-mono text-xs text-muted">{r.code}{r.manager && ` · reports to ${r.manager}`}</span></td>
                  <td className="px-4 py-2">{r.designation ?? "–"}<span className="block text-xs text-muted">{r.department ?? ""}</span></td>
                  <td className="px-4 py-2">{r.location ?? "–"}</td>
                  <td className="px-4 py-2">{formatDate(r.dateOfJoining)}<span className="block text-xs text-muted">{r.category} · {r.employmentType}</span></td>
                  <td className="px-4 py-2"><Badge tone={STATUS_TONE[r.status]}>{r.status === "notice" ? "On notice" : r.status}</Badge></td>
                </tr>
              ))}
              {!q.data.items.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No employees.</td></tr>}
            </tbody>
          </table></div>
          {q.data.total > PAGE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
              <span>{offset + 1}–{Math.min(offset + PAGE, q.data.total)} of {q.data.total}</span>
              <span className="flex gap-2"><Button size="sm" variant="ghost" disabled={!offset} onClick={() => setOffset(offset - PAGE)}>Previous</Button><Button size="sm" variant="ghost" disabled={offset + PAGE >= q.data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button></span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
