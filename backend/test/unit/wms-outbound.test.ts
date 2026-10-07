import { describe, expect, it } from 'vitest';
import { allocate, gs1CheckDigit, normaliseSscc, sscc, validSscc, type BinStockRow } from '../../src/modules/wms/outbound';

describe('SSCC', () => {
  it('computes the GS1 check digit', () => {
    // The GS1 General Specifications SSCC example: (00) 1 0614141 123456789 7.
    expect(gs1CheckDigit('10614141123456789')).toBe(7);
    expect(gs1CheckDigit('629104150021')).toBe(3); // GTIN-13 6291041500213
  });
  it('builds 18-digit SSCCs that validate', () => {
    const s = sscc(3, '8901234', 42);
    expect(s).toHaveLength(18);
    expect(s.startsWith('38901234')).toBe(true);
    expect(s.slice(8, 17)).toBe('000000042');
    expect(validSscc(s)).toBe(true);
    expect(validSscc(`${s.slice(0, 17)}${(Number(s[17]) + 1) % 10}`)).toBe(false);
    expect(normaliseSscc(`(00)${s}`)).toBe(s);
    expect(() => sscc(0, '89012', 1)).toThrow();
  });
});

const row = (code: string, p: Partial<BinStockRow> = {}): BinStockRow => ({ binId: code, code, batchId: null, expiryDate: null, qty: 10, pickSequence: 100, zoneKind: 'storage', blocked: false, held: false, ...p });

describe('pick allocation', () => {
  const today = '2026-10-07';
  it('takes the earliest expiry first, then the nearest bin', () => {
    const stock = [row('A', { batchId: 'late', expiryDate: '2027-06-01', pickSequence: 1 }), row('B', { batchId: 'early', expiryDate: '2026-12-01', pickSequence: 50 }), row('C', { batchId: 'early', expiryDate: '2026-12-01', pickSequence: 20, qty: 3 })];
    const r = allocate(15, stock, { today });
    expect(r.picks.map((p) => [p.code, p.qty])).toEqual([['C', 3], ['B', 10], ['A', 2]]);
    expect(r.short).toBe(0);
  });
  it('skips expired, held, blocked and short-dated stock, and says why it is short', () => {
    const stock = [
      row('X', { batchId: 'b1', expiryDate: '2026-10-01' }),
      row('Y', { batchId: 'b2', expiryDate: '2026-11-01' }),
      row('Z', { held: true }),
      row('W', { blocked: true }),
      row('R', { zoneKind: 'receiving' }),
      row('OK', { qty: 4 }),
    ];
    const r = allocate(10, stock, { today, minShelfLifeDays: 60 });
    expect(r.picks.map((p) => p.code)).toEqual(['OK']);
    expect(r.short).toBe(6);
    expect(r.why).toBe('not enough pickable stock (10 below the minimum shelf life, 10 expired, 10 on QC hold, 10 in blocked bins)');
  });
  it('respects quantities already reserved by other picks', () => {
    const reserved = new Map([['A|', 8]]);
    const r = allocate(5, [row('A', { pickSequence: 1 }), row('B', { pickSequence: 2 })], { today, reserved });
    expect(r.picks.map((p) => [p.code, p.qty])).toEqual([['A', 2], ['B', 3]]);
    expect(reserved.get('B|')).toBe(3);
  });
});
