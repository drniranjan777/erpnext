"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ScanLine } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { WMS } from "@/lib/wms";

interface Loading { id: string; number: string | null; status: string; vehicleNo: string | null; customer: string; loaded: number; total: number; packages: { id: string; sscc: string; kind: string; status: string; grossWeightKg: string | null; vehicleNo: string | null }[] }

export default function LoadingPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Load />
    </Suspense>
  );
}

/** Scan every carton of a delivery as it goes on the vehicle; a carton of another delivery is refused. */
function Load() {
  const qc = useQueryClient();
  const delivery = useSearchParams().get("delivery");
  const [code, setCode] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const q = useQuery({ queryKey: [WMS, "loading", delivery], queryFn: () => api<Loading>(`${WMS}/deliveries/${delivery}/loading`), enabled: !!delivery });
  if (!delivery) return <Alert>Open loading from a wave or a delivery note.</Alert>;
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  async function scan(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim();
    setCode("");
    if (!c) return;
    try {
      const r = await api<{ sscc: string; remaining: number }>(`${WMS}/loading`, { body: { deliveryId: delivery, code: c, vehicleNo: vehicle || d.vehicleNo } });
      setMsg({ tone: "success", text: r.remaining ? `${r.sscc} loaded; ${r.remaining} to go.` : `${r.sscc} loaded. All cartons are on the vehicle.` });
      qc.invalidateQueries({ queryKey: [WMS, "loading", delivery] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={`Loading · ${d.number ?? "draft delivery"}`} description={`${d.customer} · ${d.loaded} of ${d.total} cartons loaded`} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Field label="Vehicle">{(p) => <Input {...p} placeholder={d.vehicleNo ?? "Vehicle number"} value={vehicle} onChange={(e) => setVehicle(e.target.value)} />}</Field>
      <form className="flex gap-2" onSubmit={scan}>
        <Input className="h-11 flex-1 font-mono" autoFocus placeholder="Scan the carton label (SSCC)" aria-label="SSCC" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" size="lg" aria-label="Look up"><ScanLine className="size-5" aria-hidden /></Button>
      </form>
      <Card>
        <CardHeader title="Cartons" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {d.packages.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-2">
              {p.status === "loaded" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <span className="size-4" />}
              <span className="font-mono">{p.sscc}</span>
              <span className="text-xs text-muted">{p.kind}{p.grossWeightKg && ` · ${Number(p.grossWeightKg)} kg`}</span>
              <Badge tone={p.status === "loaded" ? "success" : "neutral"} className="ml-auto">{p.status === "loaded" ? `on ${p.vehicleNo ?? "vehicle"}` : "to load"}</Badge>
            </li>
          ))}
          {!d.packages.length && <li className="px-5 py-4 text-center text-muted">No cartons were packed for this delivery.</li>}
        </ul>
      </Card>
    </div>
  );
}
