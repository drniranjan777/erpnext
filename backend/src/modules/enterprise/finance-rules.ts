/**
 * Enterprise finance rules: loan schedules, deposit interest, facility use, cost allocation and
 * group consolidation. Money is rounded to paise.
 */

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
const monthsBetween = (a: string, b: string) => {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
};
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ---- loans --------------------------------------------------------------------------------------

export interface ScheduleRow {
  no: number;
  date: string;
  opening: number;
  interest: number;
  principal: number;
  payment: number;
  closing: number;
}

/** Equated monthly instalment: P·r·(1+r)^n / ((1+r)^n − 1), r the monthly rate. */
export function emi(principal: number, annualPct: number, months: number) {
  if (months <= 0) return principal;
  const r = annualPct / 1200;
  if (r === 0) return r2(principal / months);
  const f = (1 + r) ** months;
  return r2((principal * r * f) / (f - 1));
}

/**
 * Repayment schedule, first instalment a month after the start. EMI loans pay the same amount
 * each month (the last one absorbs rounding); bullet loans pay interest monthly and the principal at the end.
 */
export function loanSchedule(principal: number, annualPct: number, start: string, end: string, method: 'emi' | 'bullet'): ScheduleRow[] {
  const n = Math.max(1, monthsBetween(start, end));
  const r = annualPct / 1200;
  const pay = emi(principal, annualPct, n);
  const rows: ScheduleRow[] = [];
  let open = principal;
  for (let i = 1; i <= n; i++) {
    const interest = r2(open * r);
    let princ = method === 'emi' ? r2(pay - interest) : i === n ? open : 0;
    if (i === n) princ = r2(open);
    const closing = r2(open - princ);
    rows.push({ no: i, date: addMonths(start, i), opening: r2(open), interest, principal: princ, payment: r2(interest + princ), closing });
    open = closing;
  }
  return rows;
}

/** Interest of a loan for a month (YYYY-MM), from its schedule. */
export function loanInterestFor(rows: ScheduleRow[], period: string) {
  return r2(rows.filter((x) => x.date.startsWith(period)).reduce((a, x) => a + x.interest, 0));
}

/** Outstanding principal on a date. */
export function outstanding(rows: ScheduleRow[], principal: number, on: string) {
  const paid = rows.filter((x) => x.date <= on).reduce((a, x) => a + x.principal, 0);
  return r2(principal - paid);
}

// ---- deposits -----------------------------------------------------------------------------------

/** Value of a deposit on a date: compounded quarterly or monthly, or simple interest; capped at maturity. */
export function depositValue(principal: number, annualPct: number, start: string, end: string, method: string, on: string) {
  const at = on > end ? end : on < start ? start : on;
  const years = days(start, at) / 365;
  const r = annualPct / 100;
  if (method === 'simple') return r2(principal * (1 + r * years));
  const k = method === 'monthly' ? 12 : 4;
  return r2(principal * (1 + r / k) ** (k * years));
}

/** Interest earned by a deposit in a month (value at month end less value at the previous month end). */
export function depositInterestFor(principal: number, annualPct: number, start: string, end: string, method: string, period: string) {
  const [y, m] = period.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prevEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return r2(depositValue(principal, annualPct, start, end, method, monthEnd) - depositValue(principal, annualPct, start, end, method, prevEnd));
}

// ---- facilities ---------------------------------------------------------------------------------

/** Use of a bank facility by the active LCs and BGs under it, and those expiring soon. */
export function facilityUse(limit: number, instruments: { number: string; kind: string; principal: number; endDate: string; status: string; marginPct: number }[], today: string) {
  const active = instruments.filter((i) => i.status === 'active');
  const used = r2(active.reduce((a, i) => a + i.principal, 0));
  return {
    limit,
    used,
    available: r2(limit - used),
    pct: limit > 0 ? Math.round((used * 1000) / limit) / 10 : null,
    margin: r2(active.reduce((a, i) => a + (i.principal * i.marginPct) / 100, 0)),
    expiring: active.filter((i) => days(today, i.endDate) <= 30).map((i) => ({ number: i.number, kind: i.kind, endDate: i.endDate, overdue: i.endDate < today })),
  };
}

