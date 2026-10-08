"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, MapPin, Phone, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { SignaturePad } from "@/components/service/signature-pad";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { LoadingBlock } from "@/components/ui/page";
import { STOP_TONE, type Stop, type Trip } from "@/lib/tms";
import { askText } from "@/components/ui/ask";

/** Public, no login: the link from the dispatcher is the key. */
async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/public/trips/${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { detail?: string; title?: string } | null)?.detail ?? (data as { title?: string } | null)?.title ?? "Something went wrong");
  return data as T;
}

export default function DriverPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Driver />
    </Suspense>
  );
}

function Driver() {
  const token = useSearchParams().get("t") ?? "";
  const key = encodeURIComponent(token);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["driver", token], queryFn: () => call<Trip>(key), enabled: token.length >= 40, retry: false, refetchInterval: 120_000 });
  const [tracking, setTracking] = useState<"off" | "on" | "denied">("off");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // While the page is open, send the phone's position every couple of minutes.
  useEffect(() => {
    if (tracking !== "on" || !navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - last < 120_000) return;
        last = Date.now();
        call(`${key}/positions`, { latitude: p.coords.latitude, longitude: p.coords.longitude, speedKmh: p.coords.speed != null ? Math.round(p.coords.speed * 3.6) : null }).catch(() => null);
      },
      () => setTracking("denied"),
      { enableHighAccuracy: true, maximumAge: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking, key]);

  if (token.length < 40) return <div className="p-4"><Alert>Open the link the dispatcher sent you.</Alert></div>;
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <div className="p-4"><Alert>{(q.error as Error).message}</Alert></div>;
  const t = q.data!;
  async function act(path: string, body: unknown) {
    setError(null);
    try {
      await call(`${key}/${path}`, body);
      setOpen(null);
      qc.invalidateQueries({ queryKey: ["driver", token] });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const left = t.stops.filter((s) => ["pending", "arrived"].includes(s.status)).length;
  return (
    <div className="mx-auto min-h-screen max-w-md space-y-3 bg-surface-muted p-3">
      <Card className="p-4">
        <p className="text-lg font-semibold">Trip {t.number}</p>
        <p className="text-sm text-muted">{t.vehicleNo} · {t.stops.length} drop(s), {left} left</p>
        {tracking === "off" && <Button className="mt-3 w-full" onClick={() => setTracking("on")}><MapPin className="size-4" aria-hidden /> Share my location</Button>}
        {tracking === "on" && <p className="mt-2 text-xs text-success">Sharing location while this page is open.</p>}
        {tracking === "denied" && <p className="mt-2 text-xs text-danger">Location is blocked on this phone.</p>}
      </Card>
      {error && <Alert>{error}</Alert>}
      {t.stops.map((s) => (
        <Card key={s.id} className="space-y-2 p-4">
          <div className="flex items-start gap-2">
            <Badge>{s.seq}</Badge>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.customer}</p>
              <p className="text-sm text-muted">{s.address}</p>
              <p className="text-xs text-muted">{s.deliveryNumber}{s.packages ? ` · ${s.packages} packages` : ""}</p>
            </div>
            <Badge tone={STOP_TONE[s.status]}>{s.status}</Badge>
          </div>
          {s.phone && <a className="flex items-center gap-1 text-sm text-primary" href={`tel:${s.phone}`}><Phone className="size-4" aria-hidden /> Call {s.phone}</a>}
          {["pending", "arrived"].includes(s.status) && t.status === "dispatched" && (
            open === s.id ? (
              <Pod stop={s} onDeliver={(b) => act(`stops/${s.id}/pod`, b)} onFail={(note) => act(`stops/${s.id}/fail`, { note })} onCancel={() => setOpen(null)} />
            ) : (
              <div className="flex gap-2">
                {s.status === "pending" && <Button variant="secondary" className="flex-1" onClick={() => act(`stops/${s.id}/arrive`, {})}>Arrived</Button>}
                <Button className="flex-1" onClick={() => setOpen(s.id)}>Deliver</Button>
              </div>
            )
          )}
          {s.status === "delivered" && <p className="flex items-center gap-1 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden /> Received by {s.receivedBy}</p>}
          {s.status === "failed" && <p className="flex items-center gap-1 text-sm text-danger"><XCircle className="size-4" aria-hidden /> {s.note}</p>}
        </Card>
      ))}
      {left === 0 && <Alert tone="success">All drops done. Thank you!</Alert>}
    </div>
  );
}

function Pod({ stop, onDeliver, onFail, onCancel }: { stop: Stop; onDeliver: (b: unknown) => void; onFail: (note: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const onSign = useCallback((d: string | null) => setSignature(d), []);
  function pickPhoto(file: File | undefined) {
    if (!file) return;
    // Shrink to 1280 px on the long side to keep uploads small on mobile data.
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      setPhoto(c.toDataURL("image/jpeg", 0.7));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }
  function deliver() {
    const send = (lat: number | null, lng: number | null) => onDeliver({ receivedBy: name, note: note || null, signature, photo, latitude: lat, longitude: lng });
    if (!navigator.geolocation) return send(null, null);
    navigator.geolocation.getCurrentPosition((p) => send(p.coords.latitude, p.coords.longitude), () => send(null, null), { timeout: 5000 });
  }
  return (
    <div className="space-y-2 rounded-lg bg-surface-muted p-3">
      <Field label="Received by">{(p) => <Input {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Remarks">{(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <SignaturePad onChange={onSign} />
      <label className="block text-sm">Photo of the goods or signed copy <input type="file" accept="image/*" capture="environment" className="mt-1 block text-xs" onChange={(e) => pickPhoto(e.target.files?.[0])} /></label>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={name.trim().length < 2} onClick={deliver}>Delivered</Button>
        <Button variant="secondary" onClick={async () => { const why = await askText(`Why could ${stop.customer} not take it?`); if (why && why.trim().length >= 3) onFail(why); }}>Not delivered</Button>
        <Button variant="ghost" onClick={onCancel}>Back</Button>
      </div>
    </div>
  );
}
