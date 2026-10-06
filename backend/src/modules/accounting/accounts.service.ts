import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { accountingSettings, accounts, companies, costCenters, documents, glEntries, parties, type Transaction } from '@nextgen/database';
import { and, asc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { LedgerService } from './ledger.service';
import { PostingRulesService } from './posting-rules.service';

const D = Decimal.from;
const ZERO = D('0');

export const createAccountSchema = z.object({
  companyId: z.uuid().optional(),
  parentId: z.uuid(),
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9.\-/]+$/, 'Letters, digits, . - /'),
  name: z.string().trim().min(2).max(120),
  isGroup: z.boolean().default(false),
  accountType: z.enum(['bank', 'cash']).nullable().optional(),
  description: optionalText(500),
});
export const updateAccountSchema = z.object({
  parentId: z.uuid().optional(),
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9.\-/]+$/).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  accountType: z.enum(['bank', 'cash']).nullable().optional(),
  description: optionalText(500),
  isActive: z.boolean().optional(),
});
export const costCenterSchema = z.object({
  companyId: z.uuid().optional(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(120),
  parentId: z.uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export const settingsSchema = z.object({ booksFrom: z.iso.date().optional(), lockedUntil: z.iso.date().nullable().optional() });
export const periodQuerySchema = z.object({ companyId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() });
export const ledgerQuerySchema = periodQuerySchema.extend({ accountId: z.uuid().optional(), partyId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000) });

export interface BalanceRow {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isGroup: boolean;
  nature: string;
  systemKey: string | null;
  level: number;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
}

/** Chart of accounts, cost centres, book settings and the core reports (trial balance, ledgers). */
@Injectable()
export class AccountsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly rules: PostingRulesService,
  ) {}

  async company(tx: Transaction, companyId?: string) {
    if (companyId) return companyId;
    const [c] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
    if (!c) throw new NotFoundException('No company found');
    return c.id;
  }

  // ---- Settings ----------------------------------------------------------------------

  getSettings(auth: AuthContext, companyId?: string) {
    return this.database.run(auth, async (tx) => {
      const id = await this.company(tx, companyId);
      const s = await this.ledger.ensureBooks(tx, auth.tenantId, id, auth.userId);
      const [unposted] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, id),
            sql`${documents.docType} in (${sql.join(this.rules.docTypes.map((t) => sql`${t}`), sql`, `)})`,
            sql`${documents.status} in ('approved', 'completed')`,
            gte(documents.docDate, s.booksFrom),
            sql`not exists (select 1 from ${glEntries} g where g.voucher_id = ${documents.id})`,
          ),
        );
      return { companyId: id, booksFrom: s.booksFrom, lockedUntil: s.lockedUntil, initialisedAt: s.initialisedAt, unposted: unposted.n };
    });
  }

  updateSettings(auth: AuthContext, companyId: string, input: z.infer<typeof settingsSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.ledger.ensureBooks(tx, auth.tenantId, companyId, auth.userId);
      if (input.lockedUntil && input.lockedUntil > todayIST()) throw new BadRequestException('You can lock periods up to today, not the future');
      await tx
        .update(accountingSettings)
        .set({ ...(input.booksFrom ? { booksFrom: input.booksFrom } : {}), ...(input.lockedUntil !== undefined ? { lockedUntil: input.lockedUntil } : {}), updatedBy: auth.userId, updatedAt: new Date() })
        .where(eq(accountingSettings.companyId, companyId));
    }).then(() => this.getSettings(auth, companyId));
  }

  /** Posts approved documents dated from the books' start that are not in the ledger yet. */
  initialise(auth: AuthContext, companyId: string) {
    return this.database.run(auth, async (tx) => {
      const s = await this.ledger.ensureBooks(tx, auth.tenantId, companyId, auth.userId);
      const r = await this.rules.backPost(tx, auth, companyId, s.booksFrom);
      await tx.update(accountingSettings).set({ initialisedAt: new Date(), updatedBy: auth.userId, updatedAt: new Date() }).where(eq(accountingSettings.companyId, companyId));
      return r;
    });
  }

  // ---- Chart of accounts ---------------------------------------------------------------

  list(auth: AuthContext, companyId?: string) {
    return this.database.run(auth, async (tx) => {
      const id = await this.company(tx, companyId);
      await this.ledger.ensureBooks(tx, auth.tenantId, id, auth.userId);
      return this.balances(tx, id, null, todayIST());
    });
  }

  create(auth: AuthContext, input: z.infer<typeof createAccountSchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.company(tx, input.companyId);
      await this.ledger.ensureBooks(tx, auth.tenantId, companyId, auth.userId);
      const [parent] = await tx.select().from(accounts).where(and(eq(accounts.id, input.parentId), eq(accounts.companyId, companyId)));
      if (!parent) throw new BadRequestException({ message: 'Parent group not found', errors: [{ path: 'parentId', message: 'Choose a group' }] });
      if (!parent.isGroup) throw new BadRequestException({ message: `${parent.name} is an account, not a group`, errors: [{ path: 'parentId', message: 'Choose a group' }] });
      const [dup] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, input.code)));
      if (dup) throw new ConflictException({ message: `Code ${input.code} is already used`, errors: [{ path: 'code', message: 'Already used' }] });
      const [row] = await tx
        .insert(accounts)
        .values({
          tenantId: auth.tenantId,
          companyId,
          code: input.code,
          name: input.name,
          parentId: parent.id,
          isGroup: input.isGroup,
          nature: parent.nature,
          reportLine: parent.reportLine,
          accountType: input.accountType ?? null,
          description: input.description,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })
        .returning();
      return row;
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof updateAccountSchema>) {
    return this.database.run(auth, async (tx) => {
      const [acc] = await tx.select().from(accounts).where(eq(accounts.id, id));
      if (!acc) throw new NotFoundException('Account not found');
      let parentPatch = {};
      if (input.parentId && input.parentId !== acc.parentId) {
        const [parent] = await tx.select().from(accounts).where(and(eq(accounts.id, input.parentId), eq(accounts.companyId, acc.companyId)));
        if (!parent?.isGroup) throw new BadRequestException('Move it under a group of the same company');
        if (parent.nature !== acc.nature) throw new BadRequestException(`An ${acc.nature} account cannot move under ${parent.name} (${parent.nature})`);
        // No cycles.
        for (let p: typeof parent | undefined = parent; p; p = p.parentId ? (await tx.select().from(accounts).where(eq(accounts.id, p.parentId)))[0] : undefined) {
          if (p.id === acc.id) throw new BadRequestException('A group cannot move under itself');
        }
        parentPatch = { parentId: parent.id, reportLine: parent.reportLine };
      }
      if (input.isActive === false && acc.systemKey) throw new ConflictException(`${acc.name} is used by automatic postings and cannot be deactivated`);
      const [row] = await tx
        .update(accounts)
        .set({
          ...parentPatch,
          ...(input.code ? { code: input.code } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.accountType !== undefined ? { accountType: input.accountType } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedBy: auth.userId,
        })
        .where(eq(accounts.id, id))
        .returning();
      return row;
    });
  }

  // ---- Cost centres ------------------------------------------------------------------

  listCostCenters(auth: AuthContext, companyId?: string) {
    return this.database.run(auth, async (tx) => {
      const id = await this.company(tx, companyId);
      return tx.select().from(costCenters).where(eq(costCenters.companyId, id)).orderBy(asc(costCenters.code));
    });
  }

  saveCostCenter(auth: AuthContext, id: string | null, input: z.infer<typeof costCenterSchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.company(tx, input.companyId);
      if (id) {
        const [row] = await tx.update(costCenters).set({ code: input.code, name: input.name, parentId: input.parentId ?? null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}), updatedBy: auth.userId }).where(eq(costCenters.id, id)).returning();
        if (!row) throw new NotFoundException('Cost centre not found');
        return row;
      }
      const [dup] = await tx.select({ id: costCenters.id }).from(costCenters).where(and(eq(costCenters.companyId, companyId), eq(costCenters.code, input.code)));
      if (dup) throw new ConflictException({ message: `Code ${input.code} is already used`, errors: [{ path: 'code', message: 'Already used' }] });
      const [row] = await tx.insert(costCenters).values({ tenantId: auth.tenantId, companyId, code: input.code, name: input.name, parentId: input.parentId ?? null, createdBy: auth.userId, updatedBy: auth.userId }).returning();
      return row;
    });
  }

  // ---- Reports -------------------------------------------------------------------------

  /** Opening, movement and closing per account (debit positive), rolled up the tree. */
  async balances(tx: Transaction, companyId: string, from: string | null, to: string): Promise<BalanceRow[]> {
    const accs = await tx.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.code));
    const sums = await tx
      .select({
        accountId: glEntries.accountId,
        opening: from ? sql<string>`coalesce(sum(${glEntries.debit} - ${glEntries.credit}) filter (where ${glEntries.postingDate} < ${from}), 0)::text` : sql<string>`'0'`,
        debit: sql<string>`coalesce(sum(${glEntries.debit}) filter (where ${from ? sql`${glEntries.postingDate} >= ${from}` : sql`true`}), 0)::text`,
        credit: sql<string>`coalesce(sum(${glEntries.credit}) filter (where ${from ? sql`${glEntries.postingDate} >= ${from}` : sql`true`}), 0)::text`,
      })
      .from(glEntries)
      .where(and(eq(glEntries.companyId, companyId), lte(glEntries.postingDate, to)))
      .groupBy(glEntries.accountId);
    const own = new Map(sums.map((s) => [s.accountId, { opening: D(s.opening), debit: D(s.debit), credit: D(s.credit) }]));
    const children = new Map<string | null, typeof accs>();
    for (const a of accs) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
    const out: BalanceRow[] = [];
    const walk = (parentId: string | null, level: number): { opening: Decimal; debit: Decimal; credit: Decimal } => {
      let total = { opening: ZERO, debit: ZERO, credit: ZERO };
      for (const a of children.get(parentId) ?? []) {
        const idx = out.length;
        out.push(null as unknown as BalanceRow);
        const mine = own.get(a.id) ?? { opening: ZERO, debit: ZERO, credit: ZERO };
        const sub = a.isGroup ? walk(a.id, level + 1) : { opening: ZERO, debit: ZERO, credit: ZERO };
        const t = { opening: mine.opening.add(sub.opening), debit: mine.debit.add(sub.debit), credit: mine.credit.add(sub.credit) };
        out[idx] = {
          id: a.id,
          code: a.code,
          name: a.name,
          parentId: a.parentId,
          isGroup: a.isGroup,
          nature: a.nature,
          systemKey: a.systemKey,
          level,
          opening: t.opening.toFixed(2),
          debit: t.debit.toFixed(2),
          credit: t.credit.toFixed(2),
          closing: t.opening.add(t.debit).sub(t.credit).toFixed(2),
        };
        total = { opening: total.opening.add(t.opening), debit: total.debit.add(t.debit), credit: total.credit.add(t.credit) };
      }
      return total;
    };
    walk(null, 0);
    return out;
  }

  trialBalance(auth: AuthContext, q: z.infer<typeof periodQuerySchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.company(tx, q.companyId);
      const to = q.to ?? todayIST();
      const rows = await this.balances(tx, companyId, q.from ?? null, to);
      const leaves = rows.filter((r) => !r.isGroup);
      const sum = (f: (r: BalanceRow) => Decimal) => leaves.reduce((s, r) => s.add(f(r)), ZERO);
      const totals = {
        debit: sum((r) => D(r.debit)).toFixed(2),
        credit: sum((r) => D(r.credit)).toFixed(2),
        closingDebit: sum((r) => (D(r.closing).isNegative() ? ZERO : D(r.closing))).toFixed(2),
        closingCredit: sum((r) => (D(r.closing).isNegative() ? ZERO.sub(D(r.closing)) : ZERO)).toFixed(2),
      };
      return { companyId, from: q.from ?? null, to, rows, totals, balanced: totals.closingDebit === totals.closingCredit };
    });
  }

  /** Entries of one account (or one party across receivable / payable) with a running balance. */
  accountLedger(auth: AuthContext, q: z.infer<typeof ledgerQuerySchema>) {
    return this.database.run(auth, async (tx) => {
      if (!q.accountId && !q.partyId) throw new BadRequestException('Choose an account or a party');
      const companyId = await this.company(tx, q.companyId);
      const scope = and(eq(glEntries.companyId, companyId), q.accountId ? eq(glEntries.accountId, q.accountId) : undefined, q.partyId ? eq(glEntries.partyId, q.partyId) : undefined);
      const [open] = q.from
        ? await tx.select({ v: sql<string>`coalesce(sum(${glEntries.debit} - ${glEntries.credit}), 0)::text` }).from(glEntries).where(and(scope, lt(glEntries.postingDate, q.from)))
        : [{ v: '0' }];
      const against = sql<string | null>`(select d.number from ${documents} d where d.id = ${glEntries.againstVoucherId})`;
      const rows = await tx
        .select({
          id: glEntries.id,
          postingDate: glEntries.postingDate,
          voucherType: glEntries.voucherType,
          voucherId: glEntries.voucherId,
          voucherNumber: glEntries.voucherNumber,
          accountCode: accounts.code,
          accountName: accounts.name,
          party: parties.name,
          debit: glEntries.debit,
          credit: glEntries.credit,
          narration: glEntries.narration,
          against,
          isReversal: glEntries.isReversal,
        })
        .from(glEntries)
        .innerJoin(accounts, eq(accounts.id, glEntries.accountId))
        .leftJoin(parties, eq(parties.id, glEntries.partyId))
        .where(and(scope, q.from ? gte(glEntries.postingDate, q.from) : undefined, q.to ? lte(glEntries.postingDate, q.to) : undefined))
        .orderBy(asc(glEntries.postingDate), asc(glEntries.id))
        .limit(q.limit);
      let bal = D(open.v);
      const entries = rows.map((r) => {
        bal = bal.add(D(r.debit)).sub(D(r.credit));
        return { ...r, balance: bal.toFixed(2) };
      });
      const [acc] = q.accountId ? await tx.select({ id: accounts.id, code: accounts.code, name: accounts.name, nature: accounts.nature }).from(accounts).where(eq(accounts.id, q.accountId)) : [null];
      const [party] = q.partyId ? await tx.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.id, q.partyId)) : [null];
      return {
        account: acc ?? null,
        party: party ?? null,
        opening: D(open.v).toFixed(2),
        debit: rows.reduce((s, r) => s.add(D(r.debit)), ZERO).toFixed(2),
        credit: rows.reduce((s, r) => s.add(D(r.credit)), ZERO).toFixed(2),
        closing: bal.toFixed(2),
        entries,
        truncated: rows.length === q.limit,
      };
    });
  }

  /** All vouchers posted in a period with their entries. */
  dayBook(auth: AuthContext, q: z.infer<typeof periodQuerySchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.company(tx, q.companyId);
      const from = q.from ?? todayIST();
      const to = q.to ?? from;
      const rows = await tx
        .select({ voucherId: glEntries.voucherId, voucherType: glEntries.voucherType, voucherNumber: glEntries.voucherNumber, postingDate: glEntries.postingDate, accountCode: accounts.code, accountName: accounts.name, party: parties.name, debit: glEntries.debit, credit: glEntries.credit, isReversal: glEntries.isReversal })
        .from(glEntries)
        .innerJoin(accounts, eq(accounts.id, glEntries.accountId))
        .leftJoin(parties, eq(parties.id, glEntries.partyId))
        .where(and(eq(glEntries.companyId, companyId), gte(glEntries.postingDate, from), lte(glEntries.postingDate, to)))
        .orderBy(asc(glEntries.postingDate), asc(glEntries.voucherId), asc(glEntries.id))
        .limit(5000);
      const vouchers = new Map<string, { voucherId: string; voucherType: string; voucherNumber: string | null; postingDate: string; isReversal: boolean; lines: typeof rows }>();
      for (const r of rows) {
        const k = `${r.voucherId}|${r.isReversal}`;
        const v = vouchers.get(k) ?? { voucherId: r.voucherId, voucherType: r.voucherType, voucherNumber: r.voucherNumber, postingDate: r.postingDate, isReversal: r.isReversal, lines: [] };
        v.lines.push(r);
        vouchers.set(k, v);
      }
      return { from, to, vouchers: [...vouchers.values()] };
    });
  }
}
