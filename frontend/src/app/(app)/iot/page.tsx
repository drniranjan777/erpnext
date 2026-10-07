"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, timeAgo } from "@/components/ui/page";
import { api } from "@/lib/api";
import { fmtValue, PURPOSES, type Gateway, type Signal } from "@/lib/iot";

/** Live values from every connected machine and sensor, refreshed every few seconds. */
export default function LiveMachinesPage() {
  const signals = useQuery({ queryKey: ["/iot/signals"], queryFn: () => api<Signal[]>("/iot/signals"), refetchInterval: 5000 });
  const gateways = useQuery({ queryKey: ["/iot/gateways"], queryFn: () => api<Gateway[]>("/iot/gateways"), refetchInterval: 15000 });
  if (signals.isLoading) return <LoadingBlock />;
  if (signals.error) return <ErrorBlock error={signals.error} />;
  const groups = new Map<string, Signal[]>();
  for (const s of signals.data ?? []) {
    const key = s.machineCode ? `${s.machineCode} · ${s.machineName}` : s.warehouseName ? `Store: ${s.warehouseName}` : s.vehicleNo ? `Vehicle ${s.vehicleNo}` : "Other signals";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Live machines"
        description="Values sent by the edge gateways, refreshed every 5 seconds. Grey values have not changed or arrived for 5 minutes."
        actions={
          <span className="flex gap-3 text-sm">
            <Link className="text-primary hover:underline" href="/iot/alarms">Alarms</Link>
            <Link className="text-primary hover:underline" href="/iot/signals">Signals</Link>
          </span>
        }
      />
      {gateways.data && gateways.data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {gateways.data.map((g) => (
            <Link key={g.id} href="/iot/gateways" className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-surface-muted">
              <span className={`size-2 rounded-full ${g.status === "disabled" ? "bg-muted" : g.online ? "bg-success" : "bg-danger"}`} aria-hidden />
              <span className="font-medium">{g.code}</span>
              <span className="text-muted">{g.status === "disabled" ? "disabled" : g.online ? "online" : g.lastSeenAt ? `last seen ${timeAgo(g.lastSeenAt)}` : "never connected"}</span>
              {g.buffered > 0 && <Badge tone="warning">{g.buffered} buffered</Badge>}
            </Link>
          ))}
        </div>
      )}
      {!signals.data?.length && <EmptyState title="No signals yet" description="Register an edge gateway, then add the signals it reads from your machines." action={<Link className="text-primary hover:underline" href="/iot/gateways">Edge gateways</Link>} />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...groups.entries()].map(([name, sigs]) => (
          <Card key={name}>
            <CardHeader title={name} action={sigs.some((s) => s.openAlarms) ? <Badge tone="danger">{sigs.reduce((n, s) => n + s.openAlarms, 0)} alarm(s)</Badge> : undefined} />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {sigs.map((s) => (
                <li key={s.id}>
                  <Link href={`/iot/signals/${s.id}`} className="flex items-baseline gap-2 px-4 py-2 hover:bg-surface-muted">
                    <span className="min-w-0 flex-1 truncate" title={s.code}>{s.name}<span className="block text-[11px] text-muted">{PURPOSES[s.purpose] ?? s.purpose}</span></span>
                    <span className={`text-lg font-semibold tabular-nums ${s.openAlarms ? "text-danger" : s.stale ? "text-muted" : ""}`}>
                      {s.purpose === "run_state" ? (s.lastValue === null ? "–" : s.lastValue ? "Running" : "Stopped") : fmtValue(s.lastValue, s.unit)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
