"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader, timeAgo } from "@/components/ui/page";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Fmea { id: string; code: string; kind: string; title: string; revision: number; updatedAt: string; summary: { high: number; medium: number; low: number; highWithoutAction: number } }
interface Plan { id: string; code: string; phase: string; revision: number; itemCode: string; itemName: string; fmeaCode: string | null; rows: unknown[]; updatedAt: string }

/** FMEAs (AIAG-VDA) and control plans. */
export default function FmeaPage() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ["/auto/fmeas"], queryFn: () => api<Fmea[]>("/auto/fmeas") });
  const plans = useQuery({ queryKey: ["/auto/control-plans"], queryFn: () => api<Plan[]>("/auto/control-plans") });
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="FMEA and control plans" description="Design and process FMEAs rated as AIAG-VDA describes: each failure gets an action priority (high, medium, low) from its severity, occurrence and detection. Control plans can be drafted from a process FMEA." actions={can("auto.apqp.manage") && <Link href="/auto/fmea/new"><Button><Plus className="size-4" aria-hidden /> New FMEA</Button></Link>} />
      <Card>
        <CardHeader title="FMEAs" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {list.data?.map((f) => (
            <li key={f.id}>
              <Link href={`/auto/fmea/${f.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2 hover:bg-surface-muted">
                <span className="font-medium">{f.code}</span>
                <span>{f.title}</span>
                <span className="text-xs text-muted">{f.kind} · rev {f.revision} · {timeAgo(f.updatedAt)}</span>
                <span className="ml-auto flex gap-1"><Badge tone="danger">H {f.summary.high}</Badge><Badge tone="warning">M {f.summary.medium}</Badge><Badge>L {f.summary.low}</Badge>{f.summary.highWithoutAction > 0 && <Badge tone="danger">{f.summary.highWithoutAction} H without action</Badge>}</span>
              </Link>
            </li>
          ))}
          {list.data && !list.data.length && <li className="px-4 py-6 text-center text-muted">No FMEAs.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Control plans" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {plans.data?.map((p) => <li key={p.id} className="flex flex-wrap gap-3 px-4 py-2"><span className="font-medium">{p.code}</span><span>{p.itemCode} · {p.itemName}</span><span className="text-xs text-muted">{p.phase.replace("_", " ")} · rev {p.revision} · {p.rows.length} characteristics{p.fmeaCode ? ` · from ${p.fmeaCode}` : ""}</span></li>)}
          {plans.data && !plans.data.length && <li className="px-4 py-6 text-center text-muted">No control plans. Draft one from a process FMEA.</li>}
        </ul>
      </Card>
    </div>
  );
}
