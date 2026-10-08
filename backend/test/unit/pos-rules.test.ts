import { describe, expect, it } from 'vitest';
import { bill, line, tenderProblem, zReport } from '../../src/modules/pos/pos-rules';

describe('point of sale', () => {
  it('takes GST out of inclusive prices and rounds the bill', () => {
    const a = line({ itemId: 'a', code: 'A', name: 'Chair', qty: 2, price: 1180, gstRate: 18 });
    expect(a).toMatchObject({ total: 2360, taxable: 2000, tax: 360 });
    const b = line({ itemId: 'b', code: 'B', name: 'Cushion', qty: 3, price: 349.5, discountPct: 10, gstRate: 12 });
    expect(b).toMatchObject({ total: 943.65, taxable: 842.54, tax: 101.11 });
    expect(bill([a, b])).toEqual({ taxable: 2842.54, tax: 461.11, gross: 3303.65, roundOff: 0.35, total: 3304 });
  });

  it('checks tenders and gives change in cash', () => {
    expect(tenderProblem(3304, [{ mode: 'card', amount: 2000 }, { mode: 'cash', amount: 1500 }])).toEqual({ problem: null, change: 196 });
    expect(tenderProblem(3304, [{ mode: 'upi', amount: 3000 }]).problem).toBe('₹304 still to pay');
    expect(tenderProblem(1000, [{ mode: 'card', amount: 1200 }]).problem).toBe('Card and UPI cannot be more than the bill');
  });

  it('makes the day-close report', () => {
    const l = line({ itemId: 'a', code: 'A', name: 'Chair', qty: 1, price: 1180, gstRate: 18 });
    const z = zReport(
      500,
      [
        { kind: 'sale', total: 1180, change: 20, tenders: [{ mode: 'cash', amount: 1200 }], lines: [l] },
        { kind: 'sale', total: 1180, change: 0, tenders: [{ mode: 'upi', amount: 1180 }], lines: [l] },
        { kind: 'return', total: 1180, change: 0, tenders: [{ mode: 'cash', amount: 1180 }], lines: [l] },
      ],
      495,
    );
    expect(z).toEqual({ sales: 2, salesAmount: 2360, returns: 1, returnsAmount: 1180, byTender: { cash: { in: 1200, out: 1200 }, upi: { in: 1180, out: 0 } }, byRate: { '18': { taxable: 1000, tax: 180 } }, expectedCash: 500, countedCash: 495, difference: -5 });
  });
});
