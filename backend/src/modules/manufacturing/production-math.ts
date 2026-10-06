import { Decimal } from '../../common/decimal';

const D = Decimal.from;
const ZERO = D('0');
const SIXTY = D('60');

/** Output may run this far over the ordered quantity (10 %). */
export const OVER_PRODUCTION = D('0.1');

const max0 = (d: Decimal) => (d.isNegative() ? ZERO : d);

/** Cost of time booked at a work centre: minutes × hourly rates ÷ 60. */
export function timeCost(minutes: string, rates: { labour: string; machine: string; overhead: string }) {
  const m = D(minutes);
  return {
    labour: m.mul(D(rates.labour)).div(SIXTY).toFixed(2),
    machine: m.mul(D(rates.machine)).div(SIXTY).toFixed(2),
    overhead: m.mul(D(rates.overhead)).div(SIXTY).toFixed(2),
  };
}

/** Shots / strokes a tool takes to make `pieces` with `cavities` per shot. */
export function shotsFor(pieces: string, cavities: number) {
  const p = Number(pieces);
  if (!(p > 0)) return 0;
  return Math.ceil(p / Math.max(1, cavities));
}

/** Planned minutes of an operation for a batch: setup + run × qty. */
export function plannedMinutes(setup: string, run: string, qty: string) {
  return D(setup).add(D(run).mul(D(qty))).toFixed(2);
}

/**
 * Backflush: what is still to issue so that consumption matches the standard for everything
 * made so far (good + rejected). Never negative; over-issued materials are left alone.
 */
export function backflushQty(m: { requiredQty: string; issuedQty: string }, woQty: string, madeAfter: string) {
  const target = D(m.requiredQty).mul(D(madeAfter)).div(D(woQty));
  return max0(target.sub(D(m.issuedQty))).toFixed(4);
}

/** What is still to issue against a material line. */
export function outstanding(m: { requiredQty: string; issuedQty: string }) {
  return max0(D(m.requiredQty).sub(D(m.issuedQty))).toFixed(4);
}

/** Work-in-progress balance of an order from its running totals. */
export function wipBalance(w: { materialCost: string; conversionCost: string; subcontractCost: string; outputValue: string; byproductValue: string; varianceValue: string }) {
  return D(w.materialCost).add(D(w.conversionCost)).add(D(w.subcontractCost)).sub(D(w.outputValue)).sub(D(w.byproductValue)).sub(D(w.varianceValue));
}

/**
 * Value of good output (and stocked rejects) taken out of WIP by a receipt.
 * At standard cost when the order has one; otherwise at actual: the WIP balance spread over
 * what is still to come, all of it when this receipt finishes the order.
 */
export function outputValue(p: { stdUnitCost: string; pieces: string; wip: Decimal; woQty: string; doneBefore: string; finishes: boolean }) {
  const pieces = D(p.pieces);
  if (pieces.isZero()) return ZERO;
  if (D(p.stdUnitCost).cmp(ZERO) > 0) return pieces.mul(D(p.stdUnitCost)).round(2);
  if (p.finishes) return max0(p.wip).round(2);
  const remaining = D(p.woQty).sub(D(p.doneBefore));
  if (remaining.cmp(pieces) <= 0) return max0(p.wip).round(2);
  return max0(p.wip).mul(pieces).div(remaining).round(2);
}

export interface VarianceInput {
  qty: string;
  producedQty: string;
  std: { material: string; operation: string; subcontract: string; byproduct: string; unitCost: string };
  actual: { material: string; conversion: string; subcontract: string; byproduct: string; output: string };
  materials: { kind: string; requiredQty: string; issuedQty: string; stdRate: string }[];
}

/**
 * Actual against standard for what was made. Material splits into usage (quantity off the
 * standard, at standard rates) and price (the rest). Positive = adverse.
 */
export function variances(v: VarianceInput) {
  const made = D(v.producedQty);
  const share = D(v.qty).isZero() ? ZERO : made.div(D(v.qty));
  const stdMaterial = D(v.std.material).mul(made);
  const stdOperation = D(v.std.operation).mul(made);
  const stdSubcontract = D(v.std.subcontract).mul(made);
  const stdByproduct = D(v.std.byproduct).mul(made);
  let usage = ZERO;
  for (const m of v.materials) {
    if (m.kind !== 'component') continue;
    usage = usage.add(D(m.issuedQty).sub(D(m.requiredQty).mul(share)).mul(D(m.stdRate)));
  }
  const material = D(v.actual.material).sub(stdMaterial);
  const conversion = D(v.actual.conversion).sub(stdOperation);
  const subcontract = D(v.actual.subcontract).sub(stdSubcontract);
  const byproduct = stdByproduct.sub(D(v.actual.byproduct));
  const actualTotal = D(v.actual.material).add(D(v.actual.conversion)).add(D(v.actual.subcontract)).sub(D(v.actual.byproduct));
  const stdTotal = D(v.std.unitCost).mul(made);
  const explained = material.add(conversion).add(subcontract).add(byproduct);
  const total = actualTotal.sub(stdTotal);
  return {
    standard: { material: stdMaterial.toFixed(2), operation: stdOperation.toFixed(2), subcontract: stdSubcontract.toFixed(2), byproduct: stdByproduct.toFixed(2), total: stdTotal.toFixed(2) },
    actualTotal: actualTotal.toFixed(2),
    actualUnitCost: made.isZero() ? null : actualTotal.div(made).toFixed(4),
    materialUsage: usage.toFixed(2),
    materialPrice: material.sub(usage).toFixed(2),
    conversion: conversion.toFixed(2),
    subcontract: subcontract.toFixed(2),
    byproduct: byproduct.toFixed(2),
    /** Standard unit cost differing from the BOM roll-up, rounding. */
    other: total.sub(explained).toFixed(2),
    total: total.toFixed(2),
  };
}

export interface MaterialNeed {
  itemId: string;
  outstanding: string;
}

/**
 * Shortages for releasing an order: outstanding need against what is on hand in the source
 * store less what other released orders have already reserved there.
 */
export function shortages(needs: MaterialNeed[], onHand: Map<string, string>, reserved: Map<string, string>) {
  return needs.map((n) => {
    const available = D(onHand.get(n.itemId) ?? '0').sub(D(reserved.get(n.itemId) ?? '0'));
    const short = max0(D(n.outstanding).sub(available));
    return { itemId: n.itemId, required: n.outstanding, available: available.toFixed(4), short: short.toFixed(4) };
  });
}
