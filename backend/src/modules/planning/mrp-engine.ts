/**
 * Material requirements planning, in memory.
 *
 * Items are planned top-down in low-level-code order (every parent before its components), so
 * a component sees the dependent demand of all its parents' planned orders. For each item the
 * engine walks its demand and receipts by date, keeps the projected balance at or above safety
 * stock, pulls in later receipts before planning new ones, sizes planned orders by the item's
 * lot-sizing rule and offsets them by lead time. Dates are ISO strings (YYYY-MM-DD).
 */

export type LotSizing = 'l4l' | 'fixed' | 'eoq' | 'min_max' | 'period';
export type Source = 'make' | 'buy' | 'batch';

export interface PlanItem {
  id: string;
  code: string;
  source: Source;
  leadTimeDays: number;
  safetyStock: number;
  minOrderQty: number;
  lotSizing: LotSizing;
  /** fixed: the lot; min_max: the max level; eoq: the economic quantity; period: days covered. */
  lotQty: number;
  periodDays: number;
  /** Orders are rounded up to a multiple of this (formula batch multiple, pack). */
  multiple: number;
  /** A make item with nothing to make it from. */
  missingStructure?: boolean;
  /** eoq: the economic quantity comes from the item's gross demand over the horizon, annualised. */
  eoq?: { orderCost: number; unitCost: number; holdingPct: number };
}

export interface Ref {
  kind: string;
  id?: string | null;
  number?: string | null;
}

export interface Demand {
  itemId: string;
  date: string;
  qty: number;
  /** sales_order | forecast | work_order (material for an open order) | planned_order */
  ref: Ref;
}

export interface Receipt {
  itemId: string;
  date: string;
  qty: number;
  /** purchase_order | requisition | work_order | firmed (a firmed planned order) */
  ref: Ref;
}

export interface Peg {
  kind: string;
  id?: string | null;
  number?: string | null;
  date: string;
  qty: number;
  itemId?: string;
}

export interface PlannedOrderOut {
  key: number;
  itemId: string;
  source: Source;
  qty: number;
  dueDate: string;
  releaseDate: string;
  level: number;
  pegs: Peg[];
}

export type ExceptionKind = 'expedite' | 'reschedule_in' | 'reschedule_out' | 'cancel' | 'past_due' | 'late_demand' | 'below_safety' | 'no_structure' | 'bom_loop';

export interface ExceptionOut {
  itemId: string;
  kind: ExceptionKind;
  date: string | null;
  qty: number | null;
  ref: Ref | null;
  message: string;
  toDate?: string | null;
}

export interface TimelineRow {
  date: string;
  kind: 'on_hand' | 'demand' | 'receipt' | 'planned';
  qty: number;
  ref: Ref | null;
  balance: number;
}

export interface ItemPlanOut {
  itemId: string;
  level: number;
  onHand: number;
  safetyStock: number;
  demand: number;
  receipts: number;
  planned: number;
  endBalance: number;
  firstShortage: string | null;
  timeline: TimelineRow[];
}

export interface MrpInput {
  today: string;
  horizonEnd: string;
  items: Map<string, PlanItem>;
  /** Components per unit of a make item (scrap included). */
  structure: Map<string, { itemId: string; qtyPer: number }[]>;
  onHand: Map<string, number>;
  demands: Demand[];
  receipts: Receipt[];
  /** Reschedule-out messages only when the receipt could move by more than this. */
  rescheduleDays?: number;
  timelineLimit?: number;
}

export interface MrpOutput {
  plannedOrders: PlannedOrderOut[];
  exceptions: ExceptionOut[];
  plans: ItemPlanOut[];
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const EPS = 1e-6;

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Order quantity for a net requirement under the item's rule (before MOQ and multiple). */
export function lotSize(item: PlanItem, net: number, projectedBefore: number, upcoming: number) {
  let q = net;
  switch (item.lotSizing) {
    case 'fixed':
      if (item.lotQty > 0) q = Math.ceil(net / item.lotQty - EPS) * item.lotQty;
      break;
    case 'eoq':
      q = Math.max(net, item.lotQty);
      break;
    case 'min_max':
      // Order up to the max level.
      if (item.lotQty > 0) q = Math.max(net, item.lotQty - projectedBefore);
      break;
    case 'period':
      q = net + Math.max(0, upcoming);
      break;
  }
  if (item.minOrderQty > 0) q = Math.max(q, item.minOrderQty);
  if (item.multiple > 0) q = Math.ceil(q / item.multiple - EPS) * item.multiple;
  return r4(q);
}

/**
 * Low-level codes: 0 for top items, else one more than the deepest parent. Items caught in a
 * structure loop are returned separately.
 */
export function lowLevelCodes(itemIds: Iterable<string>, structure: Map<string, { itemId: string }[]>) {
  const ids = new Set(itemIds);
  const indegree = new Map<string, number>();
  for (const id of ids) indegree.set(id, 0);
  for (const [parent, comps] of structure) {
    if (!ids.has(parent)) continue;
    for (const c of new Set(comps.map((x) => x.itemId))) if (ids.has(c) && c !== parent) indegree.set(c, (indegree.get(c) ?? 0) + 1);
  }
  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, n] of indegree) if (n === 0) {
    queue.push(id);
    level.set(id, 0);
  }
  const order: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const c of new Set((structure.get(id) ?? []).map((x) => x.itemId))) {
      if (!ids.has(c) || c === id) continue;
      level.set(c, Math.max(level.get(c) ?? 0, (level.get(id) ?? 0) + 1));
      const n = indegree.get(c)! - 1;
      indegree.set(c, n);
      if (n === 0) queue.push(c);
    }
  }
  const done = new Set(order);
  const looped = [...ids].filter((id) => !done.has(id));
  return { order, level, looped };
}

