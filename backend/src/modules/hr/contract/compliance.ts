/**
 * Principal-employer checks on a contractor's wage payment (CLRA Act s.21: the principal employer
 * pays if the contractor does not): days paid against days attended, wages against the agreed and
 * the notified minimum rate, overtime at twice the rate, and PF / ESI deductions.
 */
export interface WageCheckInput {
  daysPresent: number;
  otHours: number;
  agreedDaily: number;
  /** Notified minimum daily wage for the state and skill, if known. */
  minDaily: number | null;
  declared: { daysPaid: number; grossPaid: number; pfDeducted: number; esiDeducted: number } | null;
  hasUan: boolean;
}

export interface WageCheck {
  rate: number;
  dueGross: number;
  shortfall: number;
  expectedPf: number;
  expectedEsi: number;
  issues: string[];
}

const r0 = (n: number) => Math.round(n);

export function wageCheck(i: WageCheckInput): WageCheck {
  const rate = Math.max(i.agreedDaily, i.minDaily ?? 0);
  const dueGross = r0(rate * i.daysPresent + i.otHours * 2 * (rate / 8));
  const issues: string[] = [];
  if (i.agreedDaily < (i.minDaily ?? 0)) issues.push(`Agreed rate ₹${i.agreedDaily} is below the minimum wage ₹${i.minDaily}`);
  if (!i.declared) {
    if (i.daysPresent > 0) issues.push('No wage payment recorded');
    return { rate, dueGross, shortfall: dueGross, expectedPf: 0, expectedEsi: 0, issues };
  }
  const d = i.declared;
  const expectedPf = i.hasUan || d.grossPaid > 0 ? r0(Math.min(d.grossPaid, 15_000) * 0.12) : 0;
  const expectedEsi = d.grossPaid > 0 && d.grossPaid <= 21_000 ? Math.ceil(d.grossPaid * 0.0075 - 1e-9) : 0;
  if (d.daysPaid + 1e-9 < i.daysPresent) issues.push(`Paid for ${d.daysPaid} days but attended ${i.daysPresent}`);
  if (i.minDaily && d.daysPaid > 0 && d.grossPaid / d.daysPaid + 1e-6 < i.minDaily) issues.push(`Paid ₹${(d.grossPaid / d.daysPaid).toFixed(2)} a day, below the minimum ₹${i.minDaily}`);
  const shortfall = Math.max(0, dueGross - r0(d.grossPaid));
  if (shortfall > 1) issues.push(`₹${shortfall} short of the wages due`);
  if (d.pfDeducted + 1 < expectedPf) issues.push(`PF ₹${d.pfDeducted} deducted; ₹${expectedPf} due`);
  if (d.esiDeducted + 1 < expectedEsi) issues.push(`ESI ₹${d.esiDeducted} deducted; ₹${expectedEsi} due`);
  return { rate, dueGross, shortfall: shortfall > 1 ? shortfall : 0, expectedPf, expectedEsi, issues };
}
