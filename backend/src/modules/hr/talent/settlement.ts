import { gratuity } from '../../payroll/statutory';

export type SeparationKind = 'resignation' | 'termination' | 'retirement' | 'death' | 'absconding';

export interface SettlementInput {
  kind: SeparationKind;
  /** Monthly basic + DA (the wage for gratuity and leave encashment). */
  basicDa: number;
  /** Monthly gross salary (for notice pay). */
  monthlyGross: number;
  dateOfJoining: string;
  lastWorkingDay: string;
  /** Earned leave left to encash, in days. */
  leaveDays: number;
  noticeShortfallDays: number;
  waiveShortfall: boolean;
  loanOutstanding: number;
  /** Amounts from the exit clearance (unreturned assets and the like). */
  recoveries: number;
}

export interface Line {
  code: string;
  name: string;
  amount: string;
  basis?: string;
}

const r0 = (n: number) => Math.round(n);

/**
 * Full and final settlement (the last month's salary is paid by that month's payroll run):
 * leave encashment at basic + DA ÷ 26 a day, gratuity, notice pay recovered on a short
 * resignation or paid in lieu on termination, and loans and clearance recoveries.
 */
export function fullAndFinal(i: SettlementInput) {
  const serviceDays = Math.round((Date.parse(`${i.lastWorkingDay}T00:00:00Z`) - Date.parse(`${i.dateOfJoining}T00:00:00Z`)) / 86_400_000) + 1;
  const earnings: Line[] = [];
  const deductions: Line[] = [];
  const daily = i.basicDa / 26;
  if (i.leaveDays > 0)
    earnings.push({
      code: 'LEAVE_ENC',
      name: 'Leave encashment',
      amount: r0(i.leaveDays * daily).toFixed(2),
      basis: `${i.leaveDays} days × ₹${daily.toFixed(2)}`,
    });
  const g = gratuity(i.basicDa, serviceDays, {
    waiveMinimum: i.kind === 'death',
  });
  if (g > 0)
    earnings.push({
      code: 'GRATUITY',
      name: 'Gratuity',
      amount: g.toFixed(2),
      basis: `${(serviceDays / 365.25).toFixed(1)} years of service`,
    });
  const noticePay = r0((i.noticeShortfallDays * i.monthlyGross) / 30);
  if (noticePay > 0) {
    if (i.kind === 'termination')
      earnings.push({
        code: 'NOTICE_PAY',
        name: 'Pay in lieu of notice',
        amount: noticePay.toFixed(2),
        basis: `${i.noticeShortfallDays} days`,
      });
    else if ((i.kind === 'resignation' || i.kind === 'absconding') && !i.waiveShortfall)
      deductions.push({
        code: 'NOTICE_REC',
        name: 'Notice period not served',
        amount: noticePay.toFixed(2),
        basis: `${i.noticeShortfallDays} days`,
      });
  }
  if (i.loanOutstanding > 0)
    deductions.push({
      code: 'LOAN',
      name: 'Loan and advance outstanding',
      amount: i.loanOutstanding.toFixed(2),
    });
  if (i.recoveries > 0)
    deductions.push({
      code: 'CLEARANCE',
      name: 'Clearance recoveries',
      amount: i.recoveries.toFixed(2),
    });
  const sum = (ls: Line[]) => ls.reduce((s, l) => s + Number(l.amount), 0);
  return {
    serviceDays,
    earnings,
    deductions,
    net: (sum(earnings) - sum(deductions)).toFixed(2),
  };
}
