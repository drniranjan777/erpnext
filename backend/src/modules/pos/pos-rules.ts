import type { PosLine, ZReport } from '@nextgen/database';

/**
 * Point-of-sale rules. Shelf prices include GST (as MRP does), so tax is taken out of the price:
 * taxable = gross / (1 + rate); the bill rounds to the rupee with the difference shown as round-off.
 */

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function line(l: { itemId: string; code: string; name: string; qty: number; price: number; discountPct?: number; gstRate: number }): PosLine {
  const disc = l.discountPct ?? 0;
  const total = r2(l.qty * l.price * (1 - disc / 100));
  const taxable = r2(total / (1 + l.gstRate / 100));
  return { itemId: l.itemId, code: l.code, name: l.name, qty: l.qty, price: l.price, discountPct: disc, gstRate: l.gstRate, taxable, tax: r2(total - taxable), total };
}

export function bill(lines: PosLine[]) {
  const gross = r2(lines.reduce((a, l) => a + l.total, 0));
  const total = Math.round(gross);
  return { taxable: r2(lines.reduce((a, l) => a + l.taxable, 0)), tax: r2(lines.reduce((a, l) => a + l.tax, 0)), gross, roundOff: r2(total - gross), total };
}

export const TENDERS = ['cash', 'card', 'upi'] as const;

/** Card and UPI amounts can't exceed the bill; any excess must be cash, returned as change. */
export function tenderProblem(total: number, tenders: { mode: string; amount: number }[]) {
  const paid = r2(tenders.reduce((a, t) => a + t.amount, 0));
  const nonCash = r2(tenders.filter((t) => t.mode !== 'cash').reduce((a, t) => a + t.amount, 0));
  if (tenders.some((t) => t.amount < 0)) return { problem: 'Amounts cannot be negative', change: 0 };
  if (paid < total) return { problem: `₹${r2(total - paid)} still to pay`, change: 0 };
  if (nonCash > total) return { problem: 'Card and UPI cannot be more than the bill', change: 0 };
  return { problem: null, change: r2(paid - total) };
}

/** The day-close report: sales and returns, money by tender (change is cash out), GST by rate, cash to count. */
export function zReport(openingCash: number, sales: { kind: string; total: number; change: number; tenders: { mode: string; amount: number }[]; lines: PosLine[] }[], countedCash: number): ZReport {
  const byTender: ZReport['byTender'] = {};
  const byRate: ZReport['byRate'] = {};
  const add = (mode: string, k: 'in' | 'out', v: number) => {
    byTender[mode] ??= { in: 0, out: 0 };
    byTender[mode][k] = r2(byTender[mode][k] + v);
  };
  for (const s of sales) {
    const sign = s.kind === 'return' ? -1 : 1;
    for (const t of s.tenders) add(t.mode, sign > 0 ? 'in' : 'out', t.amount);
    if (s.change) add('cash', 'out', s.change);
    for (const l of s.lines) {
      const k = String(l.gstRate);
      byRate[k] ??= { taxable: 0, tax: 0 };
      byRate[k].taxable = r2(byRate[k].taxable + sign * l.taxable);
      byRate[k].tax = r2(byRate[k].tax + sign * l.tax);
    }
  }
  const sold = sales.filter((s) => s.kind === 'sale');
  const ret = sales.filter((s) => s.kind === 'return');
  const expectedCash = r2(openingCash + (byTender.cash?.in ?? 0) - (byTender.cash?.out ?? 0));
  return {
    sales: sold.length,
    salesAmount: r2(sold.reduce((a, s) => a + s.total, 0)),
    returns: ret.length,
    returnsAmount: r2(ret.reduce((a, s) => a + s.total, 0)),
    byTender,
    byRate,
    expectedCash,
    countedCash,
    difference: r2(countedCash - expectedCash),
  };
}