export function runMrp(input: MrpInput): MrpOutput {
  const { today, horizonEnd, items } = input;
  const rescheduleDays = input.rescheduleDays ?? 3;
  const limit = input.timelineLimit ?? 250;
  const plannedOrders: PlannedOrderOut[] = [];
  const exceptions: ExceptionOut[] = [];
  const plans: ItemPlanOut[] = [];

  const demandBy = new Map<string, Demand[]>();
  for (const d of input.demands) {
    if (d.qty <= EPS || !items.has(d.itemId)) continue;
    if (d.date > horizonEnd) continue;
    const list = demandBy.get(d.itemId) ?? [];
    list.push(d);
    demandBy.set(d.itemId, list);
  }
  const receiptBy = new Map<string, Receipt[]>();
  for (const r of input.receipts) {
    if (r.qty <= EPS || !items.has(r.itemId)) continue;
    const list = receiptBy.get(r.itemId) ?? [];
    list.push(r);
    receiptBy.set(r.itemId, list);
  }

  const { order, level, looped } = lowLevelCodes(items.keys(), input.structure);
  for (const id of looped) exceptions.push({ itemId: id, kind: 'bom_loop', date: null, qty: null, ref: null, message: 'The item is part of a structure loop (it is, directly or indirectly, its own component); its components were not planned.' });
  const loopSet = new Set(looped);
  let key = 0;

  for (const itemId of [...order, ...looped]) {
    let item = items.get(itemId)!;
    const lvl = level.get(itemId) ?? 0;
    const ss = item.safetyStock;
    const onHand = input.onHand.get(itemId) ?? 0;
    const timeline: TimelineRow[] = [{ date: today, kind: 'on_hand', qty: r4(onHand), ref: null, balance: r4(onHand) }];

    // Late demand moves to today; demand is grouped by date.
    const demands = (demandBy.get(itemId) ?? []).map((d) => {
      if (d.date < today) {
        if (d.ref.kind === 'sales_order') exceptions.push({ itemId, kind: 'late_demand', date: d.date, qty: r4(d.qty), ref: d.ref, message: `${d.ref.number ?? 'Order'} was due ${d.date} and is still open.` });
        return { ...d, date: today };
      }
      return d;
    });
    demands.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (item.lotSizing === 'eoq' && item.eoq) {
      const gross = demands.reduce((s, d) => s + d.qty, 0);
      const annual = (gross * 365) / Math.max(1, daysBetween(today, horizonEnd));
      item = { ...item, lotQty: eoq(annual, item.eoq.orderCost, item.eoq.unitCost, item.eoq.holdingPct) };
    }
    const receipts = (receiptBy.get(itemId) ?? []).map((r) => {
      if (r.date < today) {
        exceptions.push({ itemId, kind: 'past_due', date: r.date, qty: r4(r.qty), ref: r.ref, message: `${r.ref.number ?? 'Receipt'} was due ${r.date} and has not arrived: expedite or re-date it.` });
        return { ...r, date: today, pulled: false, plannedDate: today };
      }
      return { ...r, pulled: false, plannedDate: r.date };
    });
    receipts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const dates = [...new Set([today, ...demands.map((d) => d.date), ...receipts.map((r) => r.date)])].sort();
    let projected = onHand;
    let di = 0;
    let firstShortage: string | null = null;
    let totalDemand = 0;
    let totalReceipts = 0;
    let totalPlanned = 0;
    const balances: { date: string; balance: number }[] = [];
    if (onHand < ss - EPS) exceptions.push({ itemId, kind: 'below_safety', date: today, qty: r4(ss - onHand), ref: null, message: `Stock ${r4(onHand)} is below safety stock ${r4(ss)}.` });

    for (const date of dates) {
      for (const r of receipts) {
        if (r.pulled || r.date !== date) continue;
        projected += r.qty;
        totalReceipts += r.qty;
        timeline.push({ date, kind: 'receipt', qty: r4(r.qty), ref: r.ref, balance: r4(projected) });
      }
      const today_ = [] as Demand[];
      while (di < demands.length && demands[di].date === date) today_.push(demands[di++]);
      for (const d of today_) {
        projected -= d.qty;
        totalDemand += d.qty;
        timeline.push({ date, kind: 'demand', qty: r4(d.qty), ref: d.ref, balance: r4(projected) });
      }
      if (projected < ss - EPS) {
        if (!firstShortage && projected < -EPS) firstShortage = date;
        // Pull later receipts in before planning anything new.
        for (const r of receipts) {
          if (projected >= ss - EPS) break;
          if (r.pulled || r.date <= date) continue;
          r.pulled = true;
          r.plannedDate = date;
          projected += r.qty;
          totalReceipts += r.qty;
          exceptions.push({ itemId, kind: 'reschedule_in', date: r.date, toDate: date, qty: r4(r.qty), ref: r.ref, message: `Bring ${r.ref.number ?? 'the receipt'} forward from ${r.date} to ${date}.` });
          timeline.push({ date, kind: 'receipt', qty: r4(r.qty), ref: { ...r.ref, kind: `${r.ref.kind}` }, balance: r4(projected) });
        }
      }
      if (projected < ss - EPS) {
        const net = ss - projected;
        let upcoming = 0;
        if (item.lotSizing === 'period' && item.periodDays > 0) {
          const until = addDays(date, item.periodDays);
          for (let j = di; j < demands.length && demands[j].date < until; j++) upcoming += demands[j].qty;
          for (const r of receipts) if (!r.pulled && r.date > date && r.date < until) upcoming -= r.qty;
        }
        const qty = lotSize(item, net, projected, upcoming);
        let release = addDays(date, -item.leadTimeDays);
        if (release < today) {
          exceptions.push({ itemId, kind: 'expedite', date: release, toDate: date, qty, ref: null, message: `Needed ${date} but the lead time is ${item.leadTimeDays} day${item.leadTimeDays === 1 ? '' : 's'}: order today and expedite.` });
          release = today;
        }
        const pegs: Peg[] = [];
        let left = qty;
        for (const d of today_) {
          if (left <= EPS) break;
          const q = Math.min(d.qty, left);
          pegs.push({ kind: d.ref.kind, id: d.ref.id ?? null, number: d.ref.number ?? null, date: d.date, qty: r4(q) });
          left -= q;
        }
        if (left > EPS) pegs.push({ kind: item.lotSizing === 'l4l' || projected < 0 ? 'safety_stock' : 'lot_size', date, qty: r4(left) });
        const po: PlannedOrderOut = { key: ++key, itemId, source: item.source, qty, dueDate: date, releaseDate: release, level: lvl, pegs };
        plannedOrders.push(po);
        projected += qty;
        totalPlanned += qty;
        timeline.push({ date, kind: 'planned', qty, ref: { kind: 'planned_order' }, balance: r4(projected) });

        // Dependent demand on the components, at the release date.
        if (item.source !== 'buy' && !loopSet.has(itemId)) {
          for (const c of input.structure.get(itemId) ?? []) {
            if (!items.has(c.itemId)) continue;
            const list = demandBy.get(c.itemId) ?? [];
            list.push({ itemId: c.itemId, date: release, qty: r4(qty * c.qtyPer), ref: { kind: 'planned_order', id: `#${po.key}`, number: item.code } });
            demandBy.set(c.itemId, list);
          }
        }
      }
      balances.push({ date, balance: projected });
    }
    if (item.source !== 'buy' && item.missingStructure && totalPlanned > 0) exceptions.push({ itemId, kind: 'no_structure', date: null, qty: null, ref: null, message: 'Planned to make, but the item has no approved default BOM or formula: its materials were not planned.' });

    // Receipts that are not needed when they arrive: move out, or cancel.
    for (const r of receipts) {
      if (r.pulled || r.ref.kind === 'firmed') continue;
      const after = balances.filter((b) => b.date >= r.date);
      if (!after.length) continue;
      const minAfter = Math.min(...after.map((b) => b.balance));
      if (minAfter - r.qty >= ss - EPS) {
        exceptions.push({ itemId, kind: 'cancel', date: r.date, qty: r4(r.qty), ref: r.ref, message: `${r.ref.number ?? 'The receipt'} is not needed within the horizon: cancel or reduce it.` });
        continue;
      }
      const need = after.find((b) => b.balance - r.qty < ss - EPS);
      if (need && daysBetween(r.date, need.date) > rescheduleDays) exceptions.push({ itemId, kind: 'reschedule_out', date: r.date, toDate: need.date, qty: r4(r.qty), ref: r.ref, message: `${r.ref.number ?? 'The receipt'} can move out from ${r.date} to ${need.date}.` });
    }

    const active = demands.length || receipts.length || totalPlanned > 0 || onHand < ss - EPS;
    if (active)
      plans.push({
        itemId,
        level: lvl,
        onHand: r4(onHand),
        safetyStock: r4(ss),
        demand: r4(totalDemand),
        receipts: r4(totalReceipts),
        planned: r4(totalPlanned),
        endBalance: r4(projected),
        firstShortage,
        timeline: timeline.slice(0, limit),
      });
  }
  return { plannedOrders, exceptions, plans };
}

/** Economic order quantity: √(2 × annual demand × cost per order ÷ holding cost per unit-year). */
export function eoq(annualDemand: number, orderCost: number, unitCost: number, holdingPct: number) {
  const h = (unitCost * holdingPct) / 100;
  if (annualDemand <= 0 || orderCost <= 0 || h <= 0) return 0;
  return r4(Math.sqrt((2 * annualDemand * orderCost) / h));
}
