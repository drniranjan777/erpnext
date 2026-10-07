"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Siren, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Info } from "@/components/documents/doc-page";
import { StatusBadge } from "@/components/documents/document-parts";
import { ItemPicker } from "@/components/item-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader, formatDateTime } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty, type DocumentStatus } from "@/lib/documents";
import { ASSET_STATUS, KIND, MT, hours } from "@/lib/maintenance";

interface AssetView {
  id: string;
  code: string;
  name: string;
  level: string;
  location: string | null;
  make: string | null;
  model: string | null;
  serialNo: string | null;
  specs: string | null;
  installedOn: string | null;
  warrantyUntil: string | null;
  criticality: string;
  status: keyof typeof ASSET_STATUS;
  meterUnit: string | null;
  meterReading: string | null;
  parent: { id: string; code: string; name: string } | null;
  children: { id: string; code: string; name: string; level: string; status: string }[];
  spares: { id: string; itemId: string; code: string; name: string; isCritical: boolean; minQty: string | null; alternateCode: string | null; stock: string }[];
  readings: { reading: string; readAt: string }[];
}
interface Job { id: string; number: string | null; status: DocumentStatus; kind: keyof typeof KIND; problem: string; reportedAt: string; downtimeMinutes: number | null; totalCost: string }

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("maintenance.orders.manage");
  const q = useQuery({ queryKey: [MT, "assets", id], queryFn: () => api<AssetView>(`${MT}/assets/${id}`) });
  const jobs = useQuery({ queryKey: [MT, "orders", "asset", id], queryFn: () => api<{ items: Job[] }>(`${MT}/orders`, { query: { assetId: id, limit: 50 } }) });
  const [reading, setReading] = useState("");
  const [critical, setCritical] = useState({ isCritical: true, minQty: "" });
  const [error, setError] = useState<string | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const a = q.data!;
  async function call(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: [MT] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
    }
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title={`${a.code} ${a.name}`} description={`${a.level}${a.parent ? ` in ${a.parent.code} ${a.parent.name}` : ""}`} actions={<span className="flex items-center gap-3"><Badge tone={ASSET_STATUS[a.status]}>{a.status}</Badge>{can("maintenance.requests.create") && <Link href={`${MT}/orders/new`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-danger px-4 text-sm font-medium text-white hover:opacity-90"><Siren className="size-4" aria-hidden /> Report breakdown</Link>}</span>} />
      {error && <Alert>{error}</Alert>}
      <Card>
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
          <Info label="Criticality" value={a.criticality} />
          <Info label="Make · model" value={`${a.make ?? "–"} · ${a.model ?? "–"}`} />
          <Info label="Serial" value={a.serialNo ?? "–"} />
          <Info label="Warranty until" value={a.warrantyUntil ? formatDate(a.warrantyUntil) : "–"} />
          {a.children.length > 0 && <Info label="Contains" value={a.children.map((c) => <Link key={c.id} href={`${MT}/assets/${c.id}`} className="mr-2 text-primary hover:underline">{c.code}</Link>)} />}
        </dl>
        {a.specs && <p className="whitespace-pre-line border-t border-border px-5 py-3 text-sm">{a.specs}</p>}
      </Card>
      {a.meterUnit && (
        <Card>
          <CardHeader title={`Meter: ${a.meterReading ? formatQty(a.meterReading) : "–"} ${a.meterUnit}`} description={a.readings.length ? `Last read ${formatDateTime(a.readings[0].readAt)}` : undefined} />
          {can("maintenance.requests.create") && (
            <div className="flex items-center gap-2 border-t border-border p-4">
              <Input className="h-9 w-40" inputMode="decimal" aria-label="New reading" placeholder="New reading" value={reading} onChange={(e) => setReading(e.target.value)} />
              <Button size="sm" disabled={!reading} onClick={() => call(async () => { await api(`${MT}/assets/${a.id}/meter`, { body: { reading } }); setReading(""); })}>Record</Button>
            </div>
          )}
        </Card>
      )}
      <Card>
        <CardHeader title="Spares" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {a.spares.map((s) => {
            const low = s.isCritical && s.minQty !== null && Number(s.stock) < Number(s.minQty);
            return (
              <li key={s.id} className="flex items-center gap-3 px-5 py-2">
                <span className="flex-1"><span className="font-mono text-xs text-muted">{s.code}</span> {s.name}{s.alternateCode && <span className="text-xs text-muted"> · or {s.alternateCode}</span>}</span>
                {s.isCritical && <Badge tone="warning">Critical</Badge>}
                <span className={`tabular-nums ${low ? "font-semibold text-danger" : ""}`}>{formatQty(s.stock)} in stock{s.minQty && ` (min ${formatQty(s.minQty)})`}</span>
                {manage && <Button size="sm" variant="ghost" aria-label="Remove" onClick={() => call(() => api(`${MT}/spares/${s.id}`, { method: "DELETE" }))}><Trash2 className="size-4" aria-hidden /></Button>}
              </li>
            );
          })}
          {!a.spares.length && <li className="px-5 py-3 text-muted">No spares listed.</li>}
        </ul>
        {manage && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border p-4">
            <Checkbox label="Critical" checked={critical.isCritical} onChange={(e) => setCritical({ ...critical, isCritical: e.target.checked })} />
            <Input className="h-9 w-28" inputMode="decimal" aria-label="Minimum" placeholder="Min stock" value={critical.minQty} onChange={(e) => setCritical({ ...critical, minQty: e.target.value })} />
            <div className="w-80"><ItemPicker placeholder="Add a spare…" stockOnly onPick={(it) => call(() => api(`${MT}/assets/${a.id}/spares`, { body: { itemId: it.id, isCritical: critical.isCritical, minQty: critical.minQty || null } }))} /></div>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Maintenance history" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {jobs.data?.items.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <Link href={`${MT}/orders/${j.id}`} className="font-medium text-primary hover:underline">{j.number ?? "Request"}</Link>
              <Badge>{KIND[j.kind]}</Badge>
              <span className="flex-1">{j.problem}</span>
              <span className="text-xs text-muted">{formatDateTime(j.reportedAt)} · {hours(j.downtimeMinutes)}{Number(j.totalCost) > 0 && ` · ${formatMoney(j.totalCost)}`}</span>
              <StatusBadge status={j.status} />
            </li>
          ))}
          {jobs.data && !jobs.data.items.length && <li className="px-5 py-3 text-muted">No maintenance yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
