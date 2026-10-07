"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, Delete, Play, ScanLine, Square, Wifi, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatQty } from "@/lib/documents";
import { enqueue, flush, newRef, readQueue, type KioskEvent, type SyncResult } from "@/lib/kiosk-queue";
import { MFG, type Machine, type WorkCenter } from "@/lib/manufacturing";

interface Running { id: string; operationId: string; operatorName: string | null; startedAt: string; clientRef: string | null; machine: string | null; countedGood?: string; countedReject?: string }
interface BoardOp {
  id: string;
  seq: number;
  name: string;
  isSubcontract: boolean;
  inspection: boolean;
  goodQty: string;
  rejectQty: string;
  workCenter: { id: string; code: string; name: string };
  workOrder: { id: string; number: string; qty: string; priority: number };
  item: { code: string; name: string };
  running: Running[];
}
/** A sitting shown as running: confirmed by the server, or still waiting on the tablet. */
interface Sitting { key: string; cardId?: string; clientRef?: string; operatorName: string | null; startedAt: string; pending: boolean; counted?: { good: number; reject: number } }

const REASONS = ["Dimension out", "Surface defect", "Burr", "Crack", "Setup piece", "Material defect", "Other"];
const LS = { wc: "ngerp.kiosk.wc", operator: "ngerp.kiosk.operator", board: "ngerp.kiosk.board" };
const get = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const put = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // Private mode: settings last for this session only.
  }
};
const since = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/**
 * Tablet screen for the shop floor: big targets, a scanner box for traveller QR codes, and a
 * local queue so starts and stops are never lost when the Wi-Fi drops.
 */
