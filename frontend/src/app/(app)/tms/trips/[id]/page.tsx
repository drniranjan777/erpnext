"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MapPin, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { SignaturePad } from "@/components/service/signature-pad";
import { TripTemperatures } from "@/components/iot/trip-temperatures";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty } from "@/lib/documents";
import { mapLink, STOP_TONE, TMS, TRIP_TONE, type Stop, type Trip } from "@/lib/tms";
import { askConfirm, askText } from "@/components/ui/ask";

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pod, setPod] = useState<Stop | null>(null);
  const q = useQuery({ queryKey: [TMS, "trip", id], queryFn: () => api<Trip>(`${TMS}/trips/${id}`), refetchInterval: 60_000 });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  const t = q.data!;
  const manage = can("tms.trips.manage");
  async function act<T>(path: string, payload: unknown, done: (r: T) => void) {
    setMsg(null);
    try {
      done(await api<T>(path, { body: payload }));
      qc.invalidateQueries({ queryKey: [TMS] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  async function dispatch() {
    const odo = await askText("Odometer at start (optional)");
    if (odo === null) return;
    act<{ driverUrl: string }>(`${TMS}/trips/${id}/dispatch`, { odometerStart: odo ? Number(odo) : null }, (r) => setLink(r.driverUrl));
  }
  async function complete() {
    const odo = await askText("Odometer at the end (optional)");
    if (odo === null) return;
    act(`${TMS}/trips/${id}/complete`, { odometerEnd: odo ? Number(odo) : null }, () => setMsg({ tone: "success", text: "Trip completed." }));
  }
  const wa = link && t.driverPhone ? `https://wa.me/91${t.driverPhone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Trip ${t.number}: open this link for your drops and to record delivery ${link}`)}` : null;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href={TMS} className="text-sm text-primary hover:underline">← Trips</Link>
      <PageHeader
        title={`Trip ${t.number}`}
        description={`${formatDate(t.tripDate)} · ${t.vehicleNo}${t.vehicleType ? ` (${t.vehicleType})` : ""}${t.transporter ? ` · ${t.transporter}` : ""}${t.driverName ? ` · ${t.driverName}${t.driverPhone ? ` ${t.driverPhone}` : ""}` : ""}`}
        actions={
          <span className="flex flex-wrap gap-2">
            <Badge tone={TRIP_TONE[t.status]}>{t.status}</Badge>
            {manage && t.status === "planned" && <Button onClick={dispatch}><Send className="size-4" aria-hidden /> Dispatch</Button>}
            {manage && t.status === "planned" && <Button variant="ghost" onClick={async () => await askConfirm("Cancel this trip?") && act(`${TMS}/trips/${id}/cancel`, {}, () => setMsg({ tone: "success", text: "Cancelled." }))}>Cancel</Button>}
            {manage && t.status === "dispatched" && <Button variant="secondary" onClick={() => act<{ driverUrl: string }>(`${TMS}/trips/${id}/relink`, {}, (r) => setLink(r.driverUrl))}>New driver link</Button>}
            {manage && t.status === "dispatched" && <Button onClick={complete}>Complete</Button>}
          </span>
        }
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {link && (
        <Alert tone="success">
          <span className="block">Send the driver this link (it works until the trip is completed):</span>
          <span className="mt-1 flex flex-wrap items-center gap-2"><code className="break-all text-xs">{link}</code><button type="button" aria-label="Copy link" onClick={() => navigator.clipboard?.writeText(link)}><Copy className="size-4" aria-hidden /></button>{wa && <a className="text-sm underline" href={wa} target="_blank" rel="noreferrer">Send on WhatsApp</a>}</span>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Load</p><p className="font-semibold">{t.weightKg ? `${formatQty(t.weightKg)} kg` : "–"}</p></Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Freight</p><p className="font-semibold">{t.freightAmount ? formatMoney(t.freightAmount) : "–"}</p><p className="text-xs text-muted">{t.freightBasis}</p></Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Distance</p><p className="font-semibold">{t.odometerKm != null ? `${t.odometerKm} km (odometer)` : t.plannedKm ? `${t.plannedKm} km planned` : "–"}</p>{t.trackedKm > 0 && <p className="text-xs text-muted">{t.trackedKm} km tracked</p>}</Card>
        <Card className="px-4 py-3"><p className="text-xs uppercase text-muted">Last seen</p>{t.lastPosition ? <a className="flex items-center gap-1 text-sm text-primary hover:underline" href={mapLink(t.lastPosition.lat, t.lastPosition.lng)} target="_blank" rel="noreferrer"><MapPin className="size-4" aria-hidden />{new Date(t.lastPosition.at).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}</a> : <p className="text-sm text-muted">No position yet</p>}</Card>
      </div>
      <Card>
        <CardHeader title="Drops" />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {t.stops.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <Badge>{s.seq}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.customer}{s.deliveryId && <Link className="ml-2 font-mono text-xs text-primary hover:underline" href={`/sales/deliveries/${s.deliveryId}`}>{s.deliveryNumber}</Link>}</p>
                <p className="text-xs text-muted">{s.address}{s.packages ? ` · ${s.packages} pkg` : ""}{s.grossWeightKg && ` · ${formatQty(s.grossWeightKg)} kg`}</p>
                {s.status === "delivered" && <p className="text-xs">Received by {s.receivedBy} at {s.deliveredAt && new Date(s.deliveredAt).toLocaleString("en-IN")}{s.note && ` · ${s.note}`}{s.latitude != null && s.longitude != null && <a className="ml-1 text-primary" href={mapLink(s.latitude, s.longitude)} target="_blank" rel="noreferrer">map</a>}</p>}
                {s.status === "failed" && <p className="text-xs text-danger">{s.note}</p>}
                {/* eslint-disable-next-line @next/next/no-img-element -- a data URL captured on the phone */}
                {s.signature && <img src={s.signature} alt={`Signature of ${s.receivedBy}`} className="mt-1 h-12 rounded border border-border bg-white" />}
                {/* eslint-disable-next-line @next/next/no-img-element -- a data URL captured on the phone */}
                {s.photo && <img src={s.photo} alt="Delivery photo" className="mt-1 h-24 rounded border border-border" />}
              </div>
              <Badge tone={STOP_TONE[s.status]}>{s.status}</Badge>
              {manage && t.status === "dispatched" && ["pending", "arrived"].includes(s.status) && <Button size="sm" variant="secondary" onClick={() => setPod(s)}>Record</Button>}
            </li>
          ))}
        </ul>
      </Card>
      <Expenses trip={t} manage={manage && !t.freightBill} />
      {can("iot.data.read") && t.status !== "planned" && t.status !== "cancelled" && <TripTemperatures tripId={id} />}
      {pod && <StopDialog tripId={id} stop={pod} onClose={() => { setPod(null); qc.invalidateQueries({ queryKey: [TMS] }); }} />}
    </div>
  );
}

function Expenses({ trip, manage }: { trip: Trip; manage: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ kind: "toll", amount: "", note: "" });
  async function add() {
    await api(`${TMS}/trips/${trip.id}/expenses`, { body: { kind: f.kind, amount: Number(f.amount), note: f.note || null } }).catch(() => null);
    setF({ kind: "toll", amount: "", note: "" });
    qc.invalidateQueries({ queryKey: [TMS, "trip", trip.id] });
  }
  return (
    <Card>
      <CardHeader title="Trip expenses" description={trip.freightBill ? `Billed on ${trip.freightBill}` : "Tolls, fuel, loading: added to what the transporter's bill is checked against."} />
      <ul className="divide-y divide-border border-t border-border text-sm">
        {trip.expenses.map((e, i) => <li key={i} className="flex gap-3 px-5 py-2"><span className="capitalize">{e.kind}</span><span className="text-xs text-muted">{e.note}</span><span className="ml-auto tabular-nums">{formatMoney(e.amount)}</span></li>)}
        {!trip.expenses.length && <li className="px-5 py-3 text-muted">None.</li>}
      </ul>
      {manage && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border p-4">
          <Field label="Kind">{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{["toll", "fuel", "loading", "unloading", "parking", "other"].map((k) => <option key={k} value={k}>{k}</option>)}</Select>}</Field>
          <Field label="Amount (₹)">{(p) => <Input {...p} className="w-28" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Field label="Note">{(p) => <Input {...p} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
          <Button variant="secondary" disabled={!(Number(f.amount) > 0)} onClick={add}>Add</Button>
        </div>
      )}
    </Card>
  );
}

function StopDialog({ tripId, stop, onClose }: { tripId: string; stop: Stop; onClose: () => void }) {
  const [outcome, setOutcome] = useState<"delivered" | "failed">("delivered");
  const [f, setF] = useState({ receivedBy: "", note: "" });
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onSign = useCallback((d: string | null) => setSignature(d), []);
  async function save() {
    setError(null);
    try {
      if (outcome === "delivered") await api(`${TMS}/trips/${tripId}/stops/${stop.id}/pod`, { body: { receivedBy: f.receivedBy, note: f.note || null, signature } });
      else await api(`${TMS}/trips/${tripId}/stops/${stop.id}/fail`, { body: { note: f.note } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Drop ${stop.seq}: ${stop.customer}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={outcome === "delivered" ? f.receivedBy.trim().length < 2 : f.note.trim().length < 3}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3">
        <Field label="Outcome">{(p) => <Select {...p} value={outcome} onChange={(e) => setOutcome(e.target.value as "delivered" | "failed")}><option value="delivered">Delivered</option><option value="failed">Not delivered</option></Select>}</Field>
        {outcome === "delivered" && <Field label="Received by">{(p) => <Input {...p} value={f.receivedBy} onChange={(e) => setF({ ...f, receivedBy: e.target.value })} />}</Field>}
        <Field label={outcome === "delivered" ? "Remarks" : "Why not"}>{(p) => <Input {...p} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
        {outcome === "delivered" && <SignaturePad onChange={onSign} />}
      </div>
    </Dialog>
  );
}
