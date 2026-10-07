"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { api } from "@/lib/api";

interface LoggerReport {
  logger: { id: string; code: string; name: string; unit: string | null };
  range: { low: number | null; high: number | null };
  readings: number;
  min: number | null;
  max: number | null;
  mktC: number | null;
  minutesOutside: number;
  excursions: { start: string; minutes: number; direction: string; worst: number }[];
}

/** Temperatures recorded by the loggers in the trip's vehicle while it was on the road. */
export function TripTemperatures({ tripId }: { tripId: string }) {
  const q = useQuery({ queryKey: ["/plant/cold-chain/trips", tripId], queryFn: () => api<{ loggers: LoggerReport[] }>(`/plant/cold-chain/trips/${tripId}`), retry: false });
  if (!q.data?.loggers.length) return null;
  return (
    <Card>
      <CardHeader title="Temperatures on the way" description="From the loggers in this vehicle between dispatch and completion." />
      <ul className="divide-y divide-border border-t border-border text-sm">
        {q.data.loggers.map((l) => (
          <li key={l.logger.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
            <Link className="font-medium text-primary hover:underline" href={`/iot/signals/${l.logger.id}`}>{l.logger.name}</Link>
            <span className="text-xs text-muted">{l.readings} readings · {l.min ?? "–"} to {l.max ?? "–"} {l.logger.unit ?? ""}{l.mktC !== null ? ` · MKT ${l.mktC} °C` : ""}{l.range.low !== null || l.range.high !== null ? ` · range ${l.range.low ?? "–"}–${l.range.high ?? "–"}` : ""}</span>
            <span className="ml-auto">{l.excursions.length ? <Badge tone="danger">{l.excursions.length} excursion(s), {l.minutesOutside} min</Badge> : <Badge tone="success">in range</Badge>}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
