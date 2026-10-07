"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Lock, Pin, PinOff } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { PLAN } from "@/lib/planning";

interface Op {
  id: string;
  workOrder: { id: string; number: string };
  seq: number;
  name: string;
  workCenterId: string;
  lane: number;
  start: string;
  end: string;
  setupMinutes: number;
  locked: boolean;
  running: boolean;
  item: { code: string; name: string };
  qty: string;
  dueDate: string | null;
  late: boolean;
  conflict: boolean;
}
interface Board { from: string; to: string; workCenters: { id: string; code: string; name: string; lanes: number; outside: boolean }[]; operations: Op[] }
interface RunResult { operations: number; orders: number; late: number; conflicts: number; finishesAt: string | null; setupMinutes: number }

const HOUR = 3_600_000;
const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
/** A stable colour per work order. */
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export default function SchedulePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("planning.mrp.manage");
  const [days, setDays] = useState(7);
  const key = [PLAN, "schedule", days];
  const q = useQuery({ queryKey: key, queryFn: () => api<Board>(`${PLAN}/schedule`, { query: { days } }) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [sel, setSel] = useState<Op | null>(null);
  const [drag, setDrag] = useState<{ op: Op; x0: number; dx: number; lane: number | null } | null>(null);
  const track = useRef<HTMLDivElement>(null);

  async function call(fn: () => Promise<RunResult>, done: (r: RunResult) => string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: r.conflicts ? "danger" : "success", text: done(r) });
      await qc.invalidateQueries({ queryKey: [PLAN] });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof ApiError ? e.message : "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }
  const summary = (r: RunResult) => `${r.operations} operations of ${r.orders} orders scheduled${r.finishesAt ? `, last finishing ${time(r.finishesAt)}` : ""}. ${r.late ? `${r.late} order${r.late === 1 ? "" : "s"} late. ` : "Nothing late. "}${r.conflicts ? `${r.conflicts} pinned operation${r.conflicts === 1 ? "" : "s"} start before the step before them.` : ""}`;
  const run = () => call(() => api<RunResult>(`${PLAN}/schedule/run`, { method: "POST" }), summary);
  const move = (op: Op, body: { start?: string; lane?: number; locked: boolean }) => call(() => api<RunResult>(`${PLAN}/schedule/operations/${op.id}`, { method: "PUT", body }), (r) => `${body.locked ? "Pinned" : "Released"} ${op.workOrder.number} op ${op.seq}. ${summary(r)}`);

  const d = q.data;
  const from = d ? Date.parse(d.from) : 0;
  const span = d ? Date.parse(d.to) - from : 1;
  const pct = (t: number) => ((t - from) / span) * 100;
  const dayTicks = d ? Array.from({ length: days }, (_, i) => from + i * 24 * HOUR) : [];

  function onDown(e: React.PointerEvent, op: Op) {
    setSel(op);
    if (!manage || op.running) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ op, x0: e.clientX, dx: 0, lane: null });
  }
  function onMove(e: React.PointerEvent) {
    if (!drag) return;
    const row = document.elementsFromPoint(e.clientX, e.clientY).map((el) => (el as HTMLElement).closest?.("[data-lane]") as HTMLElement | null).find((el) => el && el.dataset.wc === drag.op.workCenterId);
    setDrag({ ...drag, dx: e.clientX - drag.x0, lane: row ? Number(row.dataset.lane) : drag.lane });
  }
  function onUp() {
    if (!drag) return;
    const width = track.current?.getBoundingClientRect().width ?? 1;
    const delta = (drag.dx / width) * span;
    const lane = drag.lane ?? drag.op.lane;
    setDrag(null);
    if (Math.abs(drag.dx) < 4 && lane === drag.op.lane) return;
    // Snap to a quarter of an hour.
    const start = Math.round((Date.parse(drag.op.start) + delta) / (15 * 60_000)) * 15 * 60_000;
    move(drag.op, { start: new Date(start).toISOString(), lane, locked: true });
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <PageHeader
        title="Production schedule"
        description="Finite schedule of open work orders, by work centre and unit. Orders go by priority and due date; each operation goes to the unit where it finishes first, with no setup when the same item runs again. Drag a bar to pin it; everything else reflows around it."
        actions={manage && <Button onClick={run} loading={busy}><CalendarClock className="size-4" aria-hidden /> Reschedule</Button>}
      />
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <Select className="h-9 w-32" aria-label="Range" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[3, 7, 14, 28].map((n) => <option key={n} value={n}>{n} days</option>)}
        </Select>
        <span className="inline-flex items-center gap-1"><span className="inline-block size-3 rounded-sm border-2 border-danger" /> Late order</span>
        <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden /> Pinned</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-2 rounded-sm bg-foreground/30" /> Setup</span>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} />}
      {d && !d.operations.length && <EmptyState title="Nothing scheduled in this window" description={manage ? "Release work orders with a routing, then press Reschedule." : "A planner has not scheduled any work yet."} />}
      {d && d.operations.length > 0 && (
        <Card className="overflow-x-auto">
          <div className="min-w-[900px] select-none" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
            <div className="flex border-b border-border text-xs text-muted">
              <div className="w-40 shrink-0 px-3 py-2">Work centre</div>
              <div ref={track} className="relative h-8 flex-1">
                {dayTicks.map((t) => (
                  <span key={t} className="absolute top-0 h-full border-l border-border pl-1 pt-2" style={{ left: `${pct(t)}%` }}>
                    {new Date(t).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
                  </span>
                ))}
              </div>
            </div>
            {d.workCenters.map((w) =>
              Array.from({ length: Math.max(1, w.lanes) }, (_, lane) => {
                const ops = d.operations.filter((o) => o.workCenterId === w.id && (w.outside || o.lane === lane));
                const target = drag && drag.op.workCenterId === w.id && (drag.lane ?? drag.op.lane) === lane;
                return (
                  <div key={`${w.id}-${lane}`} data-lane={lane} data-wc={w.id} className={`flex border-b border-border ${target ? "bg-primary-soft/40" : ""}`}>
                    <div className="w-40 shrink-0 px-3 py-2 text-xs">
                      {lane === 0 ? <><span className="font-mono">{w.code}</span> <span className="text-muted">{w.name}</span></> : null}
                      {w.lanes > 1 && <span className="block text-muted">Unit {lane + 1}</span>}
                      {w.outside && <span className="block text-muted">Outside</span>}
                    </div>
                    <div className="relative h-12 flex-1">
                      {dayTicks.map((t) => <span key={t} className="absolute top-0 h-full border-l border-border/60" style={{ left: `${pct(t)}%` }} />)}
                      {ops.map((o) => {
                        const s = Date.parse(o.start);
                        const e = Date.parse(o.end);
                        const left = Math.max(0, pct(s));
                        const right = Math.min(100, pct(e));
                        const dragging = drag?.op.id === o.id;
                        const setupPct = o.setupMinutes > 0 ? Math.min(100, ((o.setupMinutes * 60_000) / Math.max(1, e - s)) * 100) : 0;
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onPointerDown={(ev) => onDown(ev, o)}
                            title={`${o.workOrder.number} · ${o.item.code} · op ${o.seq} ${o.name}\n${time(o.start)} → ${time(o.end)}`}
                            className={`absolute top-1.5 flex h-9 items-center overflow-hidden rounded-md border text-left text-[11px] leading-tight text-foreground shadow-sm ${o.late ? "border-2 border-danger" : "border-border"} ${sel?.id === o.id ? "ring-2 ring-primary" : ""} ${manage && !o.running ? "cursor-grab" : "cursor-pointer"}`}
                            style={{ left: `${left}%`, width: `max(${right - left}%, 6px)`, background: `hsl(${hue(o.workOrder.id)} 70% 85%)`, transform: dragging ? `translateX(${drag!.dx}px)` : undefined, zIndex: dragging ? 10 : 1, opacity: dragging ? 0.85 : 1 }}
                          >
                            {setupPct > 0 && <span className="h-full shrink-0 bg-foreground/20" style={{ width: `${setupPct}%` }} />}
                            <span className="truncate px-1.5">
                              {o.locked && <Lock className="mr-0.5 inline size-3" aria-hidden />}
                              {o.workOrder.number} · {o.item.code}
                              <span className="block text-muted">op {o.seq} {o.name}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              }),
            )}
          </div>
        </Card>
      )}
      {sel && (
        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <Link href={`/manufacturing/work-orders/${sel.workOrder.id}`} className="font-medium hover:underline">{sel.workOrder.number}</Link>
          <span><span className="font-mono text-xs text-muted">{sel.item.code}</span> {sel.item.name} × {formatQty(sel.qty)}</span>
          <span>Op {sel.seq} {sel.name}</span>
          <span>{time(sel.start)} → {time(sel.end)}</span>
          {sel.setupMinutes > 0 && <span className="text-muted">setup {sel.setupMinutes} min</span>}
          {sel.dueDate && <span className="text-muted">due {formatDate(sel.dueDate)}</span>}
          {sel.late && <Badge tone="danger">Late</Badge>}
          {sel.conflict && <Badge tone="warning">Starts before the previous step ends</Badge>}
          {sel.running && <Badge tone="primary">Running</Badge>}
          {manage && !sel.running && (
            <span className="ml-auto">
              {sel.locked ? <Button size="sm" variant="secondary" onClick={() => { move(sel, { locked: false }); setSel(null); }}><PinOff className="size-4" aria-hidden /> Release pin</Button> : <Button size="sm" variant="secondary" onClick={() => move(sel, { locked: true })}><Pin className="size-4" aria-hidden /> Pin here</Button>}
            </span>
          )}
        </Card>
      )}
    </div>
  );
}
