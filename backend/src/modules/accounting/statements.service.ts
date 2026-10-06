import { Injectable } from '@nestjs/common';
import { accounts, documents, glEntries, journals, type Transaction } from '@nextgen/database';
import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { fiscalYearOf, todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import { AccountsService } from './accounts.service';

const D = Decimal.from;
const ZERO = D('0');

export const statementQuerySchema = z.object({
  companyId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** previous_year (same period a year earlier) | none */
  compare: z.enum(['previous_year', 'none']).default('previous_year'),
});

const shiftYear = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

interface Acc {
  id: string;
  code: string;
  name: string;
  nature: string;
  reportLine: string | null;
  systemKey: string | null;
  accountType: string | null;
}

export interface Line {
  key: string;
  label: string;
  amount: string;
  previous: string | null;
  accounts: { id: string; code: string; name: string; amount: string }[];
}

/** Schedule III layout: line key → label and how accounts are picked. */
const BS_LAYOUT = {
  share_capital: 'Share capital',
  reserves: 'Reserves and surplus',
  lt_borrowings: 'Long-term borrowings',
  st_borrowings: 'Short-term borrowings',
  trade_payables: 'Trade payables',
  other_cl: 'Other current liabilities',
  provisions: 'Short-term provisions',
  ppe: 'Property, plant and equipment',
  cwip: 'Capital work in progress',
  other_nca: 'Other non-current assets',
  inventories: 'Inventories',
  trade_receivables: 'Trade receivables',
  cash: 'Cash and cash equivalents',
  loans_advances: 'Short-term loans and advances',
  other_ca: 'Other current assets',
} as const;
type BsKey = keyof typeof BS_LAYOUT;

const PL_LAYOUT = {
  revenue: 'Revenue from operations',
  other_income: 'Other income',
  materials: 'Cost of materials consumed and goods sold',
  employee: 'Employee benefits expense',
  finance: 'Finance costs',
  depreciation: 'Depreciation and amortisation expense',
  other_expenses: 'Other expenses',
} as const;
type PlKey = keyof typeof PL_LAYOUT;

function bsLine(a: Acc): BsKey | null {
  const r = a.reportLine ?? '';
  if (a.nature === 'income' || a.nature === 'expense') return null;
  if (r.startsWith('bs.equity.share_capital')) return 'share_capital';
  if (r.startsWith('bs.equity')) return 'reserves';
  if (r.startsWith('bs.ncl')) return 'lt_borrowings';
  if (r.startsWith('bs.cl.borrowings')) return 'st_borrowings';
  if (r.startsWith('bs.cl.trade_payables')) return 'trade_payables';
  if (r.startsWith('bs.cl.provisions')) return 'provisions';
  if (r.startsWith('bs.cl')) return 'other_cl';
  if (r.startsWith('bs.nca.ppe')) return 'ppe';
  if (r.startsWith('bs.nca.cwip')) return 'cwip';
  if (r.startsWith('bs.nca')) return 'other_nca';
  if (r.startsWith('bs.ca.inventories')) return 'inventories';
  if (r.startsWith('bs.ca.trade_receivables')) return 'trade_receivables';
  if (r.startsWith('bs.ca.cash')) return 'cash';
  if (r.startsWith('bs.ca.loans_advances')) return 'loans_advances';
  if (r.startsWith('bs.ca')) return 'other_ca';
  return a.nature === 'asset' ? 'other_ca' : a.nature === 'equity' ? 'reserves' : 'other_cl';
}

function plLine(a: Acc): PlKey | null {
  const r = a.reportLine ?? '';
  if (a.nature !== 'income' && a.nature !== 'expense') return null;
  if (r.startsWith('pl.revenue')) return 'revenue';
  if (r.startsWith('pl.other_income')) return 'other_income';
  if (r.startsWith('pl.materials')) return 'materials';
  if (r.startsWith('pl.employee')) return 'employee';
  if (r.startsWith('pl.finance')) return 'finance';
  if (r.startsWith('pl.depreciation')) return 'depreciation';
  return a.nature === 'income' ? 'other_income' : 'other_expenses';
}

/**
 * Financial statements on Schedule III: Statement of Profit and Loss, Balance Sheet (with
 * customer / vendor balances on the wrong side and overdrawn banks reclassified), Cash Flow
 * (indirect method) and key ratios, each with the previous year for comparison.
 */
@Injectable()
export class StatementsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accountsSvc: AccountsService,
  ) {}

  private async period(tx: Transaction, q: z.infer<typeof statementQuerySchema>) {
    const companyId = await this.accountsSvc.company(tx, q.companyId);
    const to = q.to ?? todayIST();
    const from = q.from ?? fiscalYearOf(to).start;
    return { companyId, from, to };
  }

  private async accs(tx: Transaction, companyId: string): Promise<Acc[]> {
    return tx.select({ id: accounts.id, code: accounts.code, name: accounts.name, nature: accounts.nature, reportLine: accounts.reportLine, systemKey: accounts.systemKey, accountType: accounts.accountType }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.isGroup, false)));
  }

  /** Debit-positive balance per account up to a date (inclusive), optionally from a date. */
  private async balances(tx: Transaction, companyId: string, to: string, from?: string) {
    const rows = await tx
      .select({ accountId: glEntries.accountId, v: sql<string>`sum(${glEntries.debit} - ${glEntries.credit})::text` })
      .from(glEntries)
      .where(and(eq(glEntries.companyId, companyId), lte(glEntries.postingDate, to), from ? gte(glEntries.postingDate, from) : undefined))
      .groupBy(glEntries.accountId);
    return new Map(rows.map((r) => [r.accountId, D(r.v)]));
  }

  /** Party balances of a control account up to a date (for reclassifying advances). */
  private async partySides(tx: Transaction, companyId: string, key: 'receivable' | 'payable', to: string) {
    const rows = await tx
      .select({ v: sql<string>`sum(${glEntries.debit} - ${glEntries.credit})::text` })
      .from(glEntries)
      .innerJoin(accounts, eq(accounts.id, glEntries.accountId))
      .where(and(eq(glEntries.companyId, companyId), eq(accounts.systemKey, key), lte(glEntries.postingDate, to), isNotNull(glEntries.partyId)))
      .groupBy(glEntries.partyId);
    let debit = ZERO;
    let credit = ZERO;
    for (const r of rows) {
      const v = D(r.v);
      if (v.isNegative()) credit = credit.add(ZERO.sub(v));
      else debit = debit.add(v);
    }
    return { debit, credit };
  }

  private async bsAt(tx: Transaction, companyId: string, list: Acc[], at: string) {
    const bal = await this.balances(tx, companyId, at);
    const lines = new Map<BsKey, { amount: Decimal; accounts: Line['accounts'] }>();
    const add = (k: BsKey, amount: Decimal, a?: Acc) => {
      const e = lines.get(k) ?? { amount: ZERO, accounts: [] };
      e.amount = e.amount.add(amount);
      if (a && !amount.isZero()) e.accounts.push({ id: a.id, code: a.code, name: a.name, amount: amount.toFixed(2) });
      lines.set(k, e);
    };
    let profit = ZERO;
    for (const a of list) {
      const v = bal.get(a.id) ?? ZERO;
      if (v.isZero()) continue;
      if (a.nature === 'income' || a.nature === 'expense') {
        profit = profit.sub(v);
        continue;
      }
      const k = bsLine(a)!;
      const liabSide = a.nature !== 'asset';
      if (a.systemKey === 'receivable' || a.systemKey === 'payable') continue; // split by party below
      // An overdrawn bank is a short-term borrowing.
      if (a.accountType === 'bank' && v.isNegative()) {
        add('st_borrowings', ZERO.sub(v), a);
        continue;
      }
      add(k, liabSide ? ZERO.sub(v) : v, a);
    }
    const rec = await this.partySides(tx, companyId, 'receivable', at);
    const pay = await this.partySides(tx, companyId, 'payable', at);
    const recAcc = list.find((a) => a.systemKey === 'receivable');
    const payAcc = list.find((a) => a.systemKey === 'payable');
    if (recAcc) {
      add('trade_receivables', rec.debit, recAcc);
      add('other_cl', rec.credit, { ...recAcc, name: 'Advances from customers' });
    }
    if (payAcc) {
      add('trade_payables', pay.credit, payAcc);
      add('loans_advances', pay.debit, { ...payAcc, name: 'Advances to suppliers' });
    }
    add('reserves', profit, { id: 'profit', code: '', name: 'Surplus in profit and loss (not yet closed)', nature: 'equity', reportLine: null, systemKey: null, accountType: null });
    return lines;
  }

  balanceSheet(auth: AuthContext, q: z.infer<typeof statementQuerySchema>) {
    return this.database.run(auth, async (tx) => {
      const { companyId, to } = await this.period(tx, q);
      const list = await this.accs(tx, companyId);
      const cur = await this.bsAt(tx, companyId, list, to);
      const prevAt = q.compare === 'previous_year' ? shiftYear(to, -1) : null;
      const prev = prevAt ? await this.bsAt(tx, companyId, list, prevAt) : null;
      const line = (k: BsKey): Line => ({ key: k, label: BS_LAYOUT[k], amount: (cur.get(k)?.amount ?? ZERO).toFixed(2), previous: prev ? (prev.get(k)?.amount ?? ZERO).toFixed(2) : null, accounts: cur.get(k)?.accounts ?? [] });
      const group = (label: string, keys: BsKey[]) => {
        const ls = keys.map(line);
        return { label, lines: ls, total: ls.reduce((s, l) => s.add(D(l.amount)), ZERO).toFixed(2), previous: prev ? ls.reduce((s, l) => s.add(D(l.previous!)), ZERO).toFixed(2) : null };
      };
      const equity = group("Shareholders' funds", ['share_capital', 'reserves']);
      const ncl = group('Non-current liabilities', ['lt_borrowings']);
      const cl = group('Current liabilities', ['st_borrowings', 'trade_payables', 'other_cl', 'provisions']);
      const nca = group('Non-current assets', ['ppe', 'cwip', 'other_nca']);
      const ca = group('Current assets', ['inventories', 'trade_receivables', 'cash', 'loans_advances', 'other_ca']);
      const sum = (gs: { total: string; previous: string | null }[], k: 'total' | 'previous') => gs.reduce((s, g) => s.add(D(g[k] ?? '0')), ZERO).toFixed(2);
      const liabilities = { groups: [equity, ncl, cl], total: sum([equity, ncl, cl], 'total'), previous: prev ? sum([equity, ncl, cl], 'previous') : null };
      const assets = { groups: [nca, ca], total: sum([nca, ca], 'total'), previous: prev ? sum([nca, ca], 'previous') : null };
      return { companyId, asOf: to, previousAsOf: prevAt, equityAndLiabilities: liabilities, assets, balanced: liabilities.total === assets.total };
    });
  }

  private async plFor(tx: Transaction, companyId: string, list: Acc[], from: string, to: string) {
    const bal = await this.balances(tx, companyId, to, from);
    // Year-end closing journals in the period would zero the accounts; leave them out of the P&L.
    const closing = await tx
      .select({ accountId: glEntries.accountId, v: sql<string>`sum(${glEntries.debit} - ${glEntries.credit})::text` })
      .from(glEntries)
      .innerJoin(journals, eq(journals.id, glEntries.voucherId))
      .where(and(eq(glEntries.companyId, companyId), eq(journals.kind, 'closing'), gte(glEntries.postingDate, from), lte(glEntries.postingDate, to)))
      .groupBy(glEntries.accountId);
    for (const c of closing) bal.set(c.accountId, (bal.get(c.accountId) ?? ZERO).sub(D(c.v)));
    const lines = new Map<PlKey, { amount: Decimal; accounts: Line['accounts'] }>();
    for (const a of list) {
      const k = plLine(a);
      if (!k) continue;
      const v = bal.get(a.id) ?? ZERO;
      if (v.isZero()) continue;
      // Income shown as positive credit; expenses as positive debit.
      const amt = a.nature === 'income' ? ZERO.sub(v) : v;
      const e = lines.get(k) ?? { amount: ZERO, accounts: [] };
      e.amount = e.amount.add(amt);
      e.accounts.push({ id: a.id, code: a.code, name: a.name, amount: amt.toFixed(2) });
      lines.set(k, e);
    }
    const get = (k: PlKey) => lines.get(k)?.amount ?? ZERO;
    const income = get('revenue').add(get('other_income'));
    const expenses = (['materials', 'employee', 'finance', 'depreciation', 'other_expenses'] as const).reduce((s, k) => s.add(get(k)), ZERO);
    return { lines, income, expenses, profit: income.sub(expenses) };
  }

  profitAndLoss(auth: AuthContext, q: z.infer<typeof statementQuerySchema>) {
    return this.database.run(auth, async (tx) => {
      const { companyId, from, to } = await this.period(tx, q);
      const list = await this.accs(tx, companyId);
      const cur = await this.plFor(tx, companyId, list, from, to);
      const prev = q.compare === 'previous_year' ? await this.plFor(tx, companyId, list, shiftYear(from, -1), shiftYear(to, -1)) : null;
      const line = (k: PlKey): Line => ({ key: k, label: PL_LAYOUT[k], amount: (cur.lines.get(k)?.amount ?? ZERO).toFixed(2), previous: prev ? (prev.lines.get(k)?.amount ?? ZERO).toFixed(2) : null, accounts: cur.lines.get(k)?.accounts ?? [] });
      return {
        companyId,
        from,
        to,
        income: [line('revenue'), line('other_income')],
        totalIncome: { amount: cur.income.toFixed(2), previous: prev?.income.toFixed(2) ?? null },
        expenses: [line('materials'), line('employee'), line('finance'), line('depreciation'), line('other_expenses')],
        totalExpenses: { amount: cur.expenses.toFixed(2), previous: prev?.expenses.toFixed(2) ?? null },
        profitBeforeTax: { amount: cur.profit.toFixed(2), previous: prev?.profit.toFixed(2) ?? null },
      };
    });
  }

  /** Cash flow statement, indirect method (AS 3 / Ind AS 7), reconciled to the change in cash. */
  cashFlow(auth: AuthContext, q: z.infer<typeof statementQuerySchema>) {
    return this.database.run(auth, async (tx) => {
      const { companyId, from, to } = await this.period(tx, q);
      const list = await this.accs(tx, companyId);
      const open = await this.bsAt(tx, companyId, list, dayBefore(from));
      const close = await this.bsAt(tx, companyId, list, to);
      const pl = await this.plFor(tx, companyId, list, from, to);
      const v = (m: typeof open, k: BsKey) => m.get(k)?.amount ?? ZERO;
      const delta = (k: BsKey) => v(close, k).sub(v(open, k));
      const dep = pl.lines.get('depreciation')?.amount ?? ZERO;
      const disposalAcc = list.find((a) => a.systemKey === 'asset_disposal');
      const gain = disposalAcc ? ZERO.sub((await this.balances(tx, companyId, to, from)).get(disposalAcc.id) ?? ZERO) : ZERO;
      // A year-end closing only moves profit within reserves; the period's profit is already in operating.
      const profitIntoReserves = pl.profit;
      const wc: [string, Decimal][] = [
        ['(Increase) / decrease in inventories', ZERO.sub(delta('inventories'))],
        ['(Increase) / decrease in trade receivables', ZERO.sub(delta('trade_receivables'))],
        ['(Increase) / decrease in loans and advances', ZERO.sub(delta('loans_advances'))],
        ['(Increase) / decrease in other current assets', ZERO.sub(delta('other_ca'))],
        ['Increase / (decrease) in trade payables', delta('trade_payables')],
        ['Increase / (decrease) in other current liabilities', delta('other_cl')],
        ['Increase / (decrease) in provisions', delta('provisions')],
      ];
      const operating = pl.profit.add(dep).sub(gain).add(wc.reduce((s, [, x]) => s.add(x), ZERO));
      const ppeNetDelta = delta('ppe');
      const investing = ZERO.sub(ppeNetDelta.add(dep)).add(gain).sub(delta('cwip')).sub(delta('other_nca'));
      const reservesDelta = delta('reserves').sub(profitIntoReserves);
      const financing = delta('share_capital').add(reservesDelta).add(delta('lt_borrowings')).add(delta('st_borrowings'));
      const net = operating.add(investing).add(financing);
      const cashChange = delta('cash');
      const f = (d: Decimal) => d.toFixed(2);
      return {
        companyId,
        from,
        to,
        operating: {
          lines: [['Profit before tax', pl.profit], ['Add: depreciation', dep], ['Less: profit on sale of assets', ZERO.sub(gain)], ...wc].map(([label, x]) => ({ label, amount: f(x as Decimal) })),
          total: f(operating),
        },
        investing: { lines: [{ label: 'Purchase of property, plant and equipment (net of sales)', amount: f(ZERO.sub(ppeNetDelta.add(dep)).add(gain)) }, { label: 'Capital work in progress', amount: f(ZERO.sub(delta('cwip'))) }, { label: 'Other non-current assets', amount: f(ZERO.sub(delta('other_nca'))) }], total: f(investing) },
        financing: { lines: [{ label: 'Share capital', amount: f(delta('share_capital')) }, { label: 'Other changes in reserves', amount: f(reservesDelta) }, { label: 'Borrowings', amount: f(delta('lt_borrowings').add(delta('st_borrowings'))) }], total: f(financing) },
        netChange: f(net),
        openingCash: f(v(open, 'cash')),
        closingCash: f(v(close, 'cash')),
        difference: f(cashChange.sub(net)),
      };
    });
  }

  /** Liquidity, leverage, margins and working-capital days for the period. */
  async ratios(auth: AuthContext, q: z.infer<typeof statementQuerySchema>) {
    const bs = await this.balanceSheet(auth, { ...q, compare: 'none' });
    const pl = await this.profitAndLoss(auth, { ...q, compare: 'none' });
    const line = (k: string) => D(bs.equityAndLiabilities.groups.concat(bs.assets.groups).flatMap((g) => g.lines).find((l) => l.key === k)?.amount ?? '0');
    const g = (label: string) => D([...bs.equityAndLiabilities.groups, ...bs.assets.groups].find((x) => x.label === label)?.total ?? '0');
    const revenue = D(pl.income[0].amount);
    const materials = D(pl.expenses[0].amount);
    const profit = D(pl.profitBeforeTax.amount);
    const n = days(pl.from, pl.to);
    const ratio = (a: Decimal, b: Decimal, dp = 2) => (b.isZero() ? null : Number(a.div(b).toFixed(dp)));
    const pct = (a: Decimal, b: Decimal) => (b.isZero() ? null : Number(a.mul(D('100')).div(b).toFixed(1)));
    const equity = g("Shareholders' funds");
    return {
      from: pl.from,
      to: pl.to,
      currentRatio: ratio(g('Current assets'), g('Current liabilities')),
      quickRatio: ratio(g('Current assets').sub(line('inventories')), g('Current liabilities')),
      debtEquity: ratio(line('lt_borrowings').add(line('st_borrowings')), equity),
      grossMarginPct: pct(revenue.sub(materials), revenue),
      netMarginPct: pct(profit, revenue),
      returnOnEquityPct: pct(profit, equity),
      debtorDays: revenue.isZero() ? null : Math.round(Number(line('trade_receivables').mul(D(String(n))).div(revenue).toFixed(0))),
      creditorDays: materials.isZero() ? null : Math.round(Number(line('trade_payables').mul(D(String(n))).div(materials).toFixed(0))),
      inventoryDays: materials.isZero() ? null : Math.round(Number(line('inventories').mul(D(String(n))).div(materials).toFixed(0))),
    };
  }

  /** Closing journal of a financial year, if posted. */
  async closingJournal(tx: Transaction, companyId: string, fyEnd: string) {
    const [j] = await tx
      .select({ id: documents.id, number: documents.number })
      .from(journals)
      .innerJoin(documents, eq(documents.id, journals.id))
      .where(and(eq(documents.companyId, companyId), eq(journals.kind, 'closing'), eq(documents.docDate, fyEnd), sql`${documents.status} in ('approved', 'pending_approval')`));
    return j ?? null;
  }
}
