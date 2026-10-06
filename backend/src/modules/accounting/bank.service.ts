import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { accounts, bankReconciliations, bankStatementLines, glEntries, moneyVouchers, parties, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { decodeText, readTable } from '../imports/file-parser';
import { autoMatch, parseMt940, parseStatementTable, type BookEntry, type StatementLine } from './bank-statement';
import { MoneyService } from './money.service';

const D = Decimal.from;
const ZERO = D('0');

export const matchSchema = z.object({ lineId: z.uuid(), entryIds: z.array(z.uuid()).min(1).max(50) });
export const createFromLineSchema = z.object({ counterAccountId: z.uuid().nullable().optional(), partyId: z.uuid().nullable().optional() });
export const linesQuerySchema = z.object({ status: z.enum(['unmatched', 'matched', 'ignored']).optional(), limit: z.coerce.number().int().min(1).max(2000).default(500) });

/**
 * Bank reconciliation: statement import (CSV / Excel / MT940), automatic matching against
 * the bank account's ledger entries, manual matching, vouchers for unrecorded lines (charges,
 * interest), and the bank reconciliation statement.
 */
@Injectable()
export class BankService {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly money: MoneyService,
  ) {}

  private async bankAccount(tx: Transaction, accountId: string) {
    const [acc] = await tx.select().from(accounts).where(eq(accounts.id, accountId));
    if (!acc || acc.accountType !== 'bank') throw new NotFoundException('Bank account not found');
    return acc;
  }

  async import(auth: AuthContext, accountId: string, file: { buffer: Buffer; fileName: string }) {
    const isMt940 = /\.(sta|mt940|940)$/i.test(file.fileName) || decodeText(file.buffer).includes(':61:');
    let parsed: StatementLine[];
    try {
      parsed = isMt940 ? parseMt940(decodeText(file.buffer)) : parseStatementTable(await readTable(file.buffer, file.fileName));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Could not read the statement');
    }
    if (!parsed.length) throw new BadRequestException('No transactions found in the statement');
    return this.database.run(auth, async (tx) => {
      const acc = await this.bankAccount(tx, accountId);
      // Skip lines already imported (same date, amount and narration).
      const dates = [...new Set(parsed.map((p) => p.txnDate))];
      const existing = await tx.select({ txnDate: bankStatementLines.txnDate, withdrawal: bankStatementLines.withdrawal, deposit: bankStatementLines.deposit, description: bankStatementLines.description }).from(bankStatementLines).where(and(eq(bankStatementLines.accountId, accountId), inArray(bankStatementLines.txnDate, dates)));
      const key = (l: { txnDate: string; withdrawal: string; deposit: string; description: string }) => `${l.txnDate}|${D(l.withdrawal).toFixed(2)}|${D(l.deposit).toFixed(2)}|${l.description}`;
      const seen = new Set(existing.map(key));
      const fresh = parsed.filter((p) => {
        const k = key(p);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const importId = randomUUID();
      if (fresh.length) {
        await tx.insert(bankStatementLines).values(fresh.map((l, i) => ({ tenantId: auth.tenantId, companyId: acc.companyId, accountId, importId, lineNo: i + 1, ...l })));
      }
      const matched = await this.reconcile(tx, auth, accountId);
      return { imported: fresh.length, duplicates: parsed.length - fresh.length, matched, ...(await this.summary(tx, accountId)) };
    });
  }

  /** Runs the matching rules over unmatched lines and unreconciled entries. */
  autoReconcile(auth: AuthContext, accountId: string) {
    return this.database.run(auth, async (tx) => {
      await this.bankAccount(tx, accountId);
      const matched = await this.reconcile(tx, auth, accountId);
      return { matched, ...(await this.summary(tx, accountId)) };
    });
  }

  private async reconcile(tx: Transaction, _auth: AuthContext, accountId: string) {
    const lines = await tx.select().from(bankStatementLines).where(and(eq(bankStatementLines.accountId, accountId), eq(bankStatementLines.status, 'unmatched'))).orderBy(asc(bankStatementLines.txnDate));
    if (!lines.length) return 0;
    const entries = await this.openEntries(tx, accountId);
    const matches = autoMatch(lines, entries);
    for (const m of matches) {
      const line = lines[m.lineIndex];
      await tx.insert(bankReconciliations).values(m.entryIds.map((id) => ({ glEntryId: id, tenantId: line.tenantId, statementLineId: line.id, clearedOn: line.txnDate })));
      await tx.update(bankStatementLines).set({ status: 'matched', matchedBy: m.rule, matchedAt: new Date() }).where(eq(bankStatementLines.id, line.id));
    }
    return matches.length;
  }

  /** Ledger entries of the bank account not yet reconciled (cancelled vouchers excluded). */
  private async openEntries(tx: Transaction, accountId: string, asOf?: string): Promise<(BookEntry & { voucherId: string; voucherType: string; voucherNumber: string | null; narration: string | null; party: string | null })[]> {
    const rows = await tx
      .select({
        id: glEntries.id,
        postingDate: glEntries.postingDate,
        debit: glEntries.debit,
        credit: glEntries.credit,
        voucherId: glEntries.voucherId,
        voucherType: glEntries.voucherType,
        voucherNumber: glEntries.voucherNumber,
        narration: glEntries.narration,
        instrumentNo: moneyVouchers.instrumentNo,
        reference: moneyVouchers.reference,
        party: parties.name,
      })
      .from(glEntries)
      .leftJoin(moneyVouchers, eq(moneyVouchers.id, glEntries.voucherId))
      .leftJoin(parties, eq(parties.id, moneyVouchers.partyId))
      .leftJoin(bankReconciliations, eq(bankReconciliations.glEntryId, glEntries.id))
      .where(
        and(
          eq(glEntries.accountId, accountId),
          eq(glEntries.isReversal, false),
          isNull(bankReconciliations.glEntryId),
          sql`not exists (select 1 from ${glEntries} r where r.voucher_id = ${glEntries.voucherId} and r.account_id = ${glEntries.accountId} and r.is_reversal)`,
          asOf ? lte(glEntries.postingDate, asOf) : undefined,
        ),
      )
      .orderBy(asc(glEntries.postingDate));
    return rows.map((r) => ({
      id: r.id,
      postingDate: r.postingDate,
      amount: D(r.debit).sub(D(r.credit)).toFixed(2),
      refs: [r.instrumentNo, r.voucherNumber, r.reference].filter((v): v is string => !!v),
      voucherId: r.voucherId,
      voucherType: r.voucherType,
      voucherNumber: r.voucherNumber,
      narration: r.narration,
      party: r.party,
    }));
  }

  private async summary(tx: Transaction, accountId: string) {
    const [s] = await tx
      .select({ total: sql<number>`count(*)::int`, matched: sql<number>`count(*) filter (where ${bankStatementLines.status} = 'matched')::int`, ignored: sql<number>`count(*) filter (where ${bankStatementLines.status} = 'ignored')::int` })
      .from(bankStatementLines)
      .where(eq(bankStatementLines.accountId, accountId));
    return { totalLines: s.total, matchedLines: s.matched, matchRate: s.total - s.ignored ? Math.round((s.matched / (s.total - s.ignored)) * 1000) / 10 : null };
  }

  lines(auth: AuthContext, accountId: string, q: z.infer<typeof linesQuerySchema>) {
    return this.database.run(auth, async (tx) => {
      const acc = await this.bankAccount(tx, accountId);
      const lines = await tx
        .select()
        .from(bankStatementLines)
        .where(and(eq(bankStatementLines.accountId, accountId), q.status ? eq(bankStatementLines.status, q.status) : undefined))
        .orderBy(desc(bankStatementLines.txnDate), desc(bankStatementLines.lineNo))
        .limit(q.limit);
      const recs = lines.length
        ? await tx
            .select({ lineId: bankReconciliations.statementLineId, entryId: glEntries.id, voucherId: glEntries.voucherId, voucherType: glEntries.voucherType, voucherNumber: glEntries.voucherNumber, postingDate: glEntries.postingDate, debit: glEntries.debit, credit: glEntries.credit })
            .from(bankReconciliations)
            .innerJoin(glEntries, eq(glEntries.id, bankReconciliations.glEntryId))
            .where(inArray(bankReconciliations.statementLineId, lines.map((l) => l.id)))
        : [];
      const open = await this.openEntries(tx, accountId);
      return {
        account: { id: acc.id, code: acc.code, name: acc.name },
        lines: lines.map(({ tenantId: _t, ...l }) => ({ ...l, entries: recs.filter((r) => r.lineId === l.id) })),
        openEntries: open,
        ...(await this.summary(tx, accountId)),
      };
    });
  }

  match(auth: AuthContext, input: z.infer<typeof matchSchema>) {
    return this.database.run(auth, async (tx) => {
      const [line] = await tx.select().from(bankStatementLines).where(eq(bankStatementLines.id, input.lineId)).for('update');
      if (!line) throw new NotFoundException('Statement line not found');
      if (line.status !== 'unmatched') throw new ConflictException('This line is already matched or ignored');
      const open = await this.openEntries(tx, line.accountId);
      const picked = open.filter((e) => input.entryIds.includes(e.id));
      if (picked.length !== input.entryIds.length) throw new BadRequestException('Some entries are already reconciled or not of this bank account');
      const sum = picked.reduce((s, e) => s.add(D(e.amount)), ZERO);
      const want = D(line.deposit).sub(D(line.withdrawal));
      if (sum.cmp(want) !== 0) throw new BadRequestException(`The entries add up to ${sum.toFixed(2)}, the statement line is ${want.toFixed(2)}`);
      await tx.insert(bankReconciliations).values(picked.map((e) => ({ glEntryId: e.id, tenantId: auth.tenantId, statementLineId: line.id, clearedOn: line.txnDate })));
      await tx.update(bankStatementLines).set({ status: 'matched', matchedBy: 'manual', matchedAt: new Date() }).where(eq(bankStatementLines.id, line.id));
      return { ok: true };
    });
  }

  unmatch(auth: AuthContext, lineId: string) {
    return this.database.run(auth, async (tx) => {
      await tx.delete(bankReconciliations).where(eq(bankReconciliations.statementLineId, lineId));
      await tx.update(bankStatementLines).set({ status: 'unmatched', matchedBy: null, matchedAt: null }).where(eq(bankStatementLines.id, lineId));
      return { ok: true };
    });
  }

  ignore(auth: AuthContext, lineId: string) {
    return this.database.run(auth, async (tx) => {
      const [line] = await tx.select().from(bankStatementLines).where(eq(bankStatementLines.id, lineId));
      if (!line || line.status === 'matched') throw new ConflictException('Unmatch the line first');
      await tx.update(bankStatementLines).set({ status: 'ignored' }).where(eq(bankStatementLines.id, lineId));
      return { ok: true };
    });
  }

  /** Records a voucher for a statement line not in the books (charges, interest, a receipt) and matches it. */
  createFromLine(auth: AuthContext, lineId: string, input: z.infer<typeof createFromLineSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [line] = await tx.select().from(bankStatementLines).where(eq(bankStatementLines.id, lineId)).for('update');
      if (!line || line.status !== 'unmatched') throw new ConflictException('Only unmatched lines can be recorded');
      const deposit = D(line.deposit).cmp(ZERO) > 0;
      const amount = deposit ? line.deposit : line.withdrawal;
      const v = await this.money.createTx(
        tx,
        auth,
        {
          kind: deposit ? 'receipt' : 'payment',
          companyId: line.companyId,
          docDate: line.txnDate,
          accountId: line.accountId,
          partyId: input.partyId ?? null,
          counterAccountId: input.partyId ? null : (input.counterAccountId ?? null),
          mode: 'neft',
          amount,
          bankCharges: null,
          tdsDeducted: null,
          allocations: [],
          autoAllocate: !!input.partyId,
          reference: line.reference,
          narration: line.description.slice(0, 500),
          instrumentNo: null,
        },
        meta,
      );
      await this.documents.submit(tx, auth, await this.documents.find(tx, v.id, deposit ? 'receipt' : 'payment'), meta);
      const [entry] = await tx.select({ id: glEntries.id }).from(glEntries).where(and(eq(glEntries.voucherId, v.id), eq(glEntries.accountId, line.accountId), eq(glEntries.isReversal, false)));
      if (!entry) throw new ConflictException('The voucher is waiting for approval; match it once it is posted');
      await tx.insert(bankReconciliations).values({ glEntryId: entry.id, tenantId: auth.tenantId, statementLineId: line.id, clearedOn: line.txnDate });
      await tx.update(bankStatementLines).set({ status: 'matched', matchedBy: 'created', matchedAt: new Date() }).where(eq(bankStatementLines.id, line.id));
      return { voucherId: v.id, number: (await this.documents.find(tx, v.id, deposit ? 'receipt' : 'payment')).number };
    });
  }

  /** Bank reconciliation statement as of a date. */
  brs(auth: AuthContext, accountId: string, asOf?: string) {
    return this.database.run(auth, async (tx) => {
      const acc = await this.bankAccount(tx, accountId);
      const date = asOf ?? todayIST();
      const [books] = await tx.select({ v: sql<string>`coalesce(sum(${glEntries.debit} - ${glEntries.credit}), 0)::text` }).from(glEntries).where(and(eq(glEntries.accountId, accountId), lte(glEntries.postingDate, date)));
      // Entries in the books by the date that the bank had not cleared by the date.
      const rows = await tx
        .select({ id: glEntries.id, postingDate: glEntries.postingDate, debit: glEntries.debit, credit: glEntries.credit, voucherId: glEntries.voucherId, voucherType: glEntries.voucherType, voucherNumber: glEntries.voucherNumber, narration: glEntries.narration, clearedOn: bankReconciliations.clearedOn })
        .from(glEntries)
        .leftJoin(bankReconciliations, eq(bankReconciliations.glEntryId, glEntries.id))
        .where(
          and(
            eq(glEntries.accountId, accountId),
            eq(glEntries.isReversal, false),
            lte(glEntries.postingDate, date),
            sql`(${bankReconciliations.clearedOn} is null or ${bankReconciliations.clearedOn} > ${date})`,
            sql`not exists (select 1 from ${glEntries} r where r.voucher_id = ${glEntries.voucherId} and r.account_id = ${glEntries.accountId} and r.is_reversal and r.posting_date <= ${date})`,
          ),
        )
        .orderBy(asc(glEntries.postingDate));
      const deposits = rows.filter((r) => D(r.debit).cmp(ZERO) > 0);
      const payments = rows.filter((r) => D(r.credit).cmp(ZERO) > 0);
      const notCredited = deposits.reduce((s, r) => s.add(D(r.debit)), ZERO);
      const notPresented = payments.reduce((s, r) => s.add(D(r.credit)), ZERO);
      const expected = D(books.v).sub(notCredited).add(notPresented);
      const [last] = await tx
        .select({ balance: bankStatementLines.balance, txnDate: bankStatementLines.txnDate })
        .from(bankStatementLines)
        .where(and(eq(bankStatementLines.accountId, accountId), lte(bankStatementLines.txnDate, date), sql`${bankStatementLines.balance} is not null`))
        .orderBy(desc(bankStatementLines.txnDate), desc(bankStatementLines.lineNo))
        .limit(1);
      // Statement lines not in the books yet (charges, interest, direct receipts).
      const [unrecorded] = await tx
        .select({ dep: sql<string>`coalesce(sum(${bankStatementLines.deposit}), 0)::text`, wd: sql<string>`coalesce(sum(${bankStatementLines.withdrawal}), 0)::text`, n: sql<number>`count(*)::int` })
        .from(bankStatementLines)
        .where(and(eq(bankStatementLines.accountId, accountId), eq(bankStatementLines.status, 'unmatched'), lte(bankStatementLines.txnDate, date)));
      return {
        account: { id: acc.id, code: acc.code, name: acc.name },
        asOf: date,
        balanceAsPerBooks: D(books.v).toFixed(2),
        depositsNotCredited: { total: notCredited.toFixed(2), entries: deposits },
        paymentsNotPresented: { total: notPresented.toFixed(2), entries: payments },
        expectedBankBalance: expected.toFixed(2),
        statementBalance: last ? D(last.balance!).toFixed(2) : null,
        statementDate: last?.txnDate ?? null,
        unrecordedInBooks: { deposits: D(unrecorded.dep).toFixed(2), withdrawals: D(unrecorded.wd).toFixed(2), lines: unrecorded.n },
        difference: last ? D(last.balance!).sub(expected).toFixed(2) : null,
      };
    });
  }

  /** Bank and cash accounts of the company (for pickers). */
  moneyAccounts(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx.select({ id: accounts.id, code: accounts.code, name: accounts.name, accountType: accounts.accountType, companyId: accounts.companyId }).from(accounts).where(and(inArray(accounts.accountType, ['bank', 'cash']), eq(accounts.isActive, true), eq(accounts.isGroup, false))).orderBy(asc(accounts.code));
      const bal = rows.length
        ? await tx.select({ accountId: glEntries.accountId, v: sql<string>`sum(${glEntries.debit} - ${glEntries.credit})::text` }).from(glEntries).where(inArray(glEntries.accountId, rows.map((r) => r.id))).groupBy(glEntries.accountId)
        : [];
      return rows.map((r) => ({ ...r, balance: D(bal.find((b) => b.accountId === r.id)?.v ?? '0').toFixed(2) }));
    });
  }
}
