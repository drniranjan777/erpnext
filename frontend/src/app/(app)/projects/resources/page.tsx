"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/documents";

interface Load { weeks: string[]; capacity: number; people: { employeeId: string; employee: string; projects: string[]; hours: number[]; overloaded: string[] }[] }

/** Planned hours per person per week across all open projects. */
export default function ResourceLoadPage() {
  const [weeks, setWeeks] = useState(8);
  const q = useQuery({ queryKey: ["/projects/resource-load", weeks], queryFn: () => api<Load>("/projects/resource-load", { query: { weeks } }) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Resource load" description={`Hours planned per person per week across open projects, against ${d?.capacity ?? 48} hours a week. Red weeks are overloaded.`} actions={<Select className="h-9 w-32" aria-label="Weeks" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>{[4, 8, 12, 26].map((n) => <option key={n} value={n}>{n} weeks</option>)}</Select>} />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-xs text-muted"><tr><th className="px-3 py-2 text-left">Person</th>{d?.weeks.map((w) => <th key={w} className="px-2 py-2 text-right">{formatDate(w)}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {d?.people.map((p) => (
              <tr key={p.employeeId}>
                <td className="px-3 py-2">{p.employee}<span className="block text-xs text-muted">{p.projects.join(", ")}</span></td>
                {p.hours.map((h, i) => <td key={i} className={`px-2 py-2 text-right tabular-nums ${h > (d?.capacity ?? 48) ? "bg-danger-soft font-semibold text-danger" : h === 0 ? "text-muted" : ""}`}>{h || "–"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {d && !d.people.length && <p className="p-8 text-center text-muted">No one is planned on open projects.</p>}
      </Card>
    </div>
  );
}
