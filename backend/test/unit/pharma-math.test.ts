import { describe, expect, it } from 'vitest';
import { apiQrContent, ceilingOn, dpcoBreaches, gs1DataMatrix, gs1Hri, linearFit, pullDate, randomSerial, shelfLife, t95, toGtin14, validGtin } from '../../src/modules/pharma/pharma-math';

describe('stability (ICH Q1E)', () => {
  const assay = [
    { x: 0, y: 100.2 },
    { x: 3, y: 99.5 },
    { x: 6, y: 98.9 },
    { x: 9, y: 98.1 },
    { x: 12, y: 97.6 },
  ];

  it('fits the trend', () => {
    const f = linearFit(assay)!;
    expect(f.slope).toBeCloseTo(-0.22, 2);
    expect(f.intercept).toBeCloseTo(100.18, 2);
    expect(linearFit(assay.slice(0, 2))).toBeNull();
    expect(t95(3)).toBe(2.353);
    expect(t95(40)).toBeCloseTo(1.684, 2);
  });

  it('supports a shelf life where the lower confidence bound meets the specification, limited by extrapolation', () => {
    // Mean reaches 95 % at about 23.5 months; the lower bound gets there a little earlier; ICH caps 12 months of data at 24.
    const r = shelfLife(assay, 95, null)!;
    expect(r.limitedBy).toBe('data');
    expect(r.months).toBeGreaterThanOrEqual(20);
    expect(r.months).toBeLessThan(24);
    const flat = shelfLife(assay.map((p) => ({ ...p, y: 100 + (p.x % 2) * 0.1 })), 95, null)!;
    expect(flat).toMatchObject({ months: 24, limitedBy: 'extrapolation' });
    const impurity = shelfLife([{ x: 0, y: 0.1 }, { x: 3, y: 0.2 }, { x: 6, y: 0.3 }, { x: 9, y: 0.4 }], null, 0.5)!;
    expect(impurity.months).toBeLessThanOrEqual(12);
  });

  it('works out pull dates', () => {
    expect(pullDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(pullDate('2026-01-15', 6)).toBe('2026-07-15');
    expect(pullDate('2026-01-15', 0)).toBe('2026-01-15');
  });
});

describe('GS1 serialisation', () => {
  it('validates GTINs and builds the element strings', () => {
    expect(validGtin('08901234567890')).toBe(true);
    expect(validGtin('08901234567891')).toBe(false);
    expect(toGtin14('8901234567890')).toBe('08901234567890');
    const u = { gtin: '08901234567890', serial: 'A1B2C3D4E5F6', batchNo: 'PCM2610', expiryDate: '2028-09-30' };
    expect(gs1Hri(u)).toBe('(01)08901234567890(17)280930(10)PCM2610(21)A1B2C3D4E5F6');
    expect(gs1DataMatrix(u)).toBe('010890123456789017280930' + '10PCM2610\u001d21A1B2C3D4E5F6');
    const serials = new Set([...Array(500)].map(() => randomSerial()));
    expect(serials.size).toBe(500);
    expect([...serials].every((s) => /^[0-9A-HJ-NP-Z]{12}$/.test(s))).toBe(true);
  });
});

describe('DPCO', () => {
  const ceilings = [
    { itemId: 'pcm', ceilingPrice: 1.8, effectiveFrom: '2026-04-01', notification: 'S.O. 1234(E)' },
    { itemId: 'pcm', ceilingPrice: 1.7, effectiveFrom: '2025-04-01', notification: 'S.O. 999(E)' },
  ];

  it('applies the ceiling in force on the invoice date', () => {
    expect(ceilingOn(ceilings, 'pcm', '2026-03-31')?.ceilingPrice).toBe(1.7);
    expect(ceilingOn(ceilings, 'pcm', '2026-04-01')?.ceilingPrice).toBe(1.8);
    expect(ceilingOn(ceilings, 'pcm', '2025-01-01')).toBeNull();
    const r = dpcoBreaches(
      ceilings,
      [
        { invoice: 'INV/1', date: '2026-03-10', itemId: 'pcm', item: 'Paracetamol 500', unitPrice: 1.75 },
        { invoice: 'INV/2', date: '2026-05-10', itemId: 'pcm', item: 'Paracetamol 500', unitPrice: 1.75 },
      ],
      [{ itemId: 'pcm', item: 'Paracetamol 500', mrp: 1.95 }],
      '2026-10-08',
    );
    expect(r.sales).toEqual([{ invoice: 'INV/1', date: '2026-03-10', item: 'Paracetamol 500', unitPrice: 1.75, ceiling: 1.7, excess: 0.05, notification: 'S.O. 999(E)' }]);
    expect(r.mrp).toEqual([{ item: 'Paracetamol 500', mrp: 1.95, ceiling: 1.8, notification: 'S.O. 1234(E)' }]);
  });
});

describe('API label QR', () => {
  it('lists the mandatory fields, leaving out the empty ones', () => {
    const q = apiQrContent({ productCode: 'API-PCM', apiName: 'Paracetamol IP', manufacturer: 'Sri Lakshmi Pharma', address: 'IDA Jeedimetla, Hyderabad', batchNo: 'P2609', batchSize: '500 kg', mfgDate: '2026-09-10', expiryDate: '2031-08-31', sscc: '389012345000000017', licenceNo: 'MFG/TS/2020/001', storage: 'Store below 25 °C' });
    expect(q.split('\n')).toEqual(['UPIC: API-PCM', 'API: Paracetamol IP', 'Mfr: Sri Lakshmi Pharma, IDA Jeedimetla, Hyderabad', 'Batch: P2609', 'Batch size: 500 kg', 'Mfg: 2026-09-10', 'Exp: 2031-08-31', 'SSCC: 389012345000000017', 'Mfg Lic: MFG/TS/2020/001', 'Storage: Store below 25 °C']);
  });
});
