"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LOSS_LABEL, type Reason } from "@/lib/mes";
import { SkillsCard } from "./skills";

interface Shift { code: string; name: string; startMinute: number; endMinute: number; breakMinutes: number }
interface MachineRow { id: string; code: string; name: string; workCenterCode: string; idealCycleSeconds: number | null; stopAfterSeconds: number; minorStopSeconds: number; targetOeePct: number; signals: number }
interface Setup { shifts: Shift[]; reasons: Reason[]; machines: MachineRow[] }

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Shifts, downtime reasons and how each machine is monitored. */
export default function MesSetupPage() {
  const q = useQuery({ queryKey: ["/mes/setup"], queryFn: () => api<Setup>("/mes/setup") });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!q.data) return <LoadingBlock />;
  return <SetupForm key={q.dataUpdatedAt} data={q.data} msg={msg} setMsg={setMsg} />;
}

type Msg = { tone: "success" | "danger"; text: string } | null;

function SetupForm({ data, msg, setMsg }: { data: Setup; msg: Msg; setMsg: (m: Msg) => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("mes.setup.manage");
  const [shifts, setShifts] = useState<Shift[]>(data.shifts);
  const [reason, setReason] = useState({ code: "", name: "", loss: "breakdown" });
  const [machines, setMachines] = useState<Record<string, MachineRow>>(() => Object.fromEntries(data.machines.map((m) => [m.id, m])));

  async function run(fn: () => Promise<unknown>, done: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      qc.invalidateQueries({ queryKey: ["/mes/setup"] });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof ApiError ? err.message : "Could not reach the server." });
    }
  }
  const setShift = (i: number, patch: Partial<Shift>) => setShifts(shifts.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setMachine = (id: string, patch: Partial<MachineRow>) => setMachines({ ...machines, [id]: { ...machines[id], ...patch } });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Shifts, reasons, machines and skills" description="How OEE is measured: the shifts it is reported by, the reasons for stops and each machine's ideal speed and stop limits." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader title="Shifts" description="India time. A shift that ends before it starts runs past midnight. Breaks are planned time, not a loss." />
        <div className="space-y-2 border-t border-border p-4">
          {shifts.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <Input className="h-9 w-16" aria-label="Code" value={s.code} disabled={!manage} onChange={(e) => setShift(i, { code: e.target.value })} />
              <Input className="h-9 w-40" aria-label="Name" value={s.name} disabled={!manage} onChange={(e) => setShift(i, { name: e.target.value })} />
              <Input className="h-9 w-28" type="time" aria-label="Starts" value={hhmm(s.startMinute)} disabled={!manage} onChange={(e) => setShift(i, { startMinute: toMin(e.target.value) })} />
              <span>to</span>
              <Input className="h-9 w-28" type="time" aria-label="Ends" value={hhmm(s.endMinute)} disabled={!manage} onChange={(e) => setShift(i, { endMinute: toMin(e.target.value) })} />
              <Input className="h-9 w-20" type="number" min={0} aria-label="Break minutes" value={s.breakMinutes} disabled={!manage} onChange={(e) => setShift(i, { breakMinutes: Number(e.target.value) })} />
              <span className="text-muted">min break</span>
              {manage && shifts.length > 1 && <Button size="sm" variant="ghost" onClick={() => setShifts(shifts.filter((_, j) => j !== i))}>Remove</Button>}
            </div>
          ))}
          {manage && (
            <div className="flex gap-2 pt-2">
              {shifts.length < 6 && <Button size="sm" variant="ghost" onClick={() => setShifts([...shifts, { code: String.fromCharCode(65 + shifts.length), name: `Shift ${String.fromCharCode(65 + shifts.length)}`, startMinute: 0, endMinute: 480, breakMinutes: 30 }])}>Add shift</Button>}
              <Button size="sm" onClick={() => run(() => api("/mes/shifts", { method: "PUT", body: shifts }), "Shifts saved.")}>Save shifts</Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Machines" description="Ideal cycle: seconds per part when no job card gives the routing time. No part for the stop limit means the machine has stopped; stops shorter than the minor-stop limit count as minor stops (performance), longer ones as downtime." />
        <div className="overflow-x-auto"><table className="w-full border-t border-border text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2 font-medium">Machine</th><th className="px-4 py-2 font-medium">Ideal cycle (s)</th><th className="px-4 py-2 font-medium">Stopped after (s)</th><th className="px-4 py-2 font-medium">Minor stop up to (s)</th><th className="px-4 py-2 font-medium">Target OEE %</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.values(machines).map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2">{m.code} · {m.name}<span className="block text-xs text-muted">{m.signals ? `${m.signals} counter / state signal(s)` : "no counter or state signal"}</span></td>
                <td className="px-4 py-2"><Input className="h-8 w-24" type="number" step="any" min={0} aria-label="Ideal cycle seconds" disabled={!manage} value={m.idealCycleSeconds ?? ""} onChange={(e) => setMachine(m.id, { idealCycleSeconds: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                <td className="px-4 py-2"><Input className="h-8 w-24" type="number" min={10} aria-label="Stopped after seconds" disabled={!manage} value={m.stopAfterSeconds} onChange={(e) => setMachine(m.id, { stopAfterSeconds: Number(e.target.value) })} /></td>
                <td className="px-4 py-2"><Input className="h-8 w-24" type="number" min={0} aria-label="Minor stop seconds" disabled={!manage} value={m.minorStopSeconds} onChange={(e) => setMachine(m.id, { minorStopSeconds: Number(e.target.value) })} /></td>
                <td className="px-4 py-2"><Input className="h-8 w-20" type="number" min={1} max={100} aria-label="Target OEE" disabled={!manage} value={m.targetOeePct} onChange={(e) => setMachine(m.id, { targetOeePct: Number(e.target.value) })} /></td>
                <td className="px-4 py-2 text-right">{manage && <Button size="sm" variant="ghost" onClick={() => run(() => api(`/mes/machines/${m.id}/settings`, { method: "PUT", body: { idealCycleSeconds: m.idealCycleSeconds, stopAfterSeconds: m.stopAfterSeconds, minorStopSeconds: m.minorStopSeconds, targetOeePct: m.targetOeePct } }), `${m.code} saved.`)}>Save</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>

      <Card>
        <CardHeader title="Downtime reasons" description="Each reason belongs to one of the six big losses, or is planned (not a loss)." />
        <ul className="divide-y divide-border border-t border-border text-sm">
          {data.reasons.map((r) => (
            <li key={r.id} className={`flex items-center gap-3 px-4 py-1.5 ${r.isActive ? "" : "opacity-50"}`}>
              <span className="w-16 font-mono text-xs">{r.code}</span>
              <span className="flex-1">{r.name}</span>
              <span className="text-xs text-muted">{LOSS_LABEL[r.loss] ?? r.loss}</span>
              {manage && <Button size="sm" variant="ghost" onClick={() => run(() => api(`/mes/reasons/${r.id}`, { method: "PUT", body: { code: r.code, name: r.name, loss: r.loss, isActive: !r.isActive } }), "Saved.")}>{r.isActive ? "Retire" : "Use again"}</Button>}
            </li>
          ))}
        </ul>
        {manage && (
          <form className="flex flex-wrap gap-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); run(() => api("/mes/reasons", { body: reason }), "Reason added.").then(() => setReason({ code: "", name: "", loss: reason.loss })); }}>
            <Input className="h-9 w-24" aria-label="Code" placeholder="Code" value={reason.code} onChange={(e) => setReason({ ...reason, code: e.target.value })} />
            <Input className="h-9 flex-1" aria-label="Name" placeholder="Reason" value={reason.name} onChange={(e) => setReason({ ...reason, name: e.target.value })} />
            <Select className="h-9 w-56" aria-label="Loss" value={reason.loss} onChange={(e) => setReason({ ...reason, loss: e.target.value })}>{["breakdown", "setup", "minor_stop", "speed", "defects", "startup", "other", "planned"].map((l) => <option key={l} value={l}>{LOSS_LABEL[l] ?? l}</option>)}</Select>
            <Button type="submit" disabled={!reason.code || reason.name.length < 2}>Add</Button>
          </form>
        )}
      </Card>
      <SkillsCard />
    </div>
  );
}
