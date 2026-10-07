"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Suspense, useState } from "react";
import { NoWmsWarehouse, WarehouseSelect } from "@/components/wms/warehouse-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { todayIST } from "@/lib/documents";
import { useWarehouseParam, WMS } from "@/lib/wms";

interface Door { id: string; code: string; name: string; direction: string; isActive: boolean }
interface Appt { id: string; number: string; direction: string; status: string; doorId: string; door: string; party: string | null; documentNumber: string | null; reference: string | null; vehicleNo: string | null; startsAt: string; endsAt: string }
const TONE = { booked: "primary", arrived: "warning", in_progress: "warning", done: "success", no_show: "danger", cancelled: "neutral" } as const;
const NEXT: Record<string, string[]> = { booked: ["arrived", "no_show", "cancelled"], arrived: ["in_progress", "done"], in_progress: ["done"] };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });

export default function DocksPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Docks />
    </Suspense>
  );
}

function Docks() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { wh, loading, current } = useWarehouseParam();
  const [date, setDate] = useState(todayIST);
  const [dialog, setDialog] = useState<"door" | "book" | null>(null);
  const doors = useQuery({ queryKey: [WMS, "doors", wh], queryFn: () => api<Door[]>(`${WMS}/warehouses/${wh}/doors`), enabled: !!wh });
  const appts = useQuery({ queryKey: [WMS, "appointments", wh, date], queryFn: () => api<Appt[]>(`${WMS}/warehouses/${wh}/appointments`, { query: { date } }), enabled: !!wh });
  if (loading) return <LoadingBlock />;
  if (!wh || !current) return <NoWmsWarehouse />;
  async function set(a: Appt, status: string) {
    await api(`${WMS}/appointments/${a.id}/status`, { body: { status } }).catch(() => null);
    qc.invalidateQueries({ queryKey: [WMS, "appointments"] });
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Dock schedule · ${current.code}`} description="Book unloading and loading slots per door so vehicles do not queue. Overlapping bookings on a door are refused." actions={<><WarehouseSelect />{can("wms.tasks.execute") && <Button onClick={() => setDialog("book")} disabled={!doors.data?.length}><Plus className="size-4" aria-hidden /> Book a slot</Button>}</>} />
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-44" type="date" aria-label="Day" value={date} onChange={(e) => setDate(e.target.value)} />
        <span className="text-sm text-muted">{doors.data?.filter((d) => d.isActive).map((d) => `${d.code} (${d.direction})`).join(" · ")}</span>
        {can("wms.setup.manage") && <Button size="sm" variant="ghost" onClick={() => setDialog("door")}>Add a door</Button>}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {doors.data?.filter((d) => d.isActive).map((d) => (
          <Card key={d.id}>
            <CardHeader title={`${d.code} · ${d.name}`} description={d.direction} />
            <ul className="divide-y divide-border border-t border-border text-sm">
              {appts.data?.filter((a) => a.doorId === d.id).map((a) => (
                <li key={a.id} className="space-y-1 px-4 py-2">
                  <p className="flex items-center gap-2"><span className="font-medium tabular-nums">{time(a.startsAt)}–{time(a.endsAt)}</span><Badge>{a.direction}</Badge><Badge tone={TONE[a.status as keyof typeof TONE]} className="ml-auto">{a.status.replace("_", " ")}</Badge></p>
                  <p className="text-xs text-muted">{[a.number, a.party, a.vehicleNo, a.documentNumber, a.reference].filter(Boolean).join(" · ")}</p>
                  {can("wms.tasks.execute") && NEXT[a.status] && <p className="flex flex-wrap gap-1">{NEXT[a.status].map((s) => <Button key={s} size="sm" variant="ghost" onClick={() => set(a, s)}>{s.replace("_", " ")}</Button>)}</p>}
                </li>
              ))}
              {appts.data && !appts.data.some((a) => a.doorId === d.id) && <li className="px-4 py-4 text-center text-muted">Free all day.</li>}
            </ul>
          </Card>
        ))}
      </div>
      {dialog === "door" && <DoorDialog wh={wh} onClose={() => { setDialog(null); qc.invalidateQueries({ queryKey: [WMS, "doors"] }); }} />}
      {dialog === "book" && <BookDialog doors={(doors.data ?? []).filter((d) => d.isActive)} date={date} onClose={() => { setDialog(null); qc.invalidateQueries({ queryKey: [WMS, "appointments"] }); }} />}
    </div>
  );
}

function DoorDialog({ wh, onClose }: { wh: string; onClose: () => void }) {
  const [f, setF] = useState({ code: "", name: "", direction: "both" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${WMS}/doors`, { body: { warehouseId: wh, ...f } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title="New dock door" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code">{(p) => <Input {...p} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label="Name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Used for">{(p) => <Select {...p} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="both">Both</option><option value="inbound">Unloading</option><option value="outbound">Loading</option></Select>}</Field>
      </div>
    </Dialog>
  );
}

function BookDialog({ doors, date, onClose }: { doors: Door[]; date: string; onClose: () => void }) {
  const [f, setF] = useState({ doorId: doors[0]?.id ?? "", direction: doors[0]?.direction === "outbound" ? "outbound" : "inbound", time: "10:00", minutes: "60", vehicleNo: "", reference: "" });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    try {
      await api(`${WMS}/appointments`, { body: { doorId: f.doorId, direction: f.direction, startsAt: `${date}T${f.time}:00+05:30`, minutes: Number(f.minutes), vehicleNo: f.vehicleNo || null, reference: f.reference || null } });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Dialog open onClose={onClose} title={`Book a slot on ${date}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Book</Button></>}>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Door">{(p) => <Select {...p} value={f.doorId} onChange={(e) => setF({ ...f, doorId: e.target.value })}>{doors.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}</Select>}</Field>
        <Field label="For">{(p) => <Select {...p} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="inbound">Unloading</option><option value="outbound">Loading</option></Select>}</Field>
        <Field label="From">{(p) => <Input {...p} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}</Field>
        <Field label="Minutes">{(p) => <Input {...p} type="number" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />}</Field>
        <Field label="Vehicle">{(p) => <Input {...p} value={f.vehicleNo} onChange={(e) => setF({ ...f, vehicleNo: e.target.value })} />}</Field>
        <Field label="Reference" hint="PO, order or ASN number">{(p) => <Input {...p} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
