"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface Skill { id: string; operatorName: string; workCenterId: string; workCenterCode: string; workCenterName: string; level: number; validUntil: string | null; expired: boolean }
interface WorkCenter { id: string; code: string; name: string }

const LEVEL = ["", "Trainee", "Qualified", "Expert", "Trainer"];

/** Operator skills per work centre: once any skill is recorded for a work centre, only qualified operators can start jobs there. */
export function SkillsCard() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can("mes.instructions.manage");
  const skills = useQuery({ queryKey: ["/mes/skills"], queryFn: () => api<Skill[]>("/mes/skills") });
  const wcs = useQuery({ queryKey: ["/manufacturing/work-centers"], queryFn: () => api<WorkCenter[]>("/manufacturing/work-centers") });
  const [f, setF] = useState({ operatorName: "", workCenterId: "", level: "2", validUntil: "" });
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/mes/skills"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  return (
    <Card>
      <CardHeader title="Operator skills" description="Once a work centre has any recorded skill, only operators qualified there (not trainees, not expired) can start jobs on its machines from the terminal." />
      {error && <div className="px-4 pb-2"><Alert>{error}</Alert></div>}
      <ul className="divide-y divide-border border-t border-border text-sm">
        {skills.data?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-1.5">
            <span className="w-40 font-medium">{s.operatorName}</span>
            <span className="flex-1">{s.workCenterCode} · {s.workCenterName}</span>
            <Badge tone={s.level >= 2 ? "success" : "warning"}>{LEVEL[s.level]}</Badge>
            <span className={`w-28 text-xs ${s.expired ? "text-danger" : "text-muted"}`}>{s.validUntil ? `${s.expired ? "expired" : "until"} ${s.validUntil}` : "no expiry"}</span>
            {manage && <Button size="sm" variant="ghost" onClick={() => run(() => api(`/mes/skills/${s.id}`, { method: "DELETE" }))}>Remove</Button>}
          </li>
        ))}
        {skills.data && !skills.data.length && <li className="px-4 py-4 text-center text-muted">No skills recorded: anyone can run any machine.</li>}
      </ul>
      {manage && (
        <form className="flex flex-wrap gap-2 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); run(() => api("/mes/skills", { body: { operatorName: f.operatorName, workCenterId: f.workCenterId, level: Number(f.level), validUntil: f.validUntil || null } })).then(() => setF({ ...f, operatorName: "" })); }}>
          <Input className="h-9 w-44" aria-label="Operator" placeholder="Operator name" value={f.operatorName} onChange={(e) => setF({ ...f, operatorName: e.target.value })} />
          <Select className="h-9 w-56" aria-label="Work centre" value={f.workCenterId} onChange={(e) => setF({ ...f, workCenterId: e.target.value })}><option value="">Work centre…</option>{wcs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</Select>
          <Select className="h-9 w-32" aria-label="Level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>{LEVEL[l]}</option>)}</Select>
          <Input className="h-9 w-40" type="date" aria-label="Valid until" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
          <Button type="submit" disabled={!f.operatorName.trim() || !f.workCenterId}>Add</Button>
        </form>
      )}
    </Card>
  );
}
