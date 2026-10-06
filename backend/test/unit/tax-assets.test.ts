import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/common/decimal';
import { bookDepreciation, itBlockSchedule, wdvRate } from '../../src/modules/accounting/depreciation';
import { quarterRange } from '../../src/modules/accounting/tds.service';
import { computeSetOff, normaliseInvoiceNo } from '../../src/modules/compliance/gst-setoff';

const D = Decimal.from;
const heads = (igst: string, cgst: string, sgst: string, cess = '0') => ({ igst: D(igst), cgst: D(cgst), sgst: D(sgst), cess: D(cess) });

describe('GST set-off (s.49A / rule 88A)', () => {
  it('uses IGST credit first, placing the surplus where CGST / SGST credit falls short', () => {
    // Liability: IGST 1000, CGST 500, SGST 500. Credit: IGST 1300, CGST 100, SGST 600.
    const r = computeSetOff(heads('1000', '500', '500'), heads('1300', '100', '600'));
    expect(r.utilised.igst).toMatchObject({ igst: '1000.00', cgst: '0.00', sgst: '0.00' });
    // 300 IGST left: CGST needs 400 beyond its own 100 credit → all 300 go there.
    expect(r.utilised.cgst).toMatchObject({ igst: '300.00', cgst: '100.00' });
    expect(r.utilised.sgst).toMatchObject({ igst: '0.00', sgst: '500.00' });
    expect(r.cash).toMatchObject({ igst: '0.00', cgst: '100.00', sgst: '0.00' });
    // SGST credit cannot pay CGST: 100 SGST credit stays.
    expect(r.creditLeft).toMatchObject({ igst: '0.00', cgst: '0.00', sgst: '100.00' });
  });

  it('lets CGST and SGST credit pay IGST after their own heads, never each other', () => {
    const r = computeSetOff(heads('800', '100', '100'), heads('0', '500', '300'));
    expect(r.utilised.cgst.cgst).toBe('100.00');
    expect(r.utilised.sgst.sgst).toBe('100.00');
    expect(r.utilised.igst).toMatchObject({ cgst: '400.00', sgst: '200.00' });
    expect(r.cash.igst).toBe('200.00');
    expect(r.utilised.cgst.sgst).toBe('0.00');
  });

  it('keeps cess apart', () => {
    const r = computeSetOff(heads('0', '0', '0', '50'), heads('100', '0', '0', '20'));
    expect(r.utilised.cess).toMatchObject({ cess: '20.00', igst: '0.00' });
    expect(r.cash.cess).toBe('30.00');
  });
});

describe('invoice number matching for GSTR-2B', () => {
  it('ignores case, punctuation and leading zeros', () => {
    expect(normaliseInvoiceNo('SP/0012')).toBe(normaliseInvoiceNo('sp-12'));
    expect(normaliseInvoiceNo('INV 2026/007')).toBe('INV20267');
    expect(normaliseInvoiceNo('A-10')).not.toBe(normaliseInvoiceNo('A-100'));
  });
});

describe('book depreciation (Companies Act)', () => {
  const asset = { cost: '120000', residualValue: '6000', method: 'slm' as const, usefulLifeYears: '15', capitalisedOn: '2026-04-01', accumulated: '0', depreciatedUntil: null };

  it('SLM, day-based from the date put to use', () => {
    // (120000 − 6000) / 15 = 7600 a year; 183 days to 30 Sep.
    expect(bookDepreciation(asset, '2026-09-30')).toEqual({ from: '2026-04-01', to: '2026-09-30', days: 183, amount: '3810.41' });
    // Continues from where it stopped.
    expect(bookDepreciation({ ...asset, accumulated: '3810.41', depreciatedUntil: '2026-09-30' }, '2027-03-31')).toMatchObject({ from: '2026-10-01', days: 182, amount: '3789.59' });
    expect(bookDepreciation({ ...asset, depreciatedUntil: '2026-09-30' }, '2026-09-30')).toBeNull();
  });

  it('never goes below the residual value, and stops at disposal', () => {
    expect(bookDepreciation({ ...asset, accumulated: '113900' }, '2027-03-31')?.amount).toBe('100.00');
    expect(bookDepreciation({ ...asset, disposedOn: '2026-04-30' }, '2027-03-31')).toMatchObject({ to: '2026-04-30', days: 30 });
  });

  it('WDV at the rate that reaches residual value over the life', () => {
    const r = wdvRate('100000', '5000', '10');
    expect(r).toBeCloseTo(0.2589, 3);
    const d = bookDepreciation({ ...asset, cost: '100000', residualValue: '5000', usefulLifeYears: '10', method: 'wdv' }, '2027-03-31');
    expect(d?.amount).toBe('25886.60');
  });
});

describe('Income-tax block depreciation', () => {
  it('half rate for assets used under 180 days in the year of addition; sales reduce the block', () => {
    const s = itBlockSchedule(
      [
        { cost: '100000', capitalisedOn: '2025-05-01', disposedOn: null, disposalAmount: '0' },
        { cost: '40000', capitalisedOn: '2026-01-15', disposedOn: null, disposalAmount: '0' },
        { cost: '50000', capitalisedOn: '2026-06-01', disposedOn: '2026-12-01', disposalAmount: '30000' },
      ],
      '15',
      2026,
    );
    expect(s[0]).toMatchObject({ fy: '2025-26', opening: '0.00', additionsFull: '100000.00', additionsHalf: '40000.00', depreciation: '18000.00', closing: '122000.00' });
    // 2026-27: 122000 + 50000 − 30000 = 142000 at 15%.
    expect(s[1]).toMatchObject({ fy: '2026-27', opening: '122000.00', additionsFull: '50000.00', deletions: '30000.00', depreciation: '21300.00', closing: '120700.00' });
  });
});

describe('TDS quarters', () => {
  it('maps financial-year quarters to dates', () => {
    expect(quarterRange(2026, 1)).toEqual({ from: '2026-04-01', to: '2026-06-30', label: '2026-27 Q1' });
    expect(quarterRange(2026, 4)).toEqual({ from: '2027-01-01', to: '2027-03-31', label: '2026-27 Q4' });
  });
});
