"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { formatQty, todayIST } from "@/lib/documents";
import { portalApi } from "@/lib/portal";
import { DataTable } from "@/components/ui/data-table";

interface Schedule { id: string; number: string; month: string; revision: number; reference: string | null; customerPartNo: string | null; itemCode: string; itemName: string; qty: number }
interface Asn { id: string; number: string; shippedAt: string; expectedAt: string | null; vehicleNo: string | null; lrNo: string | null; packages: number | null; status: string; deliveryNumber: string; lines: { qty: string | number }[] }

export default function PortalDeliveries() {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const sch = useQuery({ queryKey: ["portal", "schedules", month], queryFn: () => portalApi<Schedule[]>("/portal/schedules", { query: { month } }) });
  const asns = useQuery({ queryKey: ["portal", "asns"], queryFn: () => portalApi<Asn[]>("/portal/asns") });
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "–");
  return (
    <div className="space-y-6">
      <PageHeader title="Schedules & dispatches" description="The delivery schedules we hold from you, and advance shipping notices for goods on the way." />
      <Card>
        <CardHeader title="Delivery schedules" action={<Input className="h-9 w-40" type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} />} />
        <DataTable
          rows={sch.data ?? []}
          rowKey={(s) => String(s.id)}
          exportName="app-portal-deliveries"
          storageKey="app-portal-deliveries-0"
          empty={<p className="px-4 py-6 text-center text-sm text-muted">No schedules for this month.</p>}
          columns={[
            { key: "schedule", label: "Schedule", locked: true, className: "font-mono text-xs whitespace-normal", render: (s) => <>{s.number}{s.revision > 0 && ` rev ${s.revision}`}{s.reference && <span className="ml-1 font-sans text-muted">({s.reference})</span>}</> },
            { key: "your-part-no", label: "Your part no.", className: "whitespace-normal", render: (s) => <>{s.customerPartNo ?? "–"}</> },
            { key: "item", label: "Item", className: "whitespace-normal", render: (s) => <>{s.itemCode} · {s.itemName}</> },
            { key: "qty", label: "Qty", align: "right", render: (s) => <>{formatQty(s.qty)}</> },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Advance shipping notices" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {asns.data?.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="font-mono text-xs">{a.number}</span>
              <span>Delivery {a.deliveryNumber} · {a.lines.length} line(s){a.packages ? ` · ${a.packages} packages` : ""}</span>
              <span className="text-xs text-muted">shipped {fmt(a.shippedAt)}{a.expectedAt && ` · expected ${fmt(a.expectedAt)}`}{a.vehicleNo && ` · ${a.vehicleNo}`}{a.lrNo && ` · LR ${a.lrNo}`}</span>
              <Badge tone={a.status === "received" ? "success" : "primary"} className="ml-auto">{a.status}</Badge>
            </li>
          ))}
          {asns.data && !asns.data.length && <li className="px-5 py-6 text-center text-muted">No dispatches notified yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
