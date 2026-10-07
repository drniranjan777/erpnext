import { Decimal } from '../../common/decimal';

const D = Decimal.from;
const ZERO = D('0');
const HUNDRED = D('100');
const SIXTY = D('60');

/**
 * How a formula line's quantity is stated:
 *  - percent: % of the batch size (mass balance), e.g. 12.5 % of a 1,000 kg batch;
 *  - fixed: quantity per formula batch, scaled with the batch;
 *  - potency: quantity of the pure active per formula batch; the lot actually issued is
 *    weighed up for its assay (a 98 % lot needs 100 / 98 of the pure quantity).
 */
export type Basis = 'percent' | 'fixed' | 'potency';

export interface FormulaLineData {
  kind: 'ingredient' | 'coproduct' | 'byproduct';
  itemId: string;
  basis: Basis;
  qty: string;
  /** potency basis: the assay the standard quantity assumes (default 100 %). */
  stdPotency?: string | null;
  tolerancePct?: string | null;
  costSharePct?: string | null;
  recoveryRate?: string | null;
  stageSeq?: number | null;
}

export interface FormulaData {
  itemId: string;
  batchSize: string;
  /** Expected output as % of the input mass. */
  yieldPct: string;
  lines: FormulaLineData[];
  stages: { seq: number; workCenterId: string; minutes: string }[];
}

/** Quantity of a line for a batch of `batchQty` (before any assay adjustment). */
export function lineQty(l: FormulaLineData, formulaBatch: string, batchQty: string) {
  const scale = D(batchQty).div(D(formulaBatch));
  if (l.basis === 'percent') return D(l.qty).mul(D(batchQty)).div(HUNDRED);
  if (l.basis === 'potency') return D(l.qty).mul(scale).mul(HUNDRED).div(D(l.stdPotency ?? '100'));
  return D(l.qty).mul(scale);
}

/** Every line scaled to a batch. */
export function scale(f: FormulaData, batchQty: string) {
  return f.lines.map((l) => ({ ...l, required: lineQty(l, f.batchSize, batchQty).toFixed(4) }));
}

/**
 * Potency adjustment at dispensing: a potency line's standard quantity assumes `stdPotency`;
 * a lot assaying `assayPct` needs required × stdPotency ÷ assay.
 */
export function adjustForAssay(required: string, stdPotency: string | null | undefined, assayPct: string | null | undefined) {
  if (!assayPct) return D(required);
  if (D(assayPct).cmp(ZERO) <= 0) throw new Error('Assay must be more than zero');
  return D(required).mul(D(stdPotency ?? '100')).div(D(assayPct));
}

/** Within tolerance: |dispensed − target| ≤ tolerance % of target (no tolerance = exact to 4 dp). */
export function withinTolerance(dispensed: string, target: Decimal, tolerancePct: string | null | undefined) {
  const diff = D(dispensed).sub(target).abs();
  const allowed = target.mul(D(tolerancePct ?? '0')).div(HUNDRED);
  return diff.cmp(allowed) <= 0;
}

/** Theoretical output of a batch from the ingredient mass, and the actual yield against it. */
export function yieldOf(inputQty: string, yieldPct: string, outputQty: string) {
  const theoretical = D(inputQty).mul(D(yieldPct)).div(HUNDRED);
  const pct = theoretical.isZero() ? ZERO : D(outputQty).mul(HUNDRED).div(theoretical);
  return { theoretical: theoretical.toFixed(4), actualPct: pct.toFixed(2), loss: theoretical.sub(D(outputQty)).toFixed(4) };
}

export interface FormulaCost {
  material: string;
  conversion: string;
  byproductCredit: string;
  /** Per unit of the main product (after co-products take their share). */
  unitCost: string;
  batchCost: string;
  missing: string[];
  coproducts: { itemId: string; qty: string; share: string; unitCost: string }[];
}

/**
 * Standard cost of a batch of the formula size: ingredients at item cost, stage minutes at
 * work-centre rates, less by-product recoveries; co-products take their cost share, the main
 * product the rest, spread over its expected output.
 */
export function formulaCost(f: FormulaData, itemCost: (id: string) => string | null, hourly: (wc: string) => string): FormulaCost {
  let material = ZERO;
  let credit = ZERO;
  const missing: string[] = [];
  const batch = f.batchSize;
  for (const l of f.lines) {
    const q = lineQty(l, batch, batch);
    if (l.kind === 'byproduct') {
      credit = credit.add(q.mul(D(l.recoveryRate ?? '0')));
      continue;
    }
    if (l.kind !== 'ingredient') continue;
    const c = itemCost(l.itemId);
    if (c === null) missing.push(l.itemId);
    material = material.add(q.mul(D(c ?? '0')));
  }
  const conversion = f.stages.reduce((s, st) => s.add(D(st.minutes).mul(D(hourly(st.workCenterId))).div(SIXTY)), ZERO);
  const batchCost = material.add(conversion).sub(credit);
  const coLines = f.lines.filter((l) => l.kind === 'coproduct');
  const coShare = coLines.reduce((s, l) => s.add(D(l.costSharePct ?? '0')), ZERO);
  const coproducts = coLines.map((l) => {
    const q = lineQty(l, batch, batch);
    const share = batchCost.mul(D(l.costSharePct ?? '0')).div(HUNDRED);
    return { itemId: l.itemId, qty: q.toFixed(4), share: share.toFixed(2), unitCost: q.isZero() ? '0' : share.div(q).toFixed(4) };
  });
  const mainShare = batchCost.mul(HUNDRED.sub(coShare)).div(HUNDRED);
  // Output of the main product per batch: the batch size at the formula's yield.
  const output = D(batch).mul(D(f.yieldPct)).div(HUNDRED);
  return {
    material: material.toFixed(2),
    conversion: conversion.toFixed(2),
    byproductCredit: credit.toFixed(2),
    batchCost: batchCost.toFixed(2),
    unitCost: output.isZero() ? '0' : mainShare.div(output).toFixed(4),
    missing: [...new Set(missing)],
    coproducts,
  };
}
