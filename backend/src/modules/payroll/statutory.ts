/**
 * Indian payroll statutory rules as pure functions. Rates are those in force for FY 2025-26;
 * state PT and LWF tables cover the states listed and return zero elsewhere (verify against the
 * current state notification before relying on them).
 */

const r0 = (n: number) => Math.round(n);
const ceil = (n: number) => Math.ceil(n - 1e-9);

// ---- Provident fund (EPF & MP Act) -------------------------------------------------------------

export const PF_CEILING = 15_000;

export interface PfResult {
  /** Wages on which the employee's 12 % is paid. */
  epfWages: number;
  /** Wages for EPS and EDLI (always capped at the ceiling). */
  epsWages: number;
  employee: number;
  /** Employer's share split: 8.33 % to the pension scheme, the rest to the fund. */
  employerEps: number;
  employerEpf: number;
  edli: number;
}

/**
 * PF on the month's PF wages (basic + DA + retaining allowance, earned for the days paid).
 * `restrictToCeiling` caps the wages at ₹15,000, as most establishments do.
 */
export function providentFund(pfWages: number, opts: { restrictToCeiling: boolean; epsEligible: boolean }): PfResult {
  const epfWages = r0(opts.restrictToCeiling ? Math.min(pfWages, PF_CEILING) : pfWages);
  const epsWages = r0(Math.min(pfWages, PF_CEILING));
  const employee = r0(epfWages * 0.12);
  const employerTotal = r0(epfWages * 0.12);
  const employerEps = opts.epsEligible ? r0(epsWages * 0.0833) : 0;
  return { epfWages, epsWages: opts.epsEligible ? epsWages : 0, employee, employerEps, employerEpf: employerTotal - employerEps, edli: r0(epsWages * 0.005) };
}

// ---- ESI ----------------------------------------------------------------------------------------

export const ESI_CEILING = 21_000;

/**
 * ESI on the month's wages. Coverage is decided by the fixed monthly wages at the start of the
 * contribution period (April–September, October–March); once covered, contributions run to the
 * end of the period even if wages rise. Contributions are rounded up to the rupee.
 */
export function esi(wages: number, covered: boolean) {
  if (!covered || wages <= 0) return { employee: 0, employer: 0 };
  return { employee: ceil(wages * 0.0075), employer: ceil(wages * 0.0325) };
}

/** The contribution period a month falls in: "2026-04" for April–September, "2026-10" for October–March. */
export function esiPeriod(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m >= 4 && m <= 9) return `${y}-04`;
  return m >= 10 ? `${y}-10` : `${y - 1}-10`;
}

// ---- Professional tax ----------------------------------------------------------------------------

type Slab = [upTo: number, tax: number];
/** Monthly slabs on gross salary; the last slab's limit is Infinity. `feb` overrides the top slab in February. */
const PT: Record<string, { slabs: Slab[]; women?: Slab[]; feb?: number }> = {
  // Telangana
  '36': { slabs: [[15_000, 0], [20_000, 150], [Infinity, 200]] },
  // Andhra Pradesh
  '37': { slabs: [[15_000, 0], [20_000, 150], [Infinity, 200]] },
  // Maharashtra: ₹300 in February makes ₹2,500 a year.
  '27': { slabs: [[7_500, 0], [10_000, 175], [Infinity, 200]], women: [[25_000, 0], [Infinity, 200]], feb: 300 },
  // Karnataka
  '29': { slabs: [[24_999, 0], [Infinity, 200]], feb: 300 },
  // Gujarat
  '24': { slabs: [[11_999, 0], [Infinity, 200]] },
  // West Bengal
  '19': { slabs: [[10_000, 0], [15_000, 110], [25_000, 130], [40_000, 150], [Infinity, 200]] },
  // Madhya Pradesh
  '23': { slabs: [[18_750, 0], [25_000, 125], [33_333, 167], [Infinity, 208]], feb: 212 },
};

export function professionalTax(stateCode: string, gross: number, month: string, gender: string | null) {
  const t = PT[stateCode];
  if (!t || gross <= 0) return 0;
  const slabs = gender === 'female' && t.women ? t.women : t.slabs;
  const idx = slabs.findIndex(([upTo]) => gross <= upTo);
  const tax = slabs[idx][1];
  return tax && idx === slabs.length - 1 && t.feb && month.slice(5, 7) === '02' ? t.feb : tax;
}

// ---- Labour welfare fund ------------------------------------------------------------------------

/** Deduction months and the employee / employer amounts. */
const LWF: Record<string, { months: string[]; employee: number; employer: number }> = {
  '36': { months: ['12'], employee: 2, employer: 5 },
  '37': { months: ['12'], employee: 30, employer: 70 },
  '27': { months: ['06', '12'], employee: 25, employer: 75 },
  '29': { months: ['01'], employee: 50, employer: 100 },
  '24': { months: ['06', '12'], employee: 6, employer: 12 },
  '19': { months: ['06', '12'], employee: 3, employer: 15 },
  '33': { months: ['01'], employee: 20, employer: 40 },
};

export function labourWelfareFund(stateCode: string, month: string) {
  const t = LWF[stateCode];
  if (!t || !t.months.includes(month.slice(5, 7))) return { employee: 0, employer: 0 };
  return { employee: t.employee, employer: t.employer };
}

