"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api } from "@/lib/api";
import { HR } from "@/lib/hr";

interface Count { key: string; n: number }
interface Headcount { total: number; byDepartment: Count[]; byLocation: Count[]; byCategory: Count[]; byGender: Count[]; joinersThisMonth: number; exitsThisMonth: number }

function Breakdown({ title, rows, total }: { title: string; rows: Count[]; total: number }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="space-y-2 border-t border-border px-5 py-4 text-sm">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex justify-between"><span className="capitalize">{r.key}</span><span className="tabular-nums text-muted">{r.n}</span></div>
            <div className="mt-1 h-1.5 rounded bg-surface-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${total ? (r.n / total) * 100 : 0}%` }} /></div>
          </li>
        ))}
        {!rows.length && <li className="text-muted">Nobody yet.</li>}
      </ul>
    </Card>
  );
}

export default function HrOverviewPage() {
  const q = useQuery({ queryKey: [HR, "headcount"], queryFn: () => api<Headcount>(`${HR}/headcount`) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const h = q.data!;
  const stat = (label: string, value: number, href?: string) => (
    <Card className="px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{href ? <Link href={href} className="hover:underline">{value}</Link> : value}</p>
    </Card>
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="People" description="Headcount of everyone not yet exited." />
      <div className="grid gap-4 sm:grid-cols-3">
        {stat("Headcount", h.total, `${HR}/employees`)}
        {stat("Joined this month", h.joinersThisMonth)}
        {stat("Left this month", h.exitsThisMonth)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title="By department" rows={h.byDepartment} total={h.total} />
        <Breakdown title="By location" rows={h.byLocation} total={h.total} />
        <Breakdown title="By category" rows={h.byCategory} total={h.total} />
        <Breakdown title="By gender" rows={h.byGender} total={h.total} />
      </div>
    </div>
  );
}
