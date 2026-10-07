/**
 * Finite forward scheduling of work-order operations onto work-centre lanes (a work centre
 * with 3 units has 3 lanes).
 *
 *  - Operations of an order run in sequence; an operation cannot start before its
 *    predecessor ends or before the order's release.
 *  - Orders are taken by: something already running, priority, due date, release.
 *  - Each operation goes to the lane where it would finish first. Setup is sequence-dependent:
 *    none after the same item, the work centre's transition time when one is defined, else
 *    the operation's own setup.
 *  - Operations placed by hand (locked) keep their lane and start; others fit around them.
 *  - Outside (sub-contract) work centres have unlimited capacity.
 */
import { addWorking, nextWorking, type Calendar } from './calendar';

export interface SchedWorkCenter {
  id: string;
  cal: Calendar;
  units: number;
  /** 1 = 100 %. Durations are divided by it. */
  efficiency: number;
  infinite: boolean;
}

export interface SchedOp {
  id: string;
  workOrderId: string;
  seq: number;
  workCenterId: string;
  itemId: string;
  setupMinutes: number;
  /** Remaining run minutes. */
  runMinutes: number;
  running: boolean;
  locked: { start: number; lane: number } | null;
}

export interface SchedOrder {
  id: string;
  priority: number;
  /** End of the due day, or null. */
  due: number | null;
  release: number;
}

export interface ScheduledOp {
  id: string;
  start: number;
  end: number;
  lane: number;
  setup: number;
  /** A locked operation placed before its predecessor ends. */
  conflict: boolean;
}

export interface ScheduledOrder {
  id: string;
  start: number | null;
  end: number | null;
  late: boolean;
}

interface Slot {
  start: number;
  end: number;
  itemId: string;
  opId: string;
}

export function schedule(input: { now: number; workCenters: Map<string, SchedWorkCenter>; orders: SchedOrder[]; ops: SchedOp[]; transitions: Map<string, number> }) {
  const { now, workCenters, transitions } = input;
  const lanes = new Map<string, Slot[][]>();
  const lanesOf = (wc: SchedWorkCenter) => {
    let l = lanes.get(wc.id);
    if (!l) {
      l = Array.from({ length: wc.infinite ? 1 : Math.max(1, wc.units) }, () => []);
      lanes.set(wc.id, l);
    }
    return l;
  };
  const insert = (lane: Slot[], s: Slot) => {
    let i = lane.length;
    while (i > 0 && lane[i - 1].start > s.start) i--;
    lane.splice(i, 0, s);
  };
  const setupFor = (wc: SchedWorkCenter, op: SchedOp, prevItem: string | null) => {
    if (prevItem === op.itemId) return 0;
    if (prevItem) {
      const t = transitions.get(`${wc.id}|${prevItem}|${op.itemId}`);
      if (t !== undefined) return t;
    }
    return op.setupMinutes;
  };
  const duration = (wc: SchedWorkCenter, setup: number, op: SchedOp) => (setup + op.runMinutes) / (wc.efficiency > 0 ? wc.efficiency : 1);
  const prevItemAt = (lane: Slot[], t: number) => {
    let prev: string | null = null;
    for (const s of lane) {
      if (s.end <= t) prev = s.itemId;
      else break;
    }
    return prev;
  };

  const out = new Map<string, ScheduledOp>();
  const byOrder = new Map<string, SchedOp[]>();
  for (const op of input.ops) {
    const list = byOrder.get(op.workOrderId) ?? [];
    list.push(op);
    byOrder.set(op.workOrderId, list);
  }
  for (const list of byOrder.values()) list.sort((a, b) => a.seq - b.seq);

  // Hand-placed operations first, exactly where they were put.
  for (const op of input.ops) {
    if (!op.locked) continue;
    const wc = workCenters.get(op.workCenterId);
    if (!wc) continue;
    const ls = lanesOf(wc);
    const laneNo = Math.min(Math.max(0, op.locked.lane), ls.length - 1);
    const lane = ls[laneNo];
    const start = nextWorking(wc.cal, op.locked.start);
    const setup = setupFor(wc, op, prevItemAt(lane, start));
    const end = addWorking(wc.cal, start, duration(wc, setup, op));
    insert(lane, { start, end, itemId: op.itemId, opId: op.id });
    out.set(op.id, { id: op.id, start, end, lane: laneNo, setup, conflict: false });
  }

  const orders = [...input.orders].sort((a, b) => {
    const ra = (byOrder.get(a.id) ?? []).some((o) => o.running) ? 0 : 1;
    const rb = (byOrder.get(b.id) ?? []).some((o) => o.running) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const da = a.due ?? Number.MAX_SAFE_INTEGER;
    const db = b.due ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.release - b.release;
  });

  const result: ScheduledOrder[] = [];
  for (const order of orders) {
    let ready = Math.max(now, order.release);
    let first: number | null = null;
    for (const op of byOrder.get(order.id) ?? []) {
      const wc = workCenters.get(op.workCenterId);
      if (!wc) continue;
      const placed = out.get(op.id);
      if (placed) {
        if (placed.start < ready) placed.conflict = true;
        ready = Math.max(ready, placed.end);
        first ??= placed.start;
        continue;
      }
      const opReady = op.running ? now : ready;
      let best: ScheduledOp | null = null;
      const ls = lanesOf(wc);
      for (let li = 0; li < ls.length; li++) {
        const lane = ls[li];
        let start = nextWorking(wc.cal, opReady);
        let setup = 0;
        let end = start;
        for (let guard = 0; guard < 10_000; guard++) {
          setup = setupFor(wc, op, prevItemAt(lane, start));
          end = addWorking(wc.cal, start, duration(wc, setup, op));
          if (wc.infinite) break;
          const clash = lane.find((s) => s.start < end && s.end > start);
          if (!clash) break;
          start = nextWorking(wc.cal, clash.end);
        }
        if (!best || end < best.end || (end === best.end && setup < best.setup)) best = { id: op.id, start, end, lane: li, setup, conflict: false };
      }
      if (!best) continue;
      if (!wc.infinite) insert(ls[best.lane], { start: best.start, end: best.end, itemId: op.itemId, opId: op.id });
      out.set(op.id, best);
      first ??= best.start;
      ready = best.end;
    }
    const hasOps = (byOrder.get(order.id) ?? []).length > 0;
    result.push({ id: order.id, start: first, end: hasOps ? ready : null, late: hasOps && order.due !== null && ready > order.due });
  }
  return { ops: [...out.values()], orders: result };
}
