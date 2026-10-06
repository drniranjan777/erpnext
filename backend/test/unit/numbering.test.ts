import { describe, expect, it } from 'vitest';
import { fiscalYearOf } from '../../src/common/fiscal-year';
import { gstNumberProblems, periodKey, renderPattern, validatePattern } from '../../src/modules/documents/numbering';

describe('fiscal year (India, April–March)', () => {
  it('rolls over on 1 April', () => {
    expect(fiscalYearOf('2027-03-31').label).toBe('26-27');
    expect(fiscalYearOf('2027-04-01').label).toBe('27-28');
    expect(fiscalYearOf('2026-10-05')).toMatchObject({ label: '26-27', label4: '2026-27', start: '2026-04-01', end: '2027-03-31' });
  });

  it('supports other start months', () => {
    expect(fiscalYearOf('2026-10-05', 1)).toMatchObject({ label: '26', start: '2026-01-01', end: '2026-12-31' });
    expect(fiscalYearOf('2026-06-30', 7).label).toBe('25-26');
    expect(fiscalYearOf('2028-02-15', 4).end).toBe('2028-03-31');
  });
});

describe('number patterns', () => {
  const ctx = { docDate: '2026-10-05', fyStartMonth: 4, branchCode: 'HYD', seq: 7, padding: 4 };

  it('renders all tokens', () => {
    expect(renderPattern('PR/{BRANCH}/{FY}/{SEQ}', ctx)).toBe('PR/HYD/26-27/0007');
    expect(renderPattern('INV-{FY4}-{MM}-{SEQ}', ctx)).toBe('INV-2026-27-10-0007');
    expect(renderPattern('{YYYY}{YY}{SEQ}', { ...ctx, padding: 2 })).toBe('20262607');
  });

  it('validates patterns', () => {
    expect(validatePattern('PR/{FY}/{SEQ}')).toEqual([]);
    expect(validatePattern('PR/{FY}')).toContain('Pattern must contain {SEQ}');
    expect(validatePattern('PR/{XYZ}/{SEQ}')).toContain('Unknown token {XYZ}');
  });

  it('keys counters by period', () => {
    expect(periodKey('yearly', '2027-03-31', 4)).toBe('2026-27');
    expect(periodKey('yearly', '2027-04-01', 4)).toBe('2027-28');
    expect(periodKey('monthly', '2026-10-05', 4)).toBe('2026-10');
    expect(periodKey('never', '2026-10-05', 4)).toBe('all');
  });

  it('enforces the GST invoice number rule (≤16 chars, letters/digits/-/)', () => {
    expect(gstNumberProblems('INV/HYD/26-27/01')).toEqual([]);
    expect(gstNumberProblems('INVOICE/HYD/26-27/0001')[0]).toMatch(/16 characters/);
    expect(gstNumberProblems('INV_001')[0]).toMatch(/only letters/);
  });
});
