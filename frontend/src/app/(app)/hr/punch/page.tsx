"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, MapPin } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError, apiUpload } from "@/lib/api";
import { HR } from "@/lib/hr";

interface Me { employee: { id: string; code: string; fullName: string }; today: string; punches: { punchedAt: string; source: string; insideFence: boolean | null }[]; day: { status: string; workedMinutes: number } | null; location: { name: string; hasFence: boolean; radiusMetres: number | null } | null }

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Punch in or out from a phone: the location is checked against the work location's geofence and a selfie is kept. */
export default function PunchPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [HR, "me"], queryFn: () => api<Me>(`${HR}/me`), retry: false });
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);

  function position(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("This device cannot share its location"));
      navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Allow location access to punch")), { enableHighAccuracy: true, timeout: 20_000 });
    });
  }

  async function punch(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const pos = await position();
      const r = await apiUpload<{ punchedAt: string; insideFence: boolean | null; distanceMetres: number | null }>(`${HR}/attendance/mobile`, file, {
        latitude: String(pos.coords.latitude),
        longitude: String(pos.coords.longitude),
        accuracy: String(Math.round(pos.coords.accuracy)),
      });
      setMsg(r.insideFence === false ? { tone: "warning", text: `Punched at ${time(r.punchedAt)}, but ${r.distanceMetres} m from the workplace. HR will review it.` } : { tone: "success", text: `Punched at ${time(r.punchedAt)}.` });
      qc.invalidateQueries({ queryKey: [HR, "me"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError || err instanceof Error ? err.message : "Could not punch" });
    } finally {
      setBusy(false);
      if (camera.current) camera.current.value = "";
    }
  }

  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const me = q.data!;
  const next = me.punches.length % 2 === 0 ? "in" : "out";
  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader title="Punch" description={`${me.employee.fullName} · ${me.employee.code}`} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card className="flex flex-col items-center gap-4 px-5 py-8">
        <p className="flex items-center gap-1 text-sm text-muted"><MapPin className="size-4" aria-hidden /> {me.location ? `${me.location.name}${me.location.hasFence ? ` · within ${me.location.radiusMetres} m` : ""}` : "No work location set"}</p>
        <input ref={camera} type="file" accept="image/*" capture="user" className="hidden" aria-label="Selfie" onChange={(e) => e.target.files?.[0] && punch(e.target.files[0])} />
        <Button className="h-16 w-56 text-lg" disabled={busy} onClick={() => camera.current?.click()}><Camera className="size-5" aria-hidden /> {busy ? "Punching…" : `Punch ${next}`}</Button>
        <p className="text-xs text-muted">Takes a selfie and your location.</p>
      </Card>
      <Card>
        <CardHeader title="Today" description={me.day ? `${me.day.status.replace("_", " ")} · ${Math.floor(me.day.workedMinutes / 60)}h ${me.day.workedMinutes % 60}m` : undefined} />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {me.punches.map((p, i) => (
            <li key={p.punchedAt} className="flex items-center gap-3 px-5 py-2">
              <span className="w-10 text-muted">{i % 2 ? "Out" : "In"}</span>
              <span className="font-medium tabular-nums">{time(p.punchedAt)}</span>
              <span className="text-xs text-muted">{p.source}</span>
              {p.insideFence === false && <Badge tone="warning">outside fence</Badge>}
            </li>
          ))}
          {!me.punches.length && <li className="px-5 py-3 text-muted">No punches yet today.</li>}
        </ul>
      </Card>
      <p className="text-center text-sm"><Link className="text-primary hover:underline" href={`${HR}/leave`}>Leave</Link> · <Link className="text-primary hover:underline" href={`${HR}/regularisations`}>Regularise a day</Link></p>
    </div>
  );
}
