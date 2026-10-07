"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { todayIST } from "@/lib/documents";
import { HR } from "@/lib/hr";

interface Reg { key: string; title: string; law: string; period: "none" | "month" | "year" }

export default function RegistersPage() {
  const q = useQuery({ queryKey: [HR, "registers"], queryFn: () => api<Reg[]>(`${HR}/registers`) });
  const [month, setMonth] = useState(() => {
    const d = new Date(`${todayIST().slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [year, setYear] = useState(() => Number(todayIST().slice(0, 4)));
  const href = (r: Reg) => `/print/registers/${r.key}${r.period === "month" ? `?month=${month}` : r.period === "year" ? `?year=${year}` : ""}`;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Statutory registers" description="Print the registers inspectors ask for, from the data already in the system." />
      <div className="flex flex-wrap gap-3">
        <label className="text-sm"><span className="mb-1 block font-medium">Month</span><Input type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        <label className="text-sm"><span className="mb-1 block font-medium">Year</span><Input type="number" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
      </div>
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {q.data?.map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-5 py-3">
              <span className="flex-1"><span className="font-medium">{r.title}</span><span className="block text-xs text-muted">{r.law}{r.period !== "none" && ` · by ${r.period}`}</span></span>
              <a className="inline-flex items-center gap-1 text-primary hover:underline" href={href(r)} target="_blank" rel="noreferrer"><Printer className="size-4" aria-hidden /> Print</a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
