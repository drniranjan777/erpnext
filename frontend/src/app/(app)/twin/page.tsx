"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader, ErrorBlock, LoadingBlock } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtValue } from "@/lib/iot";
import { duration, pct, STATE_LABEL } from "@/lib/mes";

interface Node { id?: string; kind: "machine" | "area" | "label"; machineId: string | null; machineCode?: string | null; machineName?: string | null; label: string | null; x: number; y: number; w: number; h: number; live?: Live }
interface Live { state: string | null; since: string | null; reason: string | null; offline: boolean; oee: number | null; targetOeePct: number | null; job: { number: string; item: string; good: number; orderQty: number } | null; calls: number; alarms: number; anomalies: number; visionDefectPct: number | null; signals: { code: string; name: string; unit: string | null; lastValue: number | null }[] }
interface Layout { id: string; name: string; width: number; height: number; isDefault: boolean; nodes: Node[]; shift?: { name: string } | null }
interface Machine { id: string; code: string; name: string }

const FILL: Record<string, string> = { running: "fill-success/70", stopped: "fill-danger/70", setup: "fill-warning/70", planned_stop: "fill-muted/40" };
const U = 20;

/** Digital twin: the plant drawn to scale, every machine live. Switch to edit to place machines and areas. */
export default function TwinPage() {
  const { can } = useAuth();
  const layouts = useQuery({ queryKey: ["/twin/layouts"], queryFn: () => api<{ id: string; name: string; isDefault: boolean }[]>("/twin/layouts") });
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<Layout | null>(null);
  const id = picked ?? layouts.data?.[0]?.id ?? null;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Digital twin"
        description="Each machine where it stands, coloured by what it is doing now; refreshed every 10 seconds. What-if simulation is under Smart factory → What-if."
        actions={
          <span className="flex gap-2">
            {layouts.data && layouts.data.length > 1 && <Select className="h-9 w-48" aria-label="Layout" value={id ?? ""} onChange={(e) => setPicked(e.target.value)}>{layouts.data.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
            {can("twin.layouts.manage") && <Button variant="ghost" onClick={() => setEditing({ id: "", name: "New layout", width: 60, height: 30, isDefault: !layouts.data?.length, nodes: [] })}><Plus className="size-4" aria-hidden /> New layout</Button>}
          </span>
        }
      />
      {editing ? (
        <Editor layout={editing} onDone={(newId) => { setEditing(null); if (newId) setPicked(newId); }} />
      ) : id ? (
        <LiveLayout id={id} onEdit={(l) => setEditing(l)} />
      ) : (
        layouts.data && <p className="py-10 text-center text-muted">No layout yet. Draw one with “New layout”.</p>
      )}
    </div>
  );
}

function LiveLayout({ id, onEdit }: { id: string; onEdit: (l: Layout) => void }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["/twin/layouts", id, "live"], queryFn: () => api<Layout>(`/twin/layouts/${id}/live`), refetchInterval: 10000 });
  const [sel, setSel] = useState<Node | null>(null);
  const l = q.data;
  if (!l) return q.isError ? <ErrorBlock error={q.error} /> : <LoadingBlock />;
  const now = q.dataUpdatedAt;
  const current = sel ? l.nodes.find((n) => n.machineId === sel.machineId && n.kind === "machine") ?? sel : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-auto p-2">
        <div className="mb-2 flex items-center justify-between px-2"><span className="font-medium">{l.name}{l.shift ? ` · ${l.shift.name}` : ""}</span>{can("twin.layouts.manage") && <Button size="sm" variant="ghost" onClick={() => onEdit(l)}><Pencil className="size-4" aria-hidden /> Edit</Button>}</div>
        <svg viewBox={`0 0 ${l.width * U} ${l.height * U}`} className="w-full min-w-[640px] rounded border border-border bg-surface-muted" role="img" aria-label={`Layout ${l.name}`}>
          {l.nodes.filter((n) => n.kind === "area").map((n, i) => <g key={`a${i}`}><rect x={n.x * U} y={n.y * U} width={n.w * U} height={n.h * U} className="fill-primary/5 stroke-border" strokeDasharray="6 4" rx={6} /><text x={n.x * U + 6} y={n.y * U + 16} className="fill-muted text-[12px]">{n.label}</text></g>)}
          {l.nodes.filter((n) => n.kind === "label").map((n, i) => <text key={`l${i}`} x={n.x * U} y={n.y * U + 14} className="fill-foreground text-[13px] font-medium">{n.label}</text>)}
          {l.nodes.filter((n) => n.kind === "machine").map((n) => {
            const s = n.live;
            const fill = !s || s.offline ? "fill-muted/20" : s.state ? FILL[s.state] : "fill-muted/20";
            const flag = s && (s.alarms || s.anomalies || s.calls);
            return (
              <g key={n.machineId} className="cursor-pointer" onClick={() => setSel(n)}>
                <rect x={n.x * U} y={n.y * U} width={n.w * U} height={n.h * U} rx={8} className={`${fill} ${current?.machineId === n.machineId ? "stroke-primary" : "stroke-foreground/40"}`} strokeWidth={current?.machineId === n.machineId ? 3 : 1} />
                <text x={n.x * U + 8} y={n.y * U + 18} className="fill-foreground text-[13px] font-bold">{n.machineCode}</text>
                <text x={n.x * U + 8} y={n.y * U + 34} className="fill-foreground text-[11px]">{s?.offline ? "no signal" : s?.state ? STATE_LABEL[s.state] : "–"}{s?.oee !== null && s?.oee !== undefined ? ` · ${pct(s.oee)}` : ""}</text>
                {s?.signals[0] && n.h * U > 50 && <text x={n.x * U + 8} y={n.y * U + 50} className="fill-foreground/80 text-[10px]">{s.signals[0].name}: {fmtValue(s.signals[0].lastValue, s.signals[0].unit)}</text>}
                {flag ? <circle cx={(n.x + n.w) * U - 10} cy={n.y * U + 10} r={6} className="fill-danger" /> : null}
              </g>
            );
          })}
        </svg>
      </Card>
      <Card>
        {current?.live ? (
          <>
            <CardHeader title={`${current.machineCode} · ${current.machineName ?? ""}`} />
            <div className="space-y-2 border-t border-border p-4 text-sm">
              <p className="text-lg font-semibold">{current.live.offline ? "No signal" : current.live.state ? STATE_LABEL[current.live.state] : "No state"}{current.live.since && !current.live.offline ? <span className="text-sm font-normal text-muted"> for {duration((now - Date.parse(current.live.since)) / 1000)}</span> : null}</p>
              {current.live.reason && <p>{current.live.reason}</p>}
              <p>OEE this shift: <strong>{pct(current.live.oee)}</strong>{current.live.targetOeePct ? ` (target ${current.live.targetOeePct} %)` : ""}</p>
              {current.live.job ? <p>{current.live.job.number} · {current.live.job.item}: {current.live.job.good} of {current.live.job.orderQty}</p> : <p className="text-muted">No job running</p>}
              <ul className="space-y-0.5">{current.live.signals.map((s) => <li key={s.code} className="flex justify-between"><span>{s.name}</span><span className="tabular-nums">{fmtValue(s.lastValue, s.unit)}</span></li>)}</ul>
              <div className="flex flex-wrap gap-1">
                {current.live.alarms > 0 && <Link href="/iot/alarms"><Badge tone="danger">{current.live.alarms} alarm(s)</Badge></Link>}
                {current.live.anomalies > 0 && <Link href="/plant/condition"><Badge tone="warning">{current.live.anomalies} anomaly</Badge></Link>}
                {current.live.calls > 0 && <Link href="/mes/andon"><Badge tone="danger">{current.live.calls} Andon call(s)</Badge></Link>}
                {current.live.visionDefectPct !== null && <Link href="/vision"><Badge tone={current.live.visionDefectPct > 5 ? "danger" : "neutral"}>vision {current.live.visionDefectPct} % defects</Badge></Link>}
              </div>
            </div>
          </>
        ) : (
          <p className="p-6 text-center text-sm text-muted">Select a machine.</p>
        )}
      </Card>
    </div>
  );
}

