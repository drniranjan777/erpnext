"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney, formatQty, todayIST } from "@/lib/documents";
import { TMS, TRIP_TONE } from "@/lib/tms";

interface Row { id: string; number: string; tripDate: string; status: string; vehicleNo: string; vehicleType: string | null; driverName: string | null; transporter: string | null; weightKg: string | null; freightAmount: string | null; stops: number; delivered: number; lastSeen: string | null }
interface Unplanned { id: string; number: string; docDate: string; customer: string; city: string | null; grossWeightKg: string | null; packages: number | null; warehouse: string | null }
interface Vehicle { id: string; regNo: string; vehicleType: string; capacityKg: string | null; transporter: string | null; isActive: boolean }
interface Transporter { id: string; name: string; isActive: boolean }

export default function TripsPage() {
  const { can } = useAuth();
  const [planning, setPlanning] = useState(false);
  const [from, setFrom] = useState(() => new Date(Date.parse(todayIST()) - 7 * 86_400_000).toISOString().slice(0, 10));
  const q = useQuery({ queryKey: [TMS, "trips", from], queryFn: () => api<Row[]>(`${TMS}/trips`, { query: { from } }) });
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Trips" description="Trip sheets of delivery notes: freight from the transporter's contract, the driver's link for tracking and proof of delivery." actions={can("tms.trips.manage") && <Button onClick={() => setPlanning(!planning)}><Plus className="size-4" aria-hidden /> Plan a trip</Button>} />
      {planning && <Plan onDone={() => setPlanning(false)} />}
      <Input className="h-9 w-44" type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
      <Card>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted"><tr><th className="px-4 py-2 font-medium">Trip</th><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Vehicle</th><th className="px-4 py-2 font-medium">Drops</th><th className="px-4 py-2 text-right font-medium">Weight</th><th className="px-4 py-2 text-right font-medium">Freight</th><th className="px-4 py-2 font-medium" /></tr></thead>
          <tbody className="divide-y divide-border">
            {q.data?.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2"><Link className="font-mono text-primary hover:underline" href={`${TMS}/trips/${t.id}`}>{t.number}</Link></td>
                <td className="px-4 py-2">{formatDate(t.tripDate)}</td>
                <td className="px-4 py-2">{t.vehicleNo}<span className="block text-xs text-muted">{[t.vehicleType, t.transporter, t.driverName].filter(Boolean).join(" · ")}</span></td>
                <td className="px-4 py-2">{t.delivered}/{t.stops}{t.lastSeen && <span className="block text-xs text-muted">seen {new Date(t.lastSeen).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{t.weightKg ? `${formatQty(t.weightKg)} kg` : "–"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{t.freightAmount ? formatMoney(t.freightAmount) : "–"}</td>
                <td className="px-4 py-2 text-right"><Badge tone={TRIP_TONE[t.status]}>{t.status}</Badge></td>
              </tr>
            ))}
            {q.data && !q.data.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No trips.</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}

function Plan({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const un = useQuery({ queryKey: [TMS, "unplanned"], queryFn: () => api<Unplanned[]>(`${TMS}/unplanned`) });
  const vehicles = useQuery({ queryKey: [TMS, "vehicles"], queryFn: () => api<Vehicle[]>(`${TMS}/vehicles`) });
  const transporters = useQuery({ queryKey: [TMS, "transporters"], queryFn: () => api<Transporter[]>(`${TMS}/transporters`) });
  const [chosen, setChosen] = useState<string[]>([]);
  const [f, setF] = useState({ vehicleId: "", vehicleNo: "", vehicleType: "", transporterId: "", driverName: "", driverPhone: "", plannedKm: "", tripDate: todayIST() });
  const [error, setError] = useState<string | null>(null);
  const weight = chosen.reduce((s, id) => s + Number(un.data?.find((d) => d.id === id)?.grossWeightKg ?? 0), 0);
  const v = vehicles.data?.find((x) => x.id === f.vehicleId);
  async function save() {
    setError(null);
    try {
      const t = await api<{ id: string }>(`${TMS}/trips`, {
        body: { tripDate: f.tripDate, vehicleId: f.vehicleId || null, vehicleNo: f.vehicleId ? undefined : f.vehicleNo, vehicleType: f.vehicleType || null, transporterId: f.transporterId || null, driverName: f.driverName || null, driverPhone: f.driverPhone || null, plannedKm: f.plannedKm ? Number(f.plannedKm) : null, deliveryIds: chosen },
      });
      onDone();
      router.push(`${TMS}/trips/${t.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="Plan a trip" description="Tick the deliveries in drop order (the last one sets the lane for freight)." />
      <div className="space-y-4 border-t border-border p-4">
        {error && <Alert>{error}</Alert>}
        <ul className="max-h-72 divide-y divide-border overflow-auto rounded-lg border border-border text-sm">
          {un.data?.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
              <input type="checkbox" aria-label={`Add ${d.number}`} checked={chosen.includes(d.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, d.id] : chosen.filter((x) => x !== d.id))} />
              {chosen.includes(d.id) && <Badge tone="primary">{chosen.indexOf(d.id) + 1}</Badge>}
              <span className="font-mono text-xs">{d.number}</span>
              <span>{d.customer}</span>
              <span className="text-xs text-muted">{d.city}{d.grossWeightKg && ` · ${formatQty(d.grossWeightKg)} kg`}{d.packages ? ` · ${d.packages} pkg` : ""}</span>
            </li>
          ))}
          {un.data && !un.data.length && <li className="px-3 py-4 text-center text-muted">No posted deliveries waiting for a trip.</li>}
        </ul>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">{(p) => <Input {...p} type="date" value={f.tripDate} onChange={(e) => setF({ ...f, tripDate: e.target.value })} />}</Field>
          <Field label="Vehicle">{(p) => <Select {...p} value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}><option value="">Other (type the number)</option>{vehicles.data?.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.regNo} · {x.vehicleType}{x.transporter ? ` · ${x.transporter}` : ""}</option>)}</Select>}</Field>
          {!f.vehicleId && <Field label="Vehicle number">{(p) => <Input {...p} value={f.vehicleNo} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} />}</Field>}
          {!f.vehicleId && <Field label="Vehicle type">{(p) => <Input {...p} placeholder="407, 17ft, 32ft_sxl…" value={f.vehicleType} onChange={(e) => setF({ ...f, vehicleType: e.target.value })} />}</Field>}
          <Field label="Transporter" hint={v?.transporter ? `Default: ${v.transporter}` : undefined}>{(p) => <Select {...p} value={f.transporterId} onChange={(e) => setF({ ...f, transporterId: e.target.value })}><option value="">{v?.transporter ? "The vehicle's" : "Own / none"}</option>{transporters.data?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
          <Field label="Planned km">{(p) => <Input {...p} inputMode="numeric" value={f.plannedKm} onChange={(e) => setF({ ...f, plannedKm: e.target.value })} />}</Field>
          <Field label="Driver">{(p) => <Input {...p} placeholder="Name" value={f.driverName} onChange={(e) => setF({ ...f, driverName: e.target.value })} />}</Field>
          <Field label="Driver phone">{(p) => <Input {...p} inputMode="tel" value={f.driverPhone} onChange={(e) => setF({ ...f, driverPhone: e.target.value })} />}</Field>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">{chosen.length} drop(s) · {formatQty(weight)} kg{v?.capacityKg && weight > Number(v.capacityKg) ? ` · over ${v.regNo}'s ${formatQty(v.capacityKg)} kg` : ""}</span>
          <Button disabled={!chosen.length || (!f.vehicleId && f.vehicleNo.trim().length < 6)} onClick={save}>Create trip</Button>
        </div>
      </div>
    </Card>
  );
}