export function Kiosk() {
  const qc = useQueryClient();
  const [wc, setWc] = useState(() => (typeof window === "undefined" ? "" : get(LS.wc)));
  const [operator, setOperator] = useState(() => (typeof window === "undefined" ? "" : get(LS.operator)));
  const [queue, setQueue] = useState<KioskEvent[]>(() => (typeof window === "undefined" ? [] : readQueue()));
  const [online, setOnline] = useState(true);
  const [failures, setFailures] = useState<SyncResult[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scanRef = useRef<HTMLInputElement>(null);

  const wcs = useQuery({ queryKey: [MFG, "wc"], queryFn: () => api<WorkCenter[]>(`${MFG}/work-centers`) });
  const machines = useQuery({ queryKey: [MFG, "machines"], queryFn: () => api<Machine[]>(`${MFG}/machines`) });
  const board = useQuery({
    queryKey: [MFG, "kiosk-board", wc],
    queryFn: async () => {
      const b = await api<{ operations: BoardOp[] }>(`${MFG}/shop-floor`, { query: { workCenterId: wc || undefined } });
      put(`${LS.board}.${wc}`, JSON.stringify(b));
      return b;
    },
    initialData: () => {
      try {
        const raw = typeof window === "undefined" ? null : localStorage.getItem(`${LS.board}.${wc}`);
        return raw ? (JSON.parse(raw) as { operations: BoardOp[] }) : undefined;
      } catch {
        return undefined;
      }
    },
    initialDataUpdatedAt: 0,
    refetchInterval: 20_000,
    retry: false,
  });

  const sync = useCallback(async () => {
    const r = await flush();
    setQueue(readQueue());
    setOnline(!r.offline && navigator.onLine);
    if (r.failed.length) setFailures((f) => [...f, ...r.failed].slice(-5));
    if (r.sent) qc.invalidateQueries({ queryKey: [MFG, "kiosk-board"] });
  }, [qc]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const retry = setInterval(() => void sync(), 15_000);
    const up = () => void sync();
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    // Send anything left from before (a reload, a dead battery) as soon as the screen opens.
    const first = setTimeout(() => void sync(), 0);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      clearInterval(retry);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [sync]);

  function record(e: KioskEvent) {
    enqueue(e);
    setQueue(readQueue());
    void sync();
  }

  const ops = useMemo(() => board.data?.operations ?? [], [board.data]);
  /** Running sittings per operation: server cards plus starts still on the tablet, less stops still on the tablet. */
  const sittings = useMemo(() => {
    const stopped = new Set(queue.filter((e) => e.type === "stop").map((e) => (e.type === "stop" ? (e.clientRef ?? e.cardId) : "")));
    const out = new Map<string, Sitting[]>();
    for (const o of ops) {
      const list: Sitting[] = o.running.filter((r) => !stopped.has(r.clientRef ?? "") && !stopped.has(r.id)).map((r) => ({ key: r.id, cardId: r.id, clientRef: r.clientRef ?? undefined, operatorName: r.operatorName, startedAt: r.startedAt, pending: false, counted: Number(r.countedGood) + Number(r.countedReject) > 0 ? { good: Number(r.countedGood), reject: Number(r.countedReject) } : undefined }));
      for (const e of queue) {
        if (e.type === "start" && e.operationId === o.id && !stopped.has(e.clientRef) && !list.some((s) => s.clientRef === e.clientRef)) list.push({ key: e.clientRef, clientRef: e.clientRef, operatorName: e.operatorName, startedAt: e.at, pending: true });
      }
      out.set(o.id, list);
    }
    return out;
  }, [ops, queue]);

  async function onScan(code: string) {
    setScan("");
    setScanMsg(null);
    const local = /^JC:([0-9a-f-]{36})$/i.exec(code.trim())?.[1];
    const hit = local && ops.find((o) => o.id === local);
    if (hit) return setSelected(hit.id);
    try {
      const r = await api<{ kind: "operation"; id: string; workCenterId: string } | { kind: "work_order"; id: string }>(`${MFG}/scan`, { query: { code } });
      if (r.kind === "operation") {
        if (r.workCenterId !== wc) {
          setWc(r.workCenterId);
          put(LS.wc, r.workCenterId);
        }
        setSelected(r.id);
      } else {
        const first = ops.find((o) => o.workOrder.id === r.id);
        if (first) setSelected(first.id);
        else setScanMsg("That work order has nothing open at this work centre.");
      }
    } catch (e) {
      setScanMsg(e instanceof ApiError ? e.message : "Offline: only codes on this screen can be scanned.");
    }
  }

  const op = ops.find((o) => o.id === selected) ?? null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <h1 className="text-xl font-semibold">Shop floor</h1>
        <select
          aria-label="Work centre"
          className="h-12 rounded-lg border border-border bg-surface px-3 text-lg"
          value={wc}
          onChange={(e) => {
            setWc(e.target.value);
            put(LS.wc, e.target.value);
          }}
        >
          <option value="">All work centres</option>
          {wcs.data?.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}
        </select>
        <input
          aria-label="Operator name"
          placeholder="Operator"
          className="h-12 w-44 rounded-lg border border-border bg-surface px-3 text-lg"
          value={operator}
          onChange={(e) => {
            setOperator(e.target.value);
            put(LS.operator, e.target.value);
          }}
        />
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (scan.trim()) void onScan(scan.trim());
          }}
        >
          <ScanLine className="size-6 text-muted" aria-hidden />
          <input ref={scanRef} autoFocus aria-label="Scan a traveller or type a work order number" placeholder="Scan traveller…" className="h-12 min-w-40 flex-1 rounded-lg border border-border bg-surface px-3 text-lg" value={scan} onChange={(e) => setScan(e.target.value)} />
        </form>
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${online ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
          {online ? <Wifi className="size-4" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
          {online ? "Online" : "Offline"}
          {queue.length > 0 && ` · ${queue.length} to send`}
        </span>
        <Link href={`${MFG}/shop-floor`} className="inline-flex h-12 items-center rounded-lg border border-border px-4 text-base">Exit</Link>
      </header>
      {scanMsg && <p className="bg-warning-soft px-4 py-2 text-base text-warning">{scanMsg}</p>}
      {failures.length > 0 && (
        <div className="flex items-start justify-between gap-2 bg-danger-soft px-4 py-2 text-base text-danger">
          <ul>{failures.map((f, i) => <li key={i}>Not recorded ({f.type}): {f.error}</li>)}</ul>
          <button className="p-1" aria-label="Dismiss" onClick={() => setFailures([])}><X className="size-5" aria-hidden /></button>
        </div>
      )}
      <main className="flex-1 overflow-auto p-4">
        {!ops.length && <p className="mt-16 text-center text-xl text-muted">{board.isLoading ? "Loading…" : "Nothing to do here. Release a work order to put its operations on the board."}</p>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ops.map((o) => {
            const runs = sittings.get(o.id) ?? [];
            const done = Number(o.goodQty) + Number(o.rejectQty);
            return (
              <button key={o.id} onClick={() => setSelected(o.id)} className={`flex min-h-40 flex-col gap-2 rounded-2xl border-2 p-4 text-left transition ${runs.length ? "border-warning bg-warning-soft" : "border-border bg-surface hover:border-primary"}`}>
                <span className="flex items-center justify-between text-base text-muted">
                  <span>{o.workOrder.number}</span>
                  <span className={o.workOrder.priority <= 2 ? "font-semibold text-danger" : undefined}>P{o.workOrder.priority}</span>
                </span>
                <span className="text-2xl font-semibold">{o.seq} · {o.name}</span>
                <span className="text-lg">{o.item.code} {o.item.name}</span>
                <span className="mt-auto text-lg tabular-nums">{formatQty(o.goodQty)} good{Number(o.rejectQty) > 0 && `, ${formatQty(o.rejectQty)} rejected`} of {formatQty(o.workOrder.qty)}</span>
                <span className="h-3 rounded-full bg-surface-muted"><span className="block h-3 rounded-full bg-primary" style={{ width: `${Math.min(100, (done / Number(o.workOrder.qty)) * 100)}%` }} /></span>
                {runs.map((r) => <span key={r.key} className="text-base font-medium text-warning">{r.operatorName ?? "Running"} · {since(r.startedAt, now)}{r.pending && " · waiting to send"}</span>)}
              </button>
            );
          })}
        </div>
      </main>
      {op && (
        <OperationSheet
          op={op}
          runs={sittings.get(op.id) ?? []}
          now={now}
          operator={operator}
          machines={(machines.data ?? []).filter((m) => m.workCenterId === op.workCenter.id)}
          onClose={() => {
            setSelected(null);
            scanRef.current?.focus();
          }}
          onEvent={(e) => {
            record(e);
            setSelected(null);
            scanRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function OperationSheet({ op, runs, now, operator, machines, onClose, onEvent }: { op: BoardOp; runs: Sitting[]; now: number; operator: string; machines: Machine[]; onClose: () => void; onEvent: (e: KioskEvent) => void }) {
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [stopping, setStoppingRaw] = useState<Sitting | null>(runs.length === 1 ? runs[0] : null);
  const [field, setField] = useState<"good" | "reject">("good");
  // Machines connected to the IoT platform count parts into the running job card: start from those counts.
  const [good, setGood] = useState(runs.length === 1 && runs[0].counted ? String(runs[0].counted.good) : "");
  const [reject, setReject] = useState(runs.length === 1 && runs[0].counted ? String(runs[0].counted.reject || "") : "");
  const setStopping = (r: Sitting | null) => {
    setStoppingRaw(r);
    if (r?.counted) {
      setGood(String(r.counted.good));
      setReject(r.counted.reject ? String(r.counted.reject) : "");
    }
  };
  const [reason, setReason] = useState("");
  const set = field === "good" ? setGood : setReject;
  const val = field === "good" ? good : reject;
  const press = (k: string) => set(k === "back" ? val.slice(0, -1) : k === "clear" ? "" : (val + k).replace(/^0+(?=\d)/, "").slice(0, 7));
  const canStop = Number(good) + Number(reject) > 0 && (!Number(reject) || !!reason);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal aria-label={`${op.seq} ${op.name}`}>
      <div className="max-h-full w-full max-w-3xl overflow-auto rounded-t-2xl bg-surface p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg text-muted">{op.workOrder.number} · {op.item.code} {op.item.name}</p>
            <h2 className="text-3xl font-semibold">{op.seq} · {op.name}</h2>
            {op.inspection && <p className="text-lg font-medium text-warning">Inspection after this operation</p>}
          </div>
          <button className="rounded-lg p-3" aria-label="Close" onClick={onClose}><X className="size-7" aria-hidden /></button>
        </div>

        {!stopping && (
          <div className="mt-5 space-y-4">
            {runs.length > 0 && (
              <div className="space-y-2">
                <p className="text-lg font-medium">Running</p>
                {runs.map((r) => (
                  <button key={r.key} onClick={() => setStopping(r)} className="flex w-full items-center justify-between rounded-xl border-2 border-warning bg-warning-soft px-4 py-4 text-xl">
                    <span>{r.operatorName ?? "Someone"} · {since(r.startedAt, now)}</span>
                    <span className="inline-flex items-center gap-2 font-semibold"><Square className="size-6" aria-hidden /> Stop</span>
                  </button>
                ))}
              </div>
            )}
            {!op.isSubcontract && (
              <div className="flex flex-wrap items-end gap-3">
                {machines.length > 0 && (
                  <label className="flex flex-col gap-1 text-base">
                    Machine
                    <select className="h-14 rounded-lg border border-border bg-surface px-3 text-xl" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                      <option value="">None</option>
                      {machines.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
                    </select>
                  </label>
                )}
                <button
                  disabled={!operator.trim()}
                  onClick={() => onEvent({ type: "start", clientRef: newRef(), operationId: op.id, operatorName: operator.trim() || null, machineId: machineId || null, at: new Date().toISOString() })}
                  className="inline-flex h-16 flex-1 items-center justify-center gap-3 rounded-xl bg-primary text-2xl font-semibold text-primary-foreground disabled:opacity-40"
                >
                  <Play className="size-7" aria-hidden /> Start{operator.trim() ? ` as ${operator.trim()}` : ""}
                </button>
              </div>
            )}
            {!operator.trim() && !op.isSubcontract && <p className="text-base text-muted">Enter the operator name at the top first.</p>}
          </div>
        )}

        {stopping && (
          <div className="mt-5 space-y-4">
            <p className="text-lg">Stopping {stopping.operatorName ?? "the job card"}, started {since(stopping.startedAt, now)} ago</p>
            {stopping.counted && <p className="text-base text-muted">Counted by the machine: {stopping.counted.good} good{stopping.counted.reject ? `, ${stopping.counted.reject} rejected` : ""}. Correct the figures if needed.</p>}
            <div className="grid grid-cols-2 gap-3">
              {(["good", "reject"] as const).map((f) => (
                <button key={f} onClick={() => setField(f)} className={`rounded-xl border-2 px-4 py-3 text-left ${field === f ? "border-primary" : "border-border"}`}>
                  <span className="block text-base text-muted">{f === "good" ? "Good" : "Rejected"}</span>
                  <span className="block text-4xl font-semibold tabular-nums">{(f === "good" ? good : reject) || "0"}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"].map((k) => (
                <button key={k} onClick={() => press(k)} className="h-16 rounded-xl border border-border bg-surface-muted text-2xl font-semibold" aria-label={k === "back" ? "Delete digit" : k === "clear" ? "Clear" : k}>
                  {k === "back" ? <Delete className="mx-auto size-7" aria-hidden /> : k === "clear" ? "C" : k}
                </button>
              ))}
            </div>
            {Number(reject) > 0 && (
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button key={r} onClick={() => setReason(r)} className={`rounded-full border-2 px-4 py-2 text-lg ${reason === r ? "border-danger bg-danger-soft text-danger" : "border-border"}`}>{r}</button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              {runs.length > 1 && <button onClick={() => setStopping(null)} className="h-16 rounded-xl border border-border px-6 text-xl">Back</button>}
              <button
                disabled={!canStop}
                onClick={() => onEvent({ type: "stop", ...(stopping.clientRef ? { clientRef: stopping.clientRef } : { cardId: stopping.cardId }), goodQty: good || "0", rejectQty: reject || "0", rejectReason: Number(reject) ? reason : null, at: new Date().toISOString() })}
                className="inline-flex h-16 flex-1 items-center justify-center gap-3 rounded-xl bg-primary text-2xl font-semibold text-primary-foreground disabled:opacity-40"
              >
                <Square className="size-7" aria-hidden /> Stop and record
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
