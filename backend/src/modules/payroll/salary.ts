import { PF_CEILING } from './statutory';

export interface TemplateLine {
  code: string;
  calc: 'percent_ctc' | 'percent_basic' | 'fixed' | 'balance';
  value: number;
}

/**
 * Splits an annual CTC into monthly component amounts with a template: BASIC first, then the
 * other percentage and fixed lines, the employer's PF when it is part of the CTC, and whatever is
 * left goes to the balance line.
 */
export function applyTemplate(ctcAnnual: number, lines: TemplateLine[], opts: { pfWageCodes: Set<string>; employerPfInCtc: boolean; restrictToCeiling: boolean }) {
  const monthly = ctcAnnual / 12;
  const out = new Map<string, number>();
  const basicLine = lines.find((l) => l.code === 'BASIC');
  if (!basicLine || basicLine.calc === 'percent_basic' || basicLine.calc === 'balance') throw new Error('The template needs a BASIC line as a % of CTC or a fixed amount');
  const value = (l: TemplateLine) => (l.calc === 'percent_ctc' ? (monthly * l.value) / 100 : l.calc === 'fixed' ? l.value : l.calc === 'percent_basic' ? ((out.get('BASIC') ?? 0) * l.value) / 100 : 0);
  out.set('BASIC', Math.round(value(basicLine)));
  for (const l of lines) if (l.code !== 'BASIC' && l.calc !== 'balance') out.set(l.code, Math.round(value(l)));
  const pfWages = [...out].filter(([c]) => opts.pfWageCodes.has(c)).reduce((s, [, v]) => s + v, 0);
  const employerPf = opts.employerPfInCtc ? Math.round((opts.restrictToCeiling ? Math.min(pfWages, PF_CEILING) : pfWages) * 0.12) : 0;
  const balanceLine = lines.find((l) => l.calc === 'balance');
  const used = [...out.values()].reduce((s, v) => s + v, 0) + employerPf;
  const left = Math.round(monthly) - used;
  if (balanceLine) {
    if (left < 0) throw new Error(`The CTC is ₹${Math.round(-left)} a month short of the template's fixed parts`);
    out.set(balanceLine.code, left);
  }
  return { lines: [...out].map(([code, m]) => ({ code, monthly: m.toFixed(2) })), employerPf, monthlyCtc: Math.round(monthly) };
}
