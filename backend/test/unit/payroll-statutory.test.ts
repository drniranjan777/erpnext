import { describe, expect, it } from 'vitest';
import { esi, esiPeriod, fiscalPosition, gratuity, incomeTax, labourWelfareFund, monthlyTds, professionalTax, providentFund } from '../../src/modules/payroll/statutory';

describe('provident fund', () => {
  it('caps at the ceiling and splits the employer share', () => {
    const r = providentFund(25_000, { restrictToCeiling: true, epsEligible: true });
    expect(r).toEqual({ epfWages: 15_000, epsWages: 15_000, employee: 1800, employerEps: 1250, employerEpf: 550, edli: 75 });
    const full = providentFund(25_000, { restrictToCeiling: false, epsEligible: true });
    expect(full).toMatchObject({ epfWages: 25_000, employee: 3000, employerEps: 1250, employerEpf: 1750 });
    expect(providentFund(10_000, { restrictToCeiling: true, epsEligible: false })).toMatchObject({ employee: 1200, employerEps: 0, employerEpf: 1200, epsWages: 0 });
  });
});

describe('ESI', () => {
  it('rounds contributions up and follows the contribution period', () => {
    expect(esi(18_250, true)).toEqual({ employee: 137, employer: 594 });
    expect(esi(25_000, false)).toEqual({ employee: 0, employer: 0 });
    expect(esiPeriod('2026-04')).toBe('2026-04');
    expect(esiPeriod('2026-09')).toBe('2026-04');
    expect(esiPeriod('2026-12')).toBe('2026-10');
    expect(esiPeriod('2027-03')).toBe('2026-10');
  });
});

describe('professional tax and LWF', () => {
  it('uses state slabs, the Maharashtra rule for women and the February top-up', () => {
    expect(professionalTax('36', 15_000, '2026-10', 'male')).toBe(0);
    expect(professionalTax('36', 18_000, '2026-10', 'male')).toBe(150);
    expect(professionalTax('36', 45_000, '2026-10', 'male')).toBe(200);
    expect(professionalTax('27', 9_000, '2026-10', 'male')).toBe(175);
    expect(professionalTax('27', 20_000, '2026-10', 'female')).toBe(0);
    expect(professionalTax('27', 30_000, '2027-02', 'male')).toBe(300);
    expect(professionalTax('29', 30_000, '2027-02', null)).toBe(300);
    expect(professionalTax('07', 90_000, '2026-10', null)).toBe(0);
  });
  it('deducts LWF only in the state months', () => {
    expect(labourWelfareFund('27', '2026-06')).toEqual({ employee: 25, employer: 75 });
    expect(labourWelfareFund('27', '2026-07')).toEqual({ employee: 0, employer: 0 });
    expect(labourWelfareFund('36', '2026-12')).toEqual({ employee: 2, employer: 5 });
  });
});

describe('income tax', () => {
  it('applies the new regime rebate up to 12 lakh with marginal relief', () => {
    expect(incomeTax(1_200_000, 'new')).toBe(0);
    // ₹12.1 lakh: slab tax 61,500 is relieved to the 10,000 above 12 lakh, plus cess.
    expect(incomeTax(1_210_000, 'new')).toBe(10_400);
    // ₹16 lakh: 20k + 40k + 60k = 1.2 lakh, plus 4 % cess.
    expect(incomeTax(1_600_000, 'new')).toBe(124_800);
  });
  it('applies old regime slabs and the 5 lakh rebate', () => {
    expect(incomeTax(500_000, 'old')).toBe(0);
    // ₹10 lakh: 12,500 + 1,00,000 = 1,12,500 + cess.
    expect(incomeTax(1_000_000, 'old')).toBe(117_000);
  });
  it('spreads the tax still due over the months left', () => {
    // 1.5 lakh a month in the new regime from April: 18 lakh − 75,000 = 17.25 lakh taxable.
    const r = monthlyTds({ regime: 'new', paidSoFar: 0, thisMonth: 150_000, monthsAfter: 11, ptForYear: 2_500, tdsSoFar: 0 });
    expect(r.taxable).toBe(1_725_000);
    expect(r.annualTax).toBe(incomeTax(1_725_000, 'new'));
    expect(r.tds).toBe(Math.round(r.annualTax / 12));
    const later = monthlyTds({ regime: 'new', paidSoFar: 900_000, thisMonth: 150_000, monthsAfter: 5, ptForYear: 2_500, tdsSoFar: 6 * r.tds });
    expect(Math.abs(later.tds - r.tds)).toBeLessThanOrEqual(1);
    const old = monthlyTds({ regime: 'old', paidSoFar: 0, thisMonth: 50_000, monthsAfter: 11, ptForYear: 2_500, tdsSoFar: 0, declaration: { section80C: 200_000 } });
    expect(old.taxable).toBe(600_000 - 50_000 - 2_500 - 150_000);
  });
  it('places a month in the fiscal year', () => {
    expect(fiscalPosition('2026-04')).toEqual({ fy: '2026-27', fyStart: '2026-04', monthsAfter: 11 });
    expect(fiscalPosition('2027-03')).toEqual({ fy: '2026-27', fyStart: '2026-04', monthsAfter: 0 });
    expect(fiscalPosition('2026-10').monthsAfter).toBe(5);
  });
});

describe('gratuity', () => {
  it('needs five years and counts a part year over six months', () => {
    expect(gratuity(26_000, 4 * 365)).toBe(0);
    expect(gratuity(26_000, Math.round(5.6 * 365.25))).toBe(15_000 * 6);
    expect(gratuity(26_000, Math.round(7.2 * 365.25))).toBe(15_000 * 7);
    expect(gratuity(2_000_000, 30 * 365.25)).toBe(2_000_000);
  });
});
