"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, timeAgo } from "@/components/ui/page";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatQty } from "@/lib/documents";
import { MFG, type Machine, type WorkCenter } from "@/lib/manufacturing";

interface Running {
  id: string;
  operationId: string;
  operatorName: string | null;
  startedAt: string;
  machine: string | null;
  tool: string | null;
}
interface BoardOp {
  id: string;
  seq: number;
  name: string;
  status: string;
  isSubcontract: boolean;
  inspection: boolean;
  goodQty: string;
  rejectQty: string;
  plannedMinutes: string;
  actualMinutes: string;
  workCenter: { id: string; code: string; name: string };
  workOrder: {
    id: string;
    number: string;
    qty: string;
    priority: number;
    plannedEnd: string | null;
  };
  item: { code: string; name: string };
  running: Running[];
}

const KEY = [MFG, "shop-floor"];

export default function ShopFloorPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [wc, setWc] = useState("");
  const wcs = useQuery({
    queryKey: [MFG, "wc"],
    queryFn: () => api<WorkCenter[]>(`${MFG}/work-centers`),
  });
  const machines = useQuery({
    queryKey: [MFG, "machines"],
    queryFn: () => api<Machine[]>(`${MFG}/machines`),
  });
  const board = useQuery({
    queryKey: [...KEY, wc],
    queryFn: () =>
      api<{ operations: BoardOp[] }>(`${MFG}/shop-floor`, {
        query: { workCenterId: wc || undefined },
      }),
    refetchInterval: 30_000,
  });
  const [start, setStart] = useState<BoardOp | null>(null);
  const [stop, setStop] = useState<{ op: BoardOp; card: Running } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const record = can("manufacturing.shopfloor.record");
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Shop floor"
        description="Open operations of released work orders, most urgent first. Start a job card when work begins and stop it with the quantities."
        actions={
          <Select className="w-56" aria-label="Work centre" value={wc} onChange={(e) => setWc(e.target.value)}>
            <option value="">All work centres</option>
            {wcs.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} {w.name}
              </option>
            ))}
          </Select>
        }
      />
      {error && <Alert>{error}</Alert>}
      {board.isLoading && <LoadingBlock />}
      {board.error && <ErrorBlock error={board.error} />}
      {board.data && !board.data.operations.length && <EmptyState title="Nothing to do" description="Release a work order to put its operations on the board." />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {board.data?.operations.map((o) => {
          const done = Number(o.goodQty) + Number(o.rejectQty);
          const pct = Math.min(100, Math.round((done / Number(o.workOrder.qty)) * 100));
          return (
            <Card key={o.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`${MFG}/work-orders/${o.workOrder.id}`} className="text-sm font-semibold text-primary hover:underline">
                    {o.workOrder.number}
                  </Link>
                  <p className="truncate text-sm">
                    {o.item.code} {o.item.name}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={o.workOrder.priority <= 2 ? "danger" : "neutral"}>P{o.workOrder.priority}</Badge>
                  {o.workOrder.plannedEnd && <span className="text-xs text-muted">Due {formatDate(o.workOrder.plannedEnd)}</span>}
                </div>
              </div>
              <div>
                <p className="text-base font-medium">
                  {o.seq} · {o.name}
                </p>
                <p className="text-xs text-muted">
                  {o.workCenter.code} {o.workCenter.name}
                  {o.isSubcontract && " · job work"}
                  {o.inspection && " · QC after"}
                </p>
              </div>
              <div>
                <div className="flex justify-between text-xs text-muted">
                  <span>
                    {formatQty(o.goodQty)} good
                    {Number(o.rejectQty) > 0 && `, ${formatQty(o.rejectQty)} rejected`}
                  </span>
                  <span>of {formatQty(o.workOrder.qty)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-surface-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
              {o.running.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm">
                  <span>
                    {r.operatorName ?? "Someone"}
                    {r.machine && ` on ${r.machine}`} · started {timeAgo(r.startedAt)}
                  </span>
                  {record && (
                    <Button size="sm" variant="secondary" onClick={() => setStop({ op: o, card: r })}>
                      <Square className="size-4" aria-hidden /> Stop
                    </Button>
                  )}
                </div>
              ))}
              {record && !o.isSubcontract && (
                <Button className="mt-auto" variant="secondary" onClick={() => setStart(o)}>
                  <Play className="size-4" aria-hidden /> Start job card
                </Button>
              )}
            </Card>
          );
        })}
      </div>
      {start && <StartDialog op={start} machines={(machines.data ?? []).filter((m) => m.workCenterId === start.workCenter.id)} onClose={() => setStart(null)} onDone={refresh} onError={setError} />}
      {stop && <StopDialog op={stop.op} card={stop.card} onClose={() => setStop(null)} onDone={refresh} />}
    </div>
  );
}

function StartDialog({ op, machines, onClose, onDone, onError }: { op: BoardOp; machines: Machine[]; onClose: () => void; onDone: () => void; onError: (m: string) => void }) {
  const [f, setF] = useState({
    machineId: machines[0]?.id ?? "",
    operatorName: "",
  });
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await api(`${MFG}/job-cards/start`, {
        body: {
          operationId: op.id,
          machineId: f.machineId || null,
          operatorName: f.operatorName || null,
        },
      });
      onDone();
      onClose();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not reach the server.");
      onClose();
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Start ${op.seq} ${op.name}`}
      description={`${op.workOrder.number} · ${op.item.code}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} loading={busy}>
            Start
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Machine">
          {(p) => (
            <Select {...p} value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })}>
              <option value="">None</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Operator" hint="Blank = you">
          {(p) => <Input {...p} value={f.operatorName} onChange={(e) => setF({ ...f, operatorName: e.target.value })} />}
        </Field>
      </div>
    </Dialog>
  );
}

function StopDialog({ op, card, onClose, onDone }: { op: BoardOp; card: Running; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    goodQty: "",
    rejectQty: "",
    rejectReason: "",
    minutes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api(`${MFG}/job-cards/${card.id}/stop`, {
        body: {
          goodQty: f.goodQty || "0",
          rejectQty: f.rejectQty || "0",
          rejectReason: f.rejectReason || null,
          minutes: f.minutes || null,
        },
      });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server.");
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Stop ${op.seq} ${op.name}`}
      description={`Started ${timeAgo(card.startedAt)}. Leave minutes blank to use the time since start.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} loading={busy}>
            Stop
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Good">{(p) => <Input {...p} inputMode="decimal" value={f.goodQty} onChange={(e) => setF({ ...f, goodQty: e.target.value })} />}</Field>
        <Field label="Rejected">{(p) => <Input {...p} inputMode="decimal" value={f.rejectQty} onChange={(e) => setF({ ...f, rejectQty: e.target.value })} />}</Field>
        {Number(f.rejectQty) > 0 && (
          <Field label="Why rejected" className="sm:col-span-2">
            {(p) => <Input {...p} value={f.rejectReason} onChange={(e) => setF({ ...f, rejectReason: e.target.value })} />}
          </Field>
        )}
        <Field label="Minutes">{(p) => <Input {...p} inputMode="decimal" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