// ---- cost allocation ----------------------------------------------------------------------------

/** Split an amount by weights; the rounding difference goes to the largest remainders, so the parts add up exactly. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) return weights.map(() => 0);
  const paise = Math.round(amount * 100);
  const raw = weights.map((w) => (paise * w) / total);
  const base = raw.map((x) => Math.floor(x));
  let rest = paise - base.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    base[i]++;
    rest--;
  }
  return base.map((p) => p / 100);
}

// ---- consolidation ------------------------------------------------------------------------------

export type AccountBalance = {
  code: string;
  name: string;
  nature: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  reportLine: string | null;
  key: string | null;
  /** debit − credit */
  balance: number;
};

export interface MemberBooks {
  companyId: string;
  name: string;
  isParent: boolean;
  ownershipPct: number;
  investmentCost: number;
  /** Balance sheet balances on the reporting date, inter-company lines removed. */
  bs: AccountBalance[];
  /** Profit and loss for the period, inter-company lines removed. */
  pl: AccountBalance[];
  /** Net assets (assets − liabilities, all lines) on the reporting date and on acquisition. */
  netAssets: number;
  netAssetsAtAcquisition: number;
  /** The company's own profit for the period (all lines). */
  profit: number;
}

const sign = (n: AccountBalance['nature']) => (n === 'asset' || n === 'expense' ? 1 : -1);

/** Report lines of Schedule III Division II (Ind AS). */
export const LINE_LABELS: Record<string, string> = {
  'bs.equity': 'Other equity',
  'bs.equity.share_capital': 'Equity share capital',
  'bs.equity.reserves': 'Other equity',
  'bs.ncl': 'Non-current liabilities',
  'bs.ncl.borrowings': 'Borrowings (non-current)',
  'bs.cl': 'Current liabilities',
  'bs.cl.borrowings': 'Borrowings (current)',
  'bs.cl.trade_payables': 'Trade payables',
  'bs.cl.other': 'Other current liabilities',
  'bs.nca': 'Non-current assets',
  'bs.nca.ppe': 'Property, plant and equipment',
  'bs.nca.cwip': 'Capital work-in-progress',
  'bs.nca.investments': 'Investments',
  'bs.ca': 'Current assets',
  'bs.ca.inventories': 'Inventories',
  'bs.ca.trade_receivables': 'Trade receivables',
  'bs.ca.cash': 'Cash and cash equivalents',
  'bs.ca.loans_advances': 'Loans and advances',
  'bs.ca.other': 'Other current assets',
  'pl.revenue': 'Revenue from operations',
  'pl.other_income': 'Other income',
  'pl.materials': 'Cost of materials consumed',
  'pl.employee': 'Employee benefits expense',
  'pl.finance': 'Finance costs',
  'pl.depreciation': 'Depreciation and amortisation expense',
  'pl.other_expenses': 'Other expenses',
};

const byLine = (rows: AccountBalance[]) => {
  const m = new Map<string, { line: string; label: string; nature: string; amount: number }>();
  for (const r of rows) {
    const line = r.reportLine ?? `${r.nature}`;
    const e = m.get(line) ?? { line, label: LINE_LABELS[line] ?? line, nature: r.nature, amount: 0 };
    e.amount += r.balance * sign(r.nature);
    m.set(line, e);
  }
  return [...m.values()].map((e) => ({ ...e, amount: r2(e.amount) })).filter((e) => e.amount !== 0).sort((a, b) => a.line.localeCompare(b.line));
};

