"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CALL_LABEL, duration, pct, STATE_LABEL, type BoardMachine } from "@/lib/mes";

interface Board { shift: { code: string; name: string; start: string; end: string } | null; machines: BoardMachine[] }

const TILE: Record<string, string> = {
  running: "border-success bg-success-soft",
  stopped: "border-danger bg-danger-soft",
  setup: "border-warning bg-warning-soft",
  planned_stop: "border-border bg-surface-muted",
};

/** Andon board: every machine's state, job and shift OEE at a glance, for the floor and a TV. */
export default function AndonPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const use = can("mes.shopfloor.use");
  const ref = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const board = useQuery({ queryKey: ["/mes/board"], queryFn: () => api<Board>("/mes/board"), refetchInterval: 5000 });
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setMenu(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["/mes/board"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }

  const machines = board.data?.machines ?? [];
  const calls = machines.flatMap((m) => m.calls.map((c) => ({ ...c, machine: m.code })));
  return (
    <div ref={ref} className="space-y-4 bg-background p-1">
      <PageHeader
        title={`Andon board${board.data?.shift ? ` · ${board.data.shift.name}` : ""}`}
        description="States update every 5 seconds. Red: stopped. Amber: setup. Grey: planned stop. Faded: no signal for 5 minutes."
        actions={<Button variant="ghost" onClick={() => ref.current?.requestFullscreen?.()}><Maximize2 className="size-4" aria-hidden /> Full screen</Button>}
      />
      {error && <Alert>{error}</Alert>}
      {calls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {calls.map((c) => (
            <div key={c.id} className={`flex items-center gap-3 rounded-xl border-2 px-4 py-2 text-lg ${c.ackedAt ? "border-warning bg-warning-soft" : "animate-pulse border-danger bg-danger-soft"}`}>
              <span className="font-semibold">{c.machine}: {CALL_LABEL[c.kind] ?? c.kind}</span>
              <span className="text-sm">{duration((now - Date.parse(c.raisedAt)) / 1000)}{c.note ? ` · ${c.note}` : ""}</span>
              {use && !c.ackedAt && <Button size="sm" onClick={() => act(() => api(`/mes/andon/calls/${c.id}/ack`, { body: {} }))}>Coming</Button>}
              {use && c.ackedAt && <Button size="sm" variant="ghost" onClick={() => act(() => api(`/mes/andon/calls/${c.id}/resolve`, { body: {} }))}>Done</Button>}
            </div>
          ))}
        </div>
      )}
      {board.data && !machines.length && <p className="py-10 text-center text-muted">No machines are monitored yet. Link counter or run-state signals to machines under Smart factory → Signals.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {machines.map((m) => {
          const progress = m.job && m.job.orderQty ? Math.min(100, (m.job.good / m.job.orderQty) * 100) : 0;
          const below = m.shift.oee !== null && m.shift.oee * 100 < m.targetOeePct;
          return (
            <div key={m.id} className={`relative rounded-2xl border-4 p-4 ${m.state ? TILE[m.state] : "border-border"} ${m.offline ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-2xl font-bold">{m.code}</p>
                  <p className="text-sm text-muted">{m.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold">{m.state ? STATE_LABEL[m.state] : "No data"}</p>
                  {m.since && <p className="text-sm tabular-nums">{duration((now - Date.parse(m.since)) / 1000)}</p>}
                  {m.offline && <p className="text-xs">no signal</p>}
                </div>
              </div>
              {m.reason && <p className="mt-1 text-sm font-medium">{m.reason}</p>}
              {m.job ? (
                <div className="mt-3 text-sm">
                  <p className="truncate">{m.job.number} · {m.job.item} · {m.job.operation}</p>
                  <div className="mt-1 h-2 rounded-full bg-surface"><div className="h-2 rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
                  <p className="mt-1 tabular-nums">{m.job.good} of {m.job.orderQty}{m.job.reject ? ` · ${m.job.reject} rejected` : ""}{m.job.operator ? ` · ${m.job.operator}` : ""}</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No job card running</p>
              )}
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className={`text-3xl font-bold tabular-nums ${below ? "text-danger" : ""}`}>{pct(m.shift.oee)}</p>
                  <p className="text-xs text-muted">OEE this shift (target {m.targetOeePct} %) · A {pct(m.shift.availability)} · P {pct(m.shift.performance)} · Q {pct(m.shift.quality)}</p>
                </div>
                {use && (
                  <div className="relative">
                    <Button size="sm" variant="ghost" onClick={() => setMenu(menu === m.id ? null : m.id)}>Actions</Button>
                    {menu === m.id && (
                      <div className="absolute right-0 bottom-full z-10 mb-1 w-48 rounded-lg border border-border bg-surface p-1 text-sm shadow-lg">
                        {Object.entries(CALL_LABEL).map(([k, v]) => (
                          <button key={k} type="button" className="block w-full rounded px-3 py-1.5 text-left hover:bg-surface-muted" onClick={() => act(() => api("/mes/andon/calls", { body: { machineId: m.id, kind: k } }))}>Call {v.toLowerCase()}</button>
                        ))}
                        <hr className="my-1 border-border" />
                        {(["setup", "planned_stop", "stopped"] as const).filter((s) => s !== m.state).map((s) => (
                          <button key={s} type="button" className="block w-full rounded px-3 py-1.5 text-left hover:bg-surface-muted" onClick={() => act(() => api(`/mes/machines/${m.id}/state`, { body: { state: s } }))}>Mark {STATE_LABEL[s].toLowerCase()}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
