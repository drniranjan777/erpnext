import { Decimal } from '../../common/decimal';

const D = Decimal.from;
const ZERO = D('0');
const HUNDRED = D('100');
const SIXTY = D('60');

export interface BomLineData {
  kind: 'component' | 'byproduct' | 'scrap';
  itemId: string;
  qty: string;
  scrapPct: string;
  isPhantom: boolean;
  alternateGroup: string | null;
  priority: number;
  recoveryRate: string | null;
}

export interface BomOperationData {
  seq: number;
  workCenterId: string;
  setupMinutes: string;
  runMinutes: string;
  isSubcontract: boolean;
  subcontractRate: string | null;
}

export interface BomData {
  id: string;
  itemId: string;
  quantity: string;
  lines: BomLineData[];
  operations: BomOperationData[];
}

/** Lines that are actually used: in each alternate group only the first by priority. */
export function activeLines(lines: BomLineData[]) {
  const best = new Map<string, BomLineData>();
  for (const l of lines) {
    if (!l.alternateGroup || l.kind !== 'component') continue;
    const cur = best.get(l.alternateGroup);
    if (!cur || l.priority < cur.priority) best.set(l.alternateGroup, l);
  }
  return lines.filter((l) => !l.alternateGroup || l.kind !== 'component' || best.get(l.alternateGroup) === l);
}

export interface ExplodedRow {
  level: number;
  itemId: string;
  parentItemId: string;
  qty: string;
  viaPhantom: boolean;
  hasBom: boolean;
}

/**
 * Requirements for making `qty` of a BOM's item. Phantom lines are always exploded; with
 * `multiLevel`, every component that has its own BOM is exploded too (indented BOM / MRP).
 * Quantities include scrap: line qty ÷ BOM qty × qty × (1 + scrap %).
 */
export function explode(root: BomData, qty: string, bomOf: (itemId: string) => BomData | null, multiLevel = false) {
  const rows: ExplodedRow[] = [];
  const totals = new Map<string, Decimal>();
  const walk = (bom: BomData, need: Decimal, level: number, path: string[], viaPhantom: boolean) => {
    if (path.includes(bom.itemId)) throw new Error(`The BOM is circular: ${[...path, bom.itemId].join(' → ')}`);
    for (const l of activeLines(bom.lines)) {
      if (l.kind !== 'component') continue;
      const q = D(l.qty).div(D(bom.quantity)).mul(need).mul(HUNDRED.add(D(l.scrapPct))).div(HUNDRED);
      const child = bomOf(l.itemId);
      const deeper = !!child && (l.isPhantom || multiLevel);
      rows.push({ level, itemId: l.itemId, parentItemId: bom.itemId, qty: q.toFixed(6), viaPhantom, hasBom: !!child });
      if (deeper) walk(child!, q, level + 1, [...path, bom.itemId], l.isPhantom);
      // Leaf requirements: what has to be issued (phantoms are never issued themselves).
      if (!(child && l.isPhantom) && !(deeper && multiLevel)) totals.set(l.itemId, (totals.get(l.itemId) ?? ZERO).add(q));
    }
  };
  walk(root, D(qty), 1, [], false);
  return { rows, requirements: [...totals.entries()].map(([itemId, q]) => ({ itemId, qty: q.toFixed(6) })) };
}

export interface CostRates {
  /** Per work centre: labour + machine + overhead per hour. */
  hourly: (workCenterId: string) => { labour: string; machine: string; overhead: string };
  /** Purchased / stocked cost of an item per base unit (standard, average or last purchase). */
  itemCost: (itemId: string) => string | null;
}

export interface CostBreakdown {
  material: string;
  operation: string;
  labour: string;
  machine: string;
  overhead: string;
  subcontract: string;
  byproductCredit: string;
  unitCost: string;
  lines: { itemId: string; qtyPerUnit: string; unitCost: string; amount: string; source: 'bom' | 'item' | 'missing' }[];
  missing: string[];
}

/**
 * Standard cost roll-up per unit of the BOM's item, bottom-up: sub-assemblies with a BOM use
 * their own rolled-up cost; operations cost (setup spread over the BOM quantity + run time) at
 * the work centre's hourly rates; sub-contract charges; less by-product recoveries.
 */
export function rollUp(root: BomData, rates: CostRates, bomOf: (itemId: string) => BomData | null, path: string[] = []): CostBreakdown {
  if (path.includes(root.itemId)) throw new Error(`The BOM is circular: ${[...path, root.itemId].join(' → ')}`);
  const batch = D(root.quantity);
  let material = ZERO;
  let credit = ZERO;
  const lines: CostBreakdown['lines'] = [];
  const missing: string[] = [];
  for (const l of activeLines(root.lines)) {
    const perUnit = D(l.qty).div(batch);
    if (l.kind === 'byproduct' || l.kind === 'scrap') {
      credit = credit.add(perUnit.mul(D(l.recoveryRate ?? '0')));
      continue;
    }
    const withScrap = perUnit.mul(HUNDRED.add(D(l.scrapPct))).div(HUNDRED);
    const child = bomOf(l.itemId);
    let unit: Decimal;
    let source: 'bom' | 'item' | 'missing';
    if (child) {
      const sub = rollUp(child, rates, bomOf, [...path, root.itemId]);
      unit = D(sub.unitCost);
      source = 'bom';
      missing.push(...sub.missing);
    } else {
      const c = rates.itemCost(l.itemId);
      unit = D(c ?? '0');
      source = c === null ? 'missing' : 'item';
      if (c === null) missing.push(l.itemId);
    }
    const amount = withScrap.mul(unit);
    material = material.add(amount);
    lines.push({ itemId: l.itemId, qtyPerUnit: withScrap.toFixed(6), unitCost: unit.toFixed(4), amount: amount.toFixed(4), source });
  }
  let labour = ZERO;
  let machine = ZERO;
  let overhead = ZERO;
  let subcontract = ZERO;
  for (const op of root.operations) {
    if (op.isSubcontract) {
      subcontract = subcontract.add(D(op.subcontractRate ?? '0'));
      continue;
    }
    const minutes = D(op.setupMinutes).div(batch).add(D(op.runMinutes));
    const h = rates.hourly(op.workCenterId);
    labour = labour.add(minutes.mul(D(h.labour)).div(SIXTY));
    machine = machine.add(minutes.mul(D(h.machine)).div(SIXTY));
    overhead = overhead.add(minutes.mul(D(h.overhead)).div(SIXTY));
  }
  const operation = labour.add(machine).add(overhead);
  const unit = material.add(operation).add(subcontract).sub(credit);
  return {
    material: material.toFixed(4),
    operation: operation.toFixed(4),
    labour: labour.toFixed(4),
    machine: machine.toFixed(4),
    overhead: overhead.toFixed(4),
    subcontract: subcontract.toFixed(4),
    byproductCredit: credit.toFixed(4),
    unitCost: unit.toFixed(4),
    lines,
    missing: [...new Set(missing)],
  };
}
