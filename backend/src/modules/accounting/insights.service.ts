import { Injectable } from '@nestjs/common';
import { accounts, documents, glEntries, journals, moneyAllocations, moneyVouchers, parties, purchaseInvoices, salesInvoices, users } from '@nextgen/database';
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import { AccountsService } from './accounts.service';

const D = Decimal.from;
const ZERO = D('0');

export const anomalySchema = z.object({ companyId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() });
export const forecastSchema = z.object({ companyId: z.uuid().optional(), weeks: z.coerce.number().int().min(4).max(26).default(13) });

export interface AnomalyLine {
  voucherId: string;
  number: string | null;
  postingDate: string;
  createdAt: Date;
  createdBy: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
}

const IST = 5.5 * 3600_000;

/**
 * Rules that make a manual journal line worth a second look: amount far outside the account's
 * history, large round amounts, entries made at odd hours or weekends, heavy back-dating, a user
 * posting to an account they never used. Cash payments above ₹10,000 (s.40A(3)) too.
 */
export function flagLines(lines: AnomalyLine[], history: Map<string, number[]>, firstUse: Set<string>) {
  const out: { line: AnomalyLine; reasons: string[]; score: number }[] = [];
  for (const l of lines) {
    const reasons: string[] = [];
    let score = 0;
    const h = history.get(l.accountId) ?? [];
    if (h.length >= 5) {
      const mean = h.reduce((s, v) => s + v, 0) / h.length;
      const sd = Math.sqrt(h.reduce((s, v) => s + (v - mean) ** 2, 0) / h.length);
      if (sd > 0 && (l.amount - mean) / sd > 3) {
        reasons.push(`Unusually large for ${l.accountCode} (typical ₹${Math.round(mean).toLocaleString('en-IN')})`);
        score += 3;
      }
    }
    if (l.amount >= 100000 && l.amount % 10000 === 0) {
      reasons.push('Large round amount');
      score += 1;
    }
    const ist = new Date(l.createdAt.getTime() + IST);
    const hour = ist.getUTCHours();
    const dow = ist.getUTCDay();
    if (dow === 0 || hour < 7 || hour >= 21) {
      reasons.push(dow === 0 ? 'Entered on a Sunday' : `Entered at ${String(hour).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`);
      score += 1;
    }
    const entered = ist.toISOString().slice(0, 10);
    const lag = (Date.parse(entered) - Date.parse(l.postingDate)) / 86_400_000;
    if (lag > 30) {
      reasons.push(`Back-dated by ${Math.round(lag)} days`);
      score += 2;
    }
    if (l.createdBy && firstUse.has(`${l.createdBy}|${l.accountId}|${l.voucherId}`) && l.amount >= 50000) {
      reasons.push('First time this user posted to this account');
      score += 1;
    }
    if (reasons.length) out.push({ line: l, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score || b.line.amount - a.line.amount);
}

/** Journal anomalies and a basic cash-flow forecast. */
@Injectable()
export class InsightsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accountsSvc: AccountsService,
  ) {}

  anomalies(auth: AuthContext, q: z.infer<typeof anomalySchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, q.companyId);
      const to = q.to ?? todayIST();
      const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
      // Manual journals only: not reversals, repeats or journals made by the system (closing, set-off…).
      const manual = and(eq(glEntries.companyId, companyId), eq(glEntries.voucherType, 'journal_entry'), eq(glEntries.isReversal, false), isNull(journals.reversalOfId), isNull(journals.recurredFromId), sql`${journals.kind} <> 'closing'`);
      const rows = await tx
        .select({ voucherId: glEntries.voucherId, number: glEntries.voucherNumber, postingDate: glEntries.postingDate, createdAt: documents.createdAt, createdBy: documents.createdBy, accountId: glEntries.accountId, accountCode: accounts.code, accountName: accounts.name, amount: sql<string>`(${glEntries.debit} + ${glEntries.credit})::text` })
        .from(glEntries)
        .innerJoin(journals, eq(journals.id, glEntries.voucherId))
        .innerJoin(documents, eq(documents.id, glEntries.voucherId))
        .innerJoin(accounts, eq(accounts.id, glEntries.accountId))
        .where(and(manual, gte(glEntries.postingDate, from), lte(glEntries.postingDate, to)));
      const lines: AnomalyLine[] = rows.map((r) => ({ ...r, amount: Number(r.amount) }));
      const accountIds = [...new Set(lines.map((l) => l.accountId))];
      const hist = accountIds.length
        ? await tx
            .select({ accountId: glEntries.accountId, amount: sql<string>`(${glEntries.debit} + ${glEntries.credit})::text` })
            .from(glEntries)
            .innerJoin(journals, eq(journals.id, glEntries.voucherId))
            .where(and(manual, inArray(glEntries.accountId, accountIds), sql`${glEntries.postingDate} < ${from}`))
        : [];
      const history = new Map<string, number[]>();
      for (const h of hist) history.set(h.accountId, [...(history.get(h.accountId) ?? []), Number(h.amount)]);
      // Earliest manual journal per user and account: the line is a "first use" if it is that journal.
      const first = accountIds.length
        ? await tx
            .select({ userId: documents.createdBy, accountId: glEntries.accountId, voucherId: sql<string>`(array_agg(${glEntries.voucherId} order by ${glEntries.id}))[1]` })
            .from(glEntries)
            .innerJoin(journals, eq(journals.id, glEntries.voucherId))
            .innerJoin(documents, eq(documents.id, glEntries.voucherId))
            .where(and(manual, inArray(glEntries.accountId, accountIds)))
            .groupBy(documents.createdBy, glEntries.accountId)
        : [];
      const firstUse = new Set(first.map((f) => `${f.userId}|${f.accountId}|${f.voucherId}`));
      const flagged = flagLines(lines, history, firstUse);
      // Cash expenses above ₹10,000 in a day to one payee (s.40A(3)).
      const cash = await tx
        .select({ voucherId: documents.id, number: documents.number, date: documents.docDate, party: parties.name, amount: moneyVouchers.amount })
        .from(moneyVouchers)
        .innerJoin(documents, eq(documents.id, moneyVouchers.id))
        .leftJoin(parties, eq(parties.id, moneyVouchers.partyId))
        .where(and(eq(documents.companyId, companyId), eq(moneyVouchers.kind, 'payment'), eq(moneyVouchers.mode, 'cash'), eq(documents.status, 'approved'), sql`${moneyVouchers.amount} > 10000`, gte(documents.docDate, from), lte(documents.docDate, to)));
      const names = new Map((flagged.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, [...new Set(flagged.map((f) => f.line.createdBy).filter((v): v is string => !!v))])) : []).map((u) => [u.id, u.name]));
      return {
        from,
        to,
        reviewed: lines.length,
        journals: flagged.map((f) => ({ ...f.line, createdBy: f.line.createdBy ? (names.get(f.line.createdBy) ?? null) : null, reasons: f.reasons, score: f.score })),
        cashPayments: cash.map((c) => ({ ...c, reason: 'Cash payment above ₹10,000: not deductible under s.40A(3) unless an exception applies' })),
      };
    });
  }

  /**
   * Weekly cash forecast: bank and cash today, plus customer receipts expected by due date
   * (shifted by each customer's usual delay), less vendor bills by due date.
   */
  forecast(auth: AuthContext, q: z.infer<typeof forecastSchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, q.companyId);
      const today = todayIST();
      const [cash] = await tx
        .select({ v: sql<string>`coalesce(sum(${glEntries.debit} - ${glEntries.credit}), 0)::text` })
        .from(glEntries)
        .innerJoin(accounts, eq(accounts.id, glEntries.accountId))
        .where(and(eq(glEntries.companyId, companyId), inArray(accounts.accountType, ['bank', 'cash']), lte(glEntries.postingDate, today)));
      // How late each customer usually pays: receipt date minus due date over settled invoices.
      const delays = await tx
        .select({ customerId: salesInvoices.customerId, days: sql<string>`avg(greatest(0, (rd.doc_date - ${salesInvoices.dueDate})))::text` })
        .from(moneyAllocations)
        .innerJoin(salesInvoices, eq(salesInvoices.id, moneyAllocations.againstDocId))
        .innerJoin(sql`documents rd`, sql`rd.id = ${moneyAllocations.voucherId}`)
        .where(and(sql`rd.status = 'approved'`, sql`${salesInvoices.dueDate} is not null`))
        .groupBy(salesInvoices.customerId);
      const delay = new Map(delays.map((d) => [d.customerId, Math.round(Number(d.days))]));
      const receivables = await tx
        .select({ customerId: salesInvoices.customerId, due: salesInvoices.dueDate, date: documents.docDate, amount: sql<string>`(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount})::text` })
        .from(salesInvoices)
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .where(and(eq(documents.companyId, companyId), inArray(documents.status, ['approved', 'completed']), sql`${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount} > 0`));
      const payables = await tx
        .select({ due: purchaseInvoices.dueDate, date: documents.docDate, amount: sql<string>`(${purchaseInvoices.netPayable} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.debitedAmount})::text` })
        .from(purchaseInvoices)
        .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
        .where(and(eq(documents.companyId, companyId), inArray(documents.status, ['approved', 'completed']), sql`${purchaseInvoices.netPayable} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.debitedAmount} > 0`));
      const weekOf = (date: string) => Math.max(0, Math.floor((Date.parse(date) - Date.parse(today)) / (7 * 86_400_000)));
      const weeks = Array.from({ length: q.weeks }, (_, i) => ({ week: i + 1, from: new Date(Date.parse(`${today}T00:00:00Z`) + i * 7 * 86_400_000).toISOString().slice(0, 10), inflow: ZERO, outflow: ZERO }));
      let beyondIn = ZERO;
      let beyondOut = ZERO;
      for (const r of receivables) {
        const expected = new Date(Date.parse(`${r.due ?? r.date}T00:00:00Z`) + (delay.get(r.customerId) ?? 0) * 86_400_000).toISOString().slice(0, 10);
        const w = weekOf(expected);
        if (w < q.weeks) weeks[w].inflow = weeks[w].inflow.add(D(r.amount));
        else beyondIn = beyondIn.add(D(r.amount));
      }
      for (const p of payables) {
        const w = weekOf(p.due ?? p.date);
        if (w < q.weeks) weeks[w].outflow = weeks[w].outflow.add(D(p.amount));
        else beyondOut = beyondOut.add(D(p.amount));
      }
      let bal = D(cash.v);
      const rows = weeks.map((w) => {
        bal = bal.add(w.inflow).sub(w.outflow);
        return { week: w.week, from: w.from, inflow: w.inflow.toFixed(2), outflow: w.outflow.toFixed(2), closing: bal.toFixed(2) };
      });
      const lowest = rows.reduce((m, r) => (Number(r.closing) < Number(m.closing) ? r : m), rows[0]);
      return { opening: D(cash.v).toFixed(2), weeks: rows, beyond: { inflow: beyondIn.toFixed(2), outflow: beyondOut.toFixed(2) }, lowest, note: 'Overdue amounts are expected in the first week; receipts are shifted by each customer’s average delay.' };
    });
  }
}