function Editor({ layout, onDone }: { layout: Layout; onDone: (id?: string) => void }) {
  const qc = useQueryClient();
  const machines = useQuery({ queryKey: ["/manufacturing/machines"], queryFn: () => api<Machine[]>("/manufacturing/machines") });
  const [l, setL] = useState<Layout>(layout);
  const [sel, setSel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; dx: number; dy: number } | null>(null);
  const toUnits = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * l.width, y: ((e.clientY - r.top) / r.height) * l.height };
  };
  const setNode = (i: number, p: Partial<Node>) => setL({ ...l, nodes: l.nodes.map((n, j) => (j === i ? { ...n, ...p } : n)) });
  const placed = new Set(l.nodes.filter((n) => n.machineId).map((n) => n.machineId));
  async function save() {
    setError(null);
    try {
      const body = { name: l.name, width: l.width, height: l.height, isDefault: l.isDefault, nodes: l.nodes.map((n) => ({ kind: n.kind, machineId: n.machineId, label: n.label, x: n.x, y: n.y, w: n.w, h: n.h })) };
      const r = await (l.id ? api<Layout>(`/twin/layouts/${l.id}`, { method: "PUT", body }) : api<Layout>("/twin/layouts", { body }));
      qc.invalidateQueries({ queryKey: ["/twin/layouts"] });
      onDone(r.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    }
  }
  const s = sel !== null ? l.nodes[sel] : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card className="overflow-auto p-2">
        <svg
          ref={svg}
          viewBox={`0 0 ${l.width * U} ${l.height * U}`}
          className="w-full min-w-[640px] touch-none rounded border border-border bg-[length:20px_20px] bg-surface-muted"
          style={{ backgroundImage: "linear-gradient(to right, rgba(127,127,127,.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(127,127,127,.15) 1px, transparent 1px)" }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const p = toUnits(e);
            const n = l.nodes[drag.current.i];
            setNode(drag.current.i, { x: Math.max(0, Math.min(l.width - n.w, Math.round((p.x - drag.current.dx) * 2) / 2)), y: Math.max(0, Math.min(l.height - n.h, Math.round((p.y - drag.current.dy) * 2) / 2)) });
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => (drag.current = null)}
        >
          {l.nodes.map((n, i) => (
            <g
              key={i}
              className="cursor-move"
              onPointerDown={(e) => {
                const p = toUnits(e);
                drag.current = { i, dx: p.x - n.x, dy: p.y - n.y };
                setSel(i);
              }}
            >
              <rect x={n.x * U} y={n.y * U} width={n.w * U} height={n.h * U} rx={n.kind === "machine" ? 8 : 4} className={`${n.kind === "area" ? "fill-primary/5" : n.kind === "label" ? "fill-transparent" : "fill-primary/30"} ${sel === i ? "stroke-primary" : "stroke-foreground/40"}`} strokeDasharray={n.kind === "area" ? "6 4" : undefined} strokeWidth={sel === i ? 3 : 1} />
              <text x={n.x * U + 6} y={n.y * U + 16} className="pointer-events-none fill-foreground text-[12px]">{n.kind === "machine" ? (machines.data?.find((m) => m.id === n.machineId)?.code ?? n.machineCode) : n.label}</text>
            </g>
          ))}
        </svg>
      </Card>
      <Card className="space-y-3 p-4 text-sm">
        {error && <Alert>{error}</Alert>}
        <Input aria-label="Layout name" value={l.name} onChange={(e) => setL({ ...l, name: e.target.value })} />
        <div className="flex gap-2"><Input type="number" aria-label="Width (m)" value={l.width} onChange={(e) => setL({ ...l, width: Number(e.target.value) })} /><Input type="number" aria-label="Height (m)" value={l.height} onChange={(e) => setL({ ...l, height: Number(e.target.value) })} /></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={l.isDefault} onChange={(e) => setL({ ...l, isDefault: e.target.checked })} /> Show this layout first</label>
        <Select aria-label="Add machine" value="" onChange={(e) => { if (e.target.value) { setL({ ...l, nodes: [...l.nodes, { kind: "machine", machineId: e.target.value, label: null, x: 1, y: 1, w: 4, h: 3 }] }); setSel(l.nodes.length); } }}>
          <option value="">Add a machine…</option>
          {machines.data?.filter((m) => !placed.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
        </Select>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setL({ ...l, nodes: [...l.nodes, { kind: "area", machineId: null, label: "Area", x: 0, y: 0, w: 10, h: 6 }] }); setSel(l.nodes.length); }}>Add area</Button>
          <Button size="sm" variant="secondary" onClick={() => { setL({ ...l, nodes: [...l.nodes, { kind: "label", machineId: null, label: "Label", x: 1, y: 1, w: 3, h: 1 }] }); setSel(l.nodes.length); }}>Add label</Button>
        </div>
        {s && sel !== null && (
          <div className="space-y-2 rounded-lg border border-border p-2">
            <p className="font-medium">Selected {s.kind}</p>
            {s.kind !== "machine" && <Input aria-label="Text" value={s.label ?? ""} onChange={(e) => setNode(sel, { label: e.target.value })} />}
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" step="0.5" aria-label="Width" value={s.w} onChange={(e) => setNode(sel, { w: Number(e.target.value) })} />
              <Input type="number" step="0.5" aria-label="Depth" value={s.h} onChange={(e) => setNode(sel, { h: Number(e.target.value) })} />
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setL({ ...l, nodes: l.nodes.filter((_, j) => j !== sel) }); setSel(null); }}>Remove</Button>
          </div>
        )}
        <p className="text-xs text-muted">Drag to move. One grid square is one metre.</p>
        <div className="flex gap-2"><Button onClick={save}>Save</Button><Button variant="ghost" onClick={() => onDone()}>Cancel</Button></div>
      </Card>
    </div>
  );
}