/**
 * Consolidates a group (Ind AS 110, full consolidation): adds the members' balances line by line
 * after inter-company balances and transactions are removed, replaces the parent's investment in
 * each subsidiary with goodwill (cost less the parent's share of net assets on acquisition; a
 * negative figure is a capital reserve), and shows the non-controlling interest in equity and in
 * profit. Subsidiaries' equity is not added: owners' equity is what remains.
 */
export function consolidate(members: MemberBooks[]) {
  const subs = members.filter((m) => !m.isParent);
  const assets = members.flatMap((m) => m.bs.filter((b) => b.nature === 'asset'));
  const liabilities = members.flatMap((m) => m.bs.filter((b) => b.nature === 'liability'));
  const parent = members.find((m) => m.isParent);
  const per = subs.map((s) => {
    const own = s.ownershipPct / 100;
    const goodwill = r2(s.investmentCost - own * s.netAssetsAtAcquisition);
    return {
      companyId: s.companyId,
      name: s.name,
      ownershipPct: s.ownershipPct,
      goodwill,
      nci: r2((1 - own) * s.netAssets),
      nciProfit: r2((1 - own) * s.profit),
      postAcquisitionShare: r2(own * (s.netAssets - s.netAssetsAtAcquisition)),
    };
  });
  const investments = r2(subs.reduce((a, s) => a + s.investmentCost, 0));
  const goodwill = r2(per.filter((p) => p.goodwill > 0).reduce((a, p) => a + p.goodwill, 0));
  const capitalReserve = r2(-per.filter((p) => p.goodwill < 0).reduce((a, p) => a + p.goodwill, 0));
  const assetLines = byLine(assets).map((l) => (l.line === 'bs.nca.investments' ? { ...l, amount: r2(l.amount - investments) } : l)).filter((l) => l.amount !== 0);
  if (goodwill) assetLines.push({ line: 'bs.nca.goodwill', label: 'Goodwill', nature: 'asset', amount: goodwill });
  const liabilityLines = byLine(liabilities);
  const totalAssets = r2(assetLines.reduce((a, l) => a + l.amount, 0));
  const totalLiabilities = r2(liabilityLines.reduce((a, l) => a + l.amount, 0));
  const nci = r2(per.reduce((a, p) => a + p.nci, 0));
  const ownersEquity = r2(totalAssets - totalLiabilities - nci);
  const shareCapital = r2((parent?.bs ?? []).filter((b) => b.key === 'share_capital' || b.reportLine === 'bs.equity.share_capital').reduce((a, b) => a - b.balance, 0));
  const pl = byLine(members.flatMap((m) => m.pl));
  const income = r2(pl.filter((l) => l.nature === 'income').reduce((a, l) => a + l.amount, 0));
  const expenses = r2(pl.filter((l) => l.nature === 'expense').reduce((a, l) => a + l.amount, 0));
  const profit = r2(income - expenses);
  const nciProfit = r2(per.reduce((a, p) => a + p.nciProfit, 0));
  return {
    balanceSheet: {
      assets: assetLines,
      liabilities: liabilityLines,
      equity: [
        { line: 'bs.equity.share_capital', label: 'Equity share capital', amount: shareCapital },
        { line: 'bs.equity.other', label: 'Other equity', amount: r2(ownersEquity - shareCapital) },
      ],
      capitalReserve,
      nonControllingInterest: nci,
      totalAssets,
      totalEquityAndLiabilities: r2(ownersEquity + nci + totalLiabilities),
    },
    profitAndLoss: { lines: pl, income, expenses, profit, attributableToOwners: r2(profit - nciProfit), attributableToNci: nciProfit },
    subsidiaries: per,
  };
}

/** Inter-company balances: what each company shows against the other should net to zero. */
export function reconcile(pairs: { a: string; b: string; aSaysB: number; bSaysA: number }[]) {
  return pairs.map((p) => ({ ...p, difference: r2(p.aSaysB + p.bSaysA), matched: Math.abs(p.aSaysB + p.bSaysA) < 0.005 }));
}
