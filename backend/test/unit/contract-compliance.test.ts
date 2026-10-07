import { describe, expect, it } from 'vitest';
import { wageCheck } from '../../src/modules/hr/contract/compliance';

describe('contract wage check', () => {
  it('passes a correct payment', () => {
    // 26 days at ₹600 = 15,600; PF 12 % of 15,000 = 1,800; ESI 0.75 % = 117.
    const r = wageCheck({ daysPresent: 26, otHours: 0, agreedDaily: 600, minDaily: 550, declared: { daysPaid: 26, grossPaid: 15_600, pfDeducted: 1_800, esiDeducted: 117 }, hasUan: true });
    expect(r).toMatchObject({ rate: 600, dueGross: 15_600, shortfall: 0, expectedPf: 1_800, expectedEsi: 117, issues: [] });
  });
  it('raises the rate to the minimum wage and pays overtime at double', () => {
    const r = wageCheck({ daysPresent: 20, otHours: 8, agreedDaily: 500, minDaily: 560, declared: { daysPaid: 20, grossPaid: 10_000, pfDeducted: 1_200, esiDeducted: 75 }, hasUan: true });
    expect(r.rate).toBe(560);
    // 20 × 560 + 8 h × 2 × 70 = 11,200 + 1,120
    expect(r.dueGross).toBe(12_320);
    expect(r.shortfall).toBe(2_320);
    expect(r.issues).toEqual(['Agreed rate ₹500 is below the minimum wage ₹560', 'Paid ₹500.00 a day, below the minimum ₹560', '₹2320 short of the wages due']);
  });
  it('flags missing payments, fewer days and short PF / ESI', () => {
    expect(wageCheck({ daysPresent: 5, otHours: 0, agreedDaily: 600, minDaily: null, declared: null, hasUan: false }).issues).toEqual(['No wage payment recorded']);
    const r = wageCheck({ daysPresent: 22, otHours: 0, agreedDaily: 600, minDaily: null, declared: { daysPaid: 20, grossPaid: 12_000, pfDeducted: 0, esiDeducted: 0 }, hasUan: true });
    expect(r.issues).toEqual(['Paid for 20 days but attended 22', '₹1200 short of the wages due', 'PF ₹0 deducted; ₹1440 due', 'ESI ₹0 deducted; ₹90 due']);
  });
});
