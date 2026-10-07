"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, MapPin, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError, apiUpload } from "@/lib/api";
import { DMS } from "@/lib/dms";
import { inr } from "@/lib/payroll";

interface Outlet { id: string; code: string; name: string; ownerName: string | null; phone: string | null; address: string | null; beatId: string; visit: { id: string; checkInAt: string; checkOutAt: string | null; outcome: string | null } | null }
interface Day { date: string; beats: { id: string; code: string; name: string }[]; outlets: Outlet[] }

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** The salesperson's phone screen: today's beat, check in with location and a shelf photo, book the order, check out. */
export default function FieldPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [DMS, "field"], queryFn: () => api<Day>(`${DMS}/field/day`) });
  const items = useQuery({ queryKey: ["/masters/items", "all"], queryFn: () => api<{ items: { id: string; code: string; name: string }[] }>(`/masters/items`, { query: { limit: 200 } }), retry: false });
  const camera = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const [lines, setLines] = useState([{ itemId: "", qty: "" }]);
  const refresh = () => qc.invalidateQueries({ queryKey: [DMS, "field"] });
  const where = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("This phone cannot share its location"));
      navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Allow location access to check in")), { enableHighAccuracy: true, timeout: 20_000 });
    });
  async function checkIn(file: File | null) {
    if (!target) return;
    setBusy(true);
    setMsg(null);
    try {
      const pos = await where();
      const fields = { retailerId: target, latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) };
      const v = file ? await apiUpload<{ farFromOutlet: boolean; distanceMetres: number | null }>(`${DMS}/field/visits`, file, fields) : await api<{ farFromOutlet: boolean; distanceMetres: number | null }>(`${DMS}/field/visits`, { body: { ...fields, latitude: Number(fields.latitude), longitude: Number(fields.longitude) } });
      setMsg(v.farFromOutlet ? { tone: "warning", text: `Checked in ${v.distanceMetres} m from the outlet's recorded location.` } : { tone: "success", text: "Checked in." });
      refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError || err instanceof Error ? err.message : "Could not check in" });
    } finally {
      setBusy(false);
      setTarget(null);
      if (camera.current) camera.current.value = "";
    }
  }
  async function order(visitId: string) {
    setMsg(null);
    try {
      const s = await api<{ number: string; net: string; discount: string }>(`${DMS}/field/visits/${visitId}/order`, { body: { lines: lines.filter((l) => l.itemId && Number(l.qty)).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) } });
      setMsg({ tone: "success", text: `Order ${s.number} booked: ${inr(s.net)}${Number(s.discount) ? ` after ${inr(s.discount)} of schemes` : ""}.` });
      setLines([{ itemId: "", qty: "" }]);
      refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not book the order" });
    }
  }
  async function checkOut(visitId: string, outcome: string) {
    setMsg(null);
    try {
      await api(`${DMS}/field/visits/${visitId}/check-out`, { body: { outcome } });
      refresh();
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not check out" });
    }
  }
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const d = q.data!;
  const open = d.outlets.find((o) => o.visit && !o.visit.checkOutAt);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageHeader title="My beat" description={d.beats.length ? d.beats.map((b) => b.name).join(", ") : "No beat for today"} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Shelf photo" onChange={(e) => checkIn(e.target.files?.[0] ?? null)} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {open && (
        <Card>
          <CardHeader title={`At ${open.name}`} description={`Since ${time(open.visit!.checkInAt)}`} />
          <div className="space-y-2 border-t border-border p-4">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Select aria-label="Item" className="flex-1" value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}><option value="">Item…</option>{items.data?.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</Select>
                <Input aria-label="Quantity" className="w-20" inputMode="numeric" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { itemId: "", qty: "" }])}><Plus className="size-4" aria-hidden /> Line</Button>
              <Button size="sm" disabled={!lines.some((l) => l.itemId && Number(l.qty))} onClick={() => order(open.visit!.id)}>Book order</Button>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-2">
              <Button size="sm" variant="secondary" onClick={() => checkOut(open.visit!.id, "order")}>Check out</Button>
              <Button size="sm" variant="ghost" onClick={() => checkOut(open.visit!.id, "no_order")}>No order</Button>
              <Button size="sm" variant="ghost" onClick={() => checkOut(open.visit!.id, "closed")}>Shop closed</Button>
            </div>
          </div>
        </Card>
      )}
      <Card>
        <ul className="divide-y divide-border text-sm">
          {d.outlets.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1"><span className="font-medium">{o.name}</span><span className="block text-xs text-muted">{[o.ownerName, o.phone, o.address].filter(Boolean).join(" · ")}</span></span>
              {o.visit ? <Badge tone={o.visit.outcome === "order" ? "success" : o.visit.checkOutAt ? "neutral" : "warning"}>{o.visit.checkOutAt ? (o.visit.outcome ?? "visited").replace("_", " ") : "here"}</Badge> : !open && <Button size="sm" disabled={busy} onClick={() => { setTarget(o.id); camera.current?.click(); }}><Camera className="size-4" aria-hidden /> Check in</Button>}
            </li>
          ))}
          {!d.outlets.length && <li className="px-4 py-6 text-center text-muted">No outlets on today&apos;s beat.</li>}
        </ul>
      </Card>
      {target === null && !open && d.outlets.some((o) => !o.visit) && <p className="flex items-center justify-center gap-1 text-xs text-muted"><MapPin className="size-3" aria-hidden /> Check-in records your location and a photo of the shelf.</p>}
    </div>
  );
}
