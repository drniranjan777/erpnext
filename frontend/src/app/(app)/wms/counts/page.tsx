"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/documents";
import { useWarehouseParam, WMS } from "@/lib/wms";

interface Due { id: string; code: string; cls: string; lastCountedAt: string | null; items: number }
interface Count { id: string; number: string; kind: string; status: string; blind: boolean; accuracyPct: string | null; createdAt: string; entryNumber: string | null; lines: number; uncounted: number }
interface Abc { applied: boolean; counts: { A: number; B: number; C: number }; items: { itemId: string; code: string; name: string; value: string; abcClass: string }[] }

export default function CountsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Counts />
    </Suspense>
  );
}

function Counts() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const { wh, loading, current } = useWarehouseParam();
  const [maxBins, setMaxBins] = useState("30");
  const [abc, setAbc] = useState<Abc | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const due = useQuery({ queryKey: [WMS, "due", wh], queryFn: () => api<Due[]>(`${WMS}/warehouses/${wh}/count-due`), enabled: !!wh });
  const counts = useQuery({ queryKey: [WMS, "counts", wh], queryFn: () => api<Count[]>(`${WMS}/warehouses/${wh}/counts`), enabled: !!wh });
  const settings = useQuery({ queryKey: [WMS, "count-settings"], queryFn: () => api<{ countDaysA: number; countDaysB: number; countDaysC: number }>(`${WMS}/count-settings`) });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  async function run<T>(fn: () => Promise<T>, done: (r: T) => void) {
    setMsg(null);
    try {
      done(await fn());
      qc.invalidateQueries({ queryKey: [WMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const byClass = (c: string) => due.data?.filter((d) => d.cls === c).length ?? 0;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Cycle counts · ${current.code}`} description={`Count bins by the class of what they hold: A every ${settings.data?.countDaysA ?? 30} days, B every ${settings.data?.countDaysB ?? 90}, C every ${settings.data?.countDaysC ?? 180}. Differences post to the exact bins.`} actions={<WarehouseSelect />} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader
          title={`Due now: ${due.data?.length ?? 0} bin(s)`}
          description={`A ${byClass("A")} · B ${byClass("B")} · C ${byClass("C")}`}
          action={can("wms.tasks.execute") && (
            <span className="flex items-end gap-2">
              <Field label="Bins this round">{(p) => <Input {...p} className="w-20" type="number" value={maxBins} onChange={(e) => setMaxBins(e.target.value)} />}</Field>
              <Button disabled={!due.data?.length} onClick={() => run(() => api<{ id: string }>(`${WMS}/counts/cycle`, { body: { warehouseId: wh, maxBins: Number(maxBins) || 30 } }), (c) => router.push(`${WMS}/counts/${c.id}`))}>Start a count</Button>
            </span>
          )}
        />
        <p className="border-t border-border px-5 py-2 text-xs text-muted">{due.data?.slice(0, 40).map((d) => `${d.code} (${d.cls})`).join(" · ")}{(due.data?.length ?? 0) > 40 && " …"}</p>
      </Card>
      <Card>
        <CardHeader title="Counts" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {counts.data?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <Link className="font-mono text-primary hover:underline" href={`${WMS}/counts/${c.id}`}>{c.number}</Link>
              <span>{c.lines} line(s){c.status === "open" && c.uncounted ? `, ${c.uncounted} to count` : ""} · {c.kind}{c.blind ? " · blind" : ""}</span>
              <span className="text-xs text-muted">{formatDate(c.createdAt.slice(0, 10))}{c.entryNumber && ` · adjustment ${c.entryNumber}`}</span>
              {c.accuracyPct && <Badge tone={Number(c.accuracyPct) >= 99.5 ? "success" : Number(c.accuracyPct) >= 95 ? "warning" : "danger"}>{c.accuracyPct} % accurate</Badge>}
              <Badge tone={c.status === "posted" ? "success" : c.status === "open" ? "primary" : "neutral"} className="ml-auto">{c.status}</Badge>
            </li>
          ))}
          {counts.data && !counts.data.length && <li className="px-5 py-4 text-center text-muted">No counts yet.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader
          title="ABC classes"
          description="A: items making up the first 80 % of the value issued in the last 12 months; B: the next 15 %; C: the rest and items not issued."
          action={<span className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => run(() => api<Abc>(`${WMS}/abc`), setAbc)}>Preview</Button>{can("wms.setup.manage") && <Button size="sm" onClick={() => run(() => api<Abc>(`${WMS}/abc`, { body: {} }), (r) => { setAbc(r); setMsg({ tone: "success", text: "Classes saved on the item storage profiles." }); })}>Recalculate and save</Button>}</span>}
        />
        {abc && (
          <>
            <p className="border-t border-border px-5 py-2 text-sm">A {abc.counts.A} · B {abc.counts.B} · C {abc.counts.C}</p>
            <ul className="max-h-80 divide-y divide-border overflow-auto border-t border-border text-sm">
              {abc.items.map((i) => <li key={i.itemId} className="flex gap-3 px-5 py-1.5"><Badge tone={i.abcClass === "A" ? "danger" : i.abcClass === "B" ? "warning" : "neutral"}>{i.abcClass}</Badge><span className="font-mono text-xs">{i.code}</span><span>{i.name}</span><span className="ml-auto tabular-nums">{formatMoney(i.value)}</span></li>)}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