// ---- Income tax on salary (section 192) ----------------------------------------------------------

export type Regime = 'new' | 'old';
const NEW_SLABS: Slab[] = [[400_000, 0], [800_000, 0.05], [1_200_000, 0.1], [1_600_000, 0.15], [2_000_000, 0.2], [2_400_000, 0.25], [Infinity, 0.3]];
const OLD_SLABS: Slab[] = [[250_000, 0], [500_000, 0.05], [1_000_000, 0.2], [Infinity, 0.3]];
const STANDARD_DEDUCTION: Record<Regime, number> = { new: 75_000, old: 50_000 };

function slabTax(income: number, slabs: Slab[]) {
  let tax = 0;
  let lower = 0;
  for (const [upTo, rate] of slabs) {
    if (income <= lower) break;
    tax += (Math.min(income, upTo) - lower) * rate;
    lower = upTo;
  }
  return tax;
}

/**
 * Tax for the year on taxable salary income (after the standard deduction and, in the old
 * regime, chapter VI-A deductions): slab tax, the section 87A rebate with marginal relief in the
 * new regime, surcharge above ₹50 lakh (capped at 25 % in the new regime) and 4 % cess.
 */
export function incomeTax(taxable: number, regime: Regime) {
  const income = Math.max(0, Math.floor(taxable / 10) * 10);
  let tax = slabTax(income, regime === 'new' ? NEW_SLABS : OLD_SLABS);
  if (regime === 'new') {
    if (income <= 1_200_000) tax = 0;
    // Marginal relief: just above ₹12 lakh, tax cannot exceed the income above it.
    else tax = Math.min(tax, income - 1_200_000);
  } else if (income <= 500_000) tax = Math.max(0, tax - 12_500);
  let surcharge = 0;
  if (income > 50_000_000) surcharge = regime === 'new' ? 0.25 : 0.37;
  else if (income > 20_000_000) surcharge = 0.25;
  else if (income > 10_000_000) surcharge = 0.15;
  else if (income > 5_000_000) surcharge = 0.1;
  tax += tax * surcharge;
  return r0(tax * 1.04);
}

export interface Declaration {
  /** Section 80C (capped at ₹1.5 lakh), old regime only. */
  section80C?: number;
  /** Section 80D health insurance, old regime only. */
  section80D?: number;
  /** HRA exemption already worked out, old regime only. */
  hraExemption?: number;
  /** Other deductions (80CCD(1B), 24(b) interest...), old regime only. */
  otherDeductions?: number;
  /** Section 80CCD(2) employer NPS, both regimes. */
  employerNps?: number;
  /** Salary and TDS from a previous employer this year. */
  previousIncome?: number;
  previousTds?: number;
}

/**
 * This month's TDS: project the year's salary (paid so far + this month + the rest at this
 * month's rate), work out the year's tax and spread what is still due over the months left.
 */
export function monthlyTds(opts: { regime: Regime; paidSoFar: number; thisMonth: number; regularMonthly?: number; monthsAfter: number; ptForYear: number; tdsSoFar: number; declaration?: Declaration }) {
  const d = opts.declaration ?? {};
  // One-off pay this month (arrears, bonus) is not projected forward; the regular salary is.
  const gross = opts.paidSoFar + opts.thisMonth + (opts.regularMonthly ?? opts.thisMonth) * opts.monthsAfter + (d.previousIncome ?? 0);
  let deductions = STANDARD_DEDUCTION[opts.regime] + (d.employerNps ?? 0);
  if (opts.regime === 'old') deductions += opts.ptForYear + Math.min(d.section80C ?? 0, 150_000) + (d.section80D ?? 0) + (d.hraExemption ?? 0) + (d.otherDeductions ?? 0);
  const taxable = Math.max(0, gross - deductions);
  const annual = incomeTax(taxable, opts.regime);
  const due = Math.max(0, annual - opts.tdsSoFar - (d.previousTds ?? 0));
  return { taxable, annualTax: annual, tds: r0(due / (opts.monthsAfter + 1)) };
}

/** Fiscal year (April–March) of a month and how many months of it remain after this one. */
export function fiscalPosition(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const startYear = m >= 4 ? y : y - 1;
  const index = m >= 4 ? m - 4 : m + 8;
  return { fy: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`, fyStart: `${startYear}-04`, monthsAfter: 11 - index };
}

// ---- Gratuity (Payment of Gratuity Act) -----------------------------------------------------------

/**
 * 15 days' wages (basic + DA ÷ 26) per completed year, a part year over six months counting as a
 * year; capped at ₹20 lakh. Five years' service is needed, except on death or disablement.
 */
export function gratuity(monthlyWages: number, serviceDays: number, opts: { waiveMinimum?: boolean } = {}) {
  const years = Math.floor(serviceDays / 365.25);
  const rest = serviceDays - years * 365.25;
  const counted = years + (rest > 182 ? 1 : 0);
  if (!opts.waiveMinimum && years < 5 && counted < 5) return 0;
  return Math.min(2_000_000, r0((monthlyWages * 15 * counted) / 26));
}
