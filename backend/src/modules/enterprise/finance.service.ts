import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { allocationRules, consolidationGroups, intercompanyLinks, intercompanyTransactions, treasuryInstruments, type Transaction } from '@nextgen/database';
import { eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import type { SystemKey } from '../accounting/chart-template';
import { JournalsService } from '../accounting/journals.service';
import { LedgerService } from '../accounting/ledger.service';
import { DocumentsService } from '../documents/documents.service';
import { allocate, consolidate, depositInterestFor, depositValue, facilityUse, loanInterestFor, loanSchedule, outstanding, r2, reconcile, type AccountBalance, type MemberBooks } from './finance-rules';
import { many } from '../../common/sql';

const text = (n: number) => z.string().trim().max(n).nullable().optional();
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Month as 2026-04');

export const linkSchema = z.object({ companyId: z.uuid(), partyId: z.uuid() });
export const icSchema = z.object({
  txnDate: z.iso.date(),
  fromCompanyId: z.uuid(),
  toCompanyId: z.uuid(),
  kind: z.enum(['charge', 'sale', 'loan', 'repayment', 'other']),
  amount: z.number().positive(),
  description: z.string().trim().min(3).max(300),
  fromAccountId: z.uuid().nullable().optional(),
  toAccountId: z.uuid().nullable().optional(),
});
export const groupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  parentCompanyId: z.uuid(),
  members: z.array(z.object({ companyId: z.uuid(), ownershipPct: z.number().gt(0).max(100), investmentCost: z.number().min(0), acquiredOn: z.iso.date() })).max(50),
});
export const consolidateQuery = z.object({ from: z.iso.date(), to: z.iso.date() });
export const instrumentSchema = z.object({
  companyId: z.uuid(),
  kind: z.enum(['loan', 'fd', 'facility', 'lc', 'bg']),
  number: z.string().trim().min(1).max(40),
  bank: z.string().trim().min(2).max(120),
  principal: z.number().positive(),
  ratePct: z.number().min(0).max(50).default(0),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  method: z.enum(['emi', 'bullet', 'quarterly', 'monthly', 'simple']).nullable().optional(),
  facilityId: z.uuid().nullable().optional(),
  marginPct: z.number().min(0).max(100).default(0),
  beneficiary: text(160),
  purpose: text(300),
});
export const accrueSchema = z.object({ companyId: z.uuid(), period: month });
export const ruleSchema = z.object({
  companyId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  sourceCostCenterId: z.uuid(),
  accountIds: z.array(z.uuid()).max(200).default([]),
  basis: z.string().trim().min(2).max(40).default('percent'),
  targets: z.array(z.object({ costCenterId: z.uuid(), weight: z.number().positive() })).min(1).max(100),
  sequence: z.number().int().min(1).max(99).default(1),
});
export const runSchema = z.object({ period: month });

const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const SYSTEM: RequestMeta = { ip: null, userAgent: 'system', requestId: 'enterprise-finance' };

/**
 * Enterprise finance: inter-company transactions posted in both companies' books and reconciled,
 * group consolidation in Ind AS layout, treasury (loans, deposits, facilities, LCs and BGs, monthly
 * interest), and allocation of service cost centres.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly journals: JournalsService,
    private readonly documents: DocumentsService,
  ) {}

  /** Post a balanced journal in a company and approve it; lines name accounts by system key or id. */
  private async post(tx: Transaction, auth: AuthContext, companyId: string, date: string, narration: string, lines: { account: SystemKey | { id: string }; partyId?: string | null; costCenterId?: string | null; debit?: number; credit?: number }[]) {
    await this.ledger.ensureBooks(tx, auth.tenantId, companyId, auth.userId);
    const accs = await this.ledger.resolveAccounts(tx, companyId, lines.map((l) => ({ account: l.account })));
    const j = await this.journals.createTx(
      tx,
      auth,
      { companyId, docDate: date, kind: 'journal', narration, lines: lines.map((l, i) => ({ accountId: accs[i].id, partyId: l.partyId ?? null, costCenterId: l.costCenterId ?? null, debit: (l.debit ?? 0).toFixed(2), credit: (l.credit ?? 0).toFixed(2), narration: null, againstVoucherId: null })) },
      SYSTEM,
    );
    await this.documents.submit(tx, auth, await this.documents.find(tx, j.id, 'journal_entry'), SYSTEM);
    const [d] = await many<{ status: string; number: string }>(tx, sql`select status, number from documents where id = ${j.id}`);
    if (d.status !== 'approved') throw new ConflictException('Journals need approval in this workspace: approve the posted journal under Accounting → Journals');
    return { id: j.id, number: d.number };
  }

  companies(auth: AuthContext) {
    return this.database.run(auth, (tx) => many(tx, sql`select c.id, c.name, c.gstin, l.party_id as "partyId", p.name as party from companies c left join intercompany_links l on l.company_id = c.id left join parties p on p.id = l.party_id where c.deleted_at is null order by c.created_at`));
  }

  link(auth: AuthContext, input: z.infer<typeof linkSchema>) {
    return this.database.run(auth, async (tx) => {
      await tx
        .insert(intercompanyLinks)
        .values({ tenantId: auth.tenantId, ...input })
        .onConflictDoUpdate({ target: [intercompanyLinks.tenantId, intercompanyLinks.companyId], set: { partyId: input.partyId } });
      return { ok: true };
    });
  }

  // ---- inter-company -----------------------------------------------------------------------------

  transactions(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.number, t.txn_date as "txnDate", t.kind, t.amount, t.description, f.name as "from", c.name as "to",
                   (select number from documents where id = t.from_journal_id) as "fromJournal", (select number from documents where id = t.to_journal_id) as "toJournal"
            from intercompany_transactions t join companies f on f.id = t.from_company_id join companies c on c.id = t.to_company_id
            order by t.txn_date desc, t.created_at desc limit 300`,
      ),
    );
  }

  /** Post the transaction in the sender's books and mirror it in the receiver's. */
  createTransaction(auth: AuthContext, input: z.infer<typeof icSchema>) {
    if (input.fromCompanyId === input.toCompanyId) throw new BadRequestException('Choose two different companies');
    return this.database.run(auth, async (tx) => {
      const links = await tx.select().from(intercompanyLinks);
      const fromParty = links.find((l) => l.companyId === input.fromCompanyId)?.partyId;
      const toParty = links.find((l) => l.companyId === input.toCompanyId)?.partyId;
      if (!fromParty || !toParty) throw new ConflictException('Link both companies to the party that stands for them first');
      const cash = input.kind === 'loan' || input.kind === 'repayment';
      if (cash && (!input.fromAccountId || !input.toAccountId)) throw new BadRequestException('A loan or repayment moves money: choose the bank account in each company');
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int + 1 as n from intercompany_transactions`);
      const number = `IC-${String(n).padStart(5, '0')}`;
      const narration = `${number} ${input.kind}: ${input.description}`;
      const fromOther = input.fromAccountId ? { id: input.fromAccountId } : ('intercompany_income' as const);
      const toOther = input.toAccountId ? { id: input.toAccountId } : ('intercompany_expense' as const);
      const amt = input.amount;
      const repay = input.kind === 'repayment';
      // The sender is owed (or, repaying, settles what it owes); the receiver mirrors it.
      const fromJ = await this.post(tx, auth, input.fromCompanyId, input.txnDate, narration, repay ? [{ account: 'intercompany_payable', partyId: toParty, debit: amt }, { account: fromOther, credit: amt }] : [{ account: 'intercompany_receivable', partyId: toParty, debit: amt }, { account: fromOther, credit: amt }]);
      const toJ = await this.post(tx, auth, input.toCompanyId, input.txnDate, narration, repay ? [{ account: toOther, debit: amt }, { account: 'intercompany_receivable', partyId: fromParty, credit: amt }] : [{ account: toOther, debit: amt }, { account: 'intercompany_payable', partyId: fromParty, credit: amt }]);
      const [r] = await tx
        .insert(intercompanyTransactions)
        .values({ tenantId: auth.tenantId, number, ...input, fromAccountId: input.fromAccountId ?? null, toAccountId: input.toAccountId ?? null, fromJournalId: fromJ.id, toJournalId: toJ.id, createdBy: auth.userId })
        .returning();
      return { ...r, fromJournal: fromJ.number, toJournal: toJ.number };
    });
  }

  /** What each company shows against each other group company, on a date. */
  reconciliation(auth: AuthContext, on: string) {
    return this.database.run(auth, async (tx) => {
      const links = await many<{ companyId: string; partyId: string; name: string }>(tx, sql`select l.company_id as "companyId", l.party_id as "partyId", c.name from intercompany_links l join companies c on c.id = l.company_id`);
      const bal = await many<{ companyId: string; partyId: string; v: number }>(
        tx,
        sql`select company_id as "companyId", party_id as "partyId", sum(debit - credit)::float8 as v from gl_entries
            where party_id in (select party_id from intercompany_links) and posting_date <= ${on}::date group by company_id, party_id`,
      );
      const get = (c: string, p: string) => bal.find((b) => b.companyId === c && b.partyId === p)?.v ?? 0;
      const pairs: { a: string; b: string; aSaysB: number; bSaysA: number }[] = [];
      for (let i = 0; i < links.length; i++)
        for (let j = i + 1; j < links.length; j++) {
          const A = links[i];
          const B = links[j];
          const aSaysB = r2(get(A.companyId, B.partyId));
          const bSaysA = r2(get(B.companyId, A.partyId));
          if (aSaysB || bSaysA) pairs.push({ a: A.name, b: B.name, aSaysB, bSaysA });
        }
      return reconcile(pairs);
    });
  }

  // ---- consolidation -----------------------------------------------------------------------------

  groups(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(consolidationGroups).orderBy(consolidationGroups.createdAt));
  }

  saveGroup(auth: AuthContext, id: string | null, input: z.infer<typeof groupSchema>) {
    if (input.members.some((m) => m.companyId === input.parentCompanyId)) throw new BadRequestException('The parent is not one of its own subsidiaries');
    if (new Set(input.members.map((m) => m.companyId)).size !== input.members.length) throw new BadRequestException('A company is listed twice');
    return this.database.run(auth, async (tx) => {
      if (id) {
        const [r] = await tx.update(consolidationGroups).set(input).where(eq(consolidationGroups.id, id)).returning();
        if (!r) throw new NotFoundException('Group not found');
        return r;
      }
      const [r] = await tx
        .insert(consolidationGroups)
        .values({ tenantId: auth.tenantId, ...input })
        .returning();
      return r;
    });
  }

  /** Consolidated balance sheet on `to` and profit and loss for `from`–`to`. */
  consolidated(auth: AuthContext, groupId: string, q: z.infer<typeof consolidateQuery>) {
    return this.database.run(auth, async (tx) => {
      const [g] = await tx.select().from(consolidationGroups).where(eq(consolidationGroups.id, groupId));
      if (!g) throw new NotFoundException('Group not found');
      const ids = [g.parentCompanyId, ...g.members.map((m) => m.companyId)];
      const links = await tx.select().from(intercompanyLinks);
      const groupParties = links.filter((l) => ids.includes(l.companyId)).map((l) => l.partyId);
      const icJournals = (await many<{ id: string }>(tx, sql`select unnest(array[from_journal_id, to_journal_id]) as id from intercompany_transactions where from_company_id in ${ids} and to_company_id in ${ids}`)).map((r) => r.id).filter(Boolean);
      const none = '00000000-0000-0000-0000-000000000000';
      const parties = groupParties.length ? groupParties : [none];
      const journals = icJournals.length ? icJournals : [none];
      const excluded = sql`(g.party_id is not null and g.party_id in ${parties}) or (g.party_id is null and g.voucher_id in ${journals})`;
      const notClosing = sql`not exists (select 1 from journals j where j.id = g.voucher_id and j.kind = 'closing')`;
      const rows = (companyId: string, where: SQL, natures: string[]) =>
        many<AccountBalance>(
          tx,
          sql`select a.code, a.name, a.nature, a.report_line as "reportLine", a.system_key as key, sum(g.debit - g.credit)::float8 as balance
              from gl_entries g join accounts a on a.id = g.account_id
              where g.company_id = ${companyId} and a.nature in ${natures} and ${where}
              group by a.code, a.name, a.nature, a.report_line, a.system_key having sum(g.debit - g.credit) <> 0`,
        );
      const net = async (companyId: string, on: string) => {
        const [r] = await many<{ v: number }>(tx, sql`select coalesce(sum(g.debit - g.credit), 0)::float8 as v from gl_entries g join accounts a on a.id = g.account_id where g.company_id = ${companyId} and a.nature in ('asset', 'liability') and g.posting_date <= ${on}::date`);
        return r.v;
      };
      const names = new Map((await many<{ id: string; name: string }>(tx, sql`select id, name from companies where id in ${ids}`)).map((c) => [c.id, c.name]));
      const books: MemberBooks[] = [];
      for (const companyId of ids) {
        const m = g.members.find((x) => x.companyId === companyId);
        const bs = await rows(companyId, sql`g.posting_date <= ${q.to}::date and not (${excluded})`, ['asset', 'liability']);
        const pl = await rows(companyId, sql`g.posting_date between ${q.from}::date and ${q.to}::date and ${notClosing} and not (${excluded})`, ['income', 'expense']);
        const [own] = await many<{ v: number }>(tx, sql`select coalesce(-sum(g.debit - g.credit), 0)::float8 as v from gl_entries g join accounts a on a.id = g.account_id where g.company_id = ${companyId} and a.nature in ('income', 'expense') and g.posting_date between ${q.from}::date and ${q.to}::date and ${notClosing}`);
        const equity = companyId === g.parentCompanyId ? await rows(companyId, sql`g.posting_date <= ${q.to}::date`, ['equity']) : [];
        books.push({
          companyId,
          name: names.get(companyId) ?? companyId,
          isParent: companyId === g.parentCompanyId,
          ownershipPct: m?.ownershipPct ?? 100,
          investmentCost: m?.investmentCost ?? 0,
          bs: [...bs, ...equity],
          pl,
          netAssets: await net(companyId, q.to),
          netAssetsAtAcquisition: m ? await net(companyId, m.acquiredOn) : 0,
          profit: own.v,
        });
      }
      // Removing inter-company lines must not unbalance the books: anything left is a difference to reconcile.
      const removed = await many<{ v: number }>(tx, sql`select coalesce(sum(g.debit - g.credit), 0)::float8 as v from gl_entries g where g.company_id in ${ids} and g.posting_date <= ${q.to}::date and (${excluded})`);
      return { group: { id: g.id, name: g.name }, from: q.from, to: q.to, companies: books.map((b) => ({ id: b.companyId, name: b.name, isParent: b.isParent, ownershipPct: b.ownershipPct, netAssets: r2(b.netAssets), profit: r2(b.profit) })), ...consolidate(books), unreconciledDifference: r2(removed[0].v) };
    });
  }

  // ---- treasury ----------------------------------------------------------------------------------

  private view(i: typeof treasuryInstruments.$inferSelect, all: (typeof treasuryInstruments.$inferSelect)[], today: string) {
    if (i.kind === 'loan') {
      const rows = loanSchedule(i.principal, i.ratePct, i.startDate, i.endDate, (i.method as 'emi' | 'bullet') ?? 'emi');
      const next = rows.find((r) => r.date >= today) ?? null;
      return { ...i, outstanding: outstanding(rows, i.principal, today), next, installments: rows.length };
    }
    if (i.kind === 'fd') return { ...i, value: depositValue(i.principal, i.ratePct, i.startDate, i.endDate, i.method ?? 'quarterly', today), maturityValue: depositValue(i.principal, i.ratePct, i.startDate, i.endDate, i.method ?? 'quarterly', i.endDate) };
    if (i.kind === 'facility') return { ...i, use: facilityUse(i.principal, all.filter((x) => x.facilityId === i.id), today) };
    return { ...i, margin: r2((i.principal * i.marginPct) / 100), daysToExpiry: Math.round((Date.parse(i.endDate) - Date.parse(today)) / 86_400_000) };
  }

  treasury(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const all = await tx.select().from(treasuryInstruments).orderBy(treasuryInstruments.kind, treasuryInstruments.endDate);
      const today = todayIST();
      const items = all.map((i) => this.view(i, all, today));
      const active = items.filter((i) => i.status === 'active');
      return {
        items,
        summary: {
          borrowings: r2(active.filter((i) => i.kind === 'loan').reduce((a, i) => a + ('outstanding' in i ? i.outstanding : 0), 0)),
          deposits: r2(active.filter((i) => i.kind === 'fd').reduce((a, i) => a + ('value' in i ? i.value : 0), 0)),
          lcBg: r2(active.filter((i) => i.kind === 'lc' || i.kind === 'bg').reduce((a, i) => a + i.principal, 0)),
          maturing30: active.filter((i) => i.endDate >= today && Date.parse(i.endDate) - Date.parse(today) <= 30 * 86_400_000).map((i) => ({ id: i.id, kind: i.kind, number: i.number, endDate: i.endDate })),
        },
      };
    });
  }

  schedule(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [i] = await tx.select().from(treasuryInstruments).where(eq(treasuryInstruments.id, id));
      if (!i) throw new NotFoundException('Instrument not found');
      if (i.kind !== 'loan') throw new BadRequestException('Schedules are for loans');
      return loanSchedule(i.principal, i.ratePct, i.startDate, i.endDate, (i.method as 'emi' | 'bullet') ?? 'emi');
    });
  }

  addInstrument(auth: AuthContext, input: z.infer<typeof instrumentSchema>) {
    if (input.endDate <= input.startDate) throw new BadRequestException('The end date must be after the start');
    return this.database.run(auth, async (tx) => {
      if (input.facilityId) {
        const all = await tx.select().from(treasuryInstruments).where(eq(treasuryInstruments.companyId, input.companyId));
        const f = all.find((x) => x.id === input.facilityId && x.kind === 'facility');
        if (!f) throw new BadRequestException('Facility not found in this company');
        const use = facilityUse(f.principal, all.filter((x) => x.facilityId === f.id), todayIST());
        if (use.used + input.principal > f.principal) throw new ConflictException(`The facility has ${use.available} available`);
      }
      const method = input.method ?? (input.kind === 'loan' ? 'emi' : input.kind === 'fd' ? 'quarterly' : null);
      const [r] = await tx
        .insert(treasuryInstruments)
        .values({ tenantId: auth.tenantId, ...input, method })
        .onConflictDoNothing()
        .returning();
      if (!r) throw new ConflictException('This number is already recorded');
      return r;
    });
  }

  closeInstrument(auth: AuthContext, id: string, status: 'closed' | 'invoked') {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(treasuryInstruments).set({ status }).where(eq(treasuryInstruments.id, id)).returning();
      if (!r) throw new NotFoundException('Instrument not found');
      return r;
    });
  }

  /** Post the month's interest: on loans (expense, accrued liability) and deposits (accrued asset, income). Once per instrument and month. */
  accrue(auth: AuthContext, input: z.infer<typeof accrueSchema>) {
    return this.database.run(auth, async (tx) => {
      const list = (await tx.select().from(treasuryInstruments).where(eq(treasuryInstruments.companyId, input.companyId))).filter((i) => i.status === 'active' && (i.kind === 'loan' || i.kind === 'fd') && !i.accruals[input.period]);
      const date = monthEnd(input.period);
      const posted: { number: string; instrument: string; interest: number }[] = [];
      for (const i of list) {
        const interest = i.kind === 'loan' ? loanInterestFor(loanSchedule(i.principal, i.ratePct, i.startDate, i.endDate, (i.method as 'emi' | 'bullet') ?? 'emi'), input.period) : depositInterestFor(i.principal, i.ratePct, i.startDate, i.endDate, i.method ?? 'quarterly', input.period);
        if (interest <= 0) continue;
        const narration = `Interest ${input.period} on ${i.kind === 'loan' ? 'loan' : 'deposit'} ${i.number} (${i.bank})`;
        const j = await this.post(tx, auth, input.companyId, date, narration, i.kind === 'loan' ? [{ account: 'interest_expense', debit: interest }, { account: 'interest_payable', credit: interest }] : [{ account: 'interest_accrued', debit: interest }, { account: 'interest_income', credit: interest }]);
        await tx
          .update(treasuryInstruments)
          .set({ accruals: { ...i.accruals, [input.period]: j.id } })
          .where(eq(treasuryInstruments.id, i.id));
        posted.push({ number: j.number, instrument: i.number, interest });
      }
      return { period: input.period, posted };
    });
  }

  // ---- cost allocation ---------------------------------------------------------------------------

  rules(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.id, r.company_id as "companyId", r.name, r.basis, r.targets, r.account_ids as "accountIds", r.runs, r.sequence, c.code || ' · ' || c.name as source, r.source_cost_center_id as "sourceCostCenterId"
            from allocation_rules r join cost_centers c on c.id = r.source_cost_center_id order by r.sequence, r.name`,
      ),
    );
  }

  saveRule(auth: AuthContext, input: z.infer<typeof ruleSchema>) {
    if (input.targets.some((t) => t.costCenterId === input.sourceCostCenterId)) throw new BadRequestException('A cost centre cannot allocate to itself');
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(allocationRules)
        .values({ tenantId: auth.tenantId, ...input })
        .returning();
      return r;
    });
  }

  /** Move the source cost centre's expenses of the month to the targets, account by account. */
  runRule(auth: AuthContext, id: string, input: z.infer<typeof runSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(allocationRules).where(eq(allocationRules.id, id));
      if (!r) throw new NotFoundException('Rule not found');
      if (r.runs[input.period]) throw new ConflictException(`Already allocated for ${input.period}`);
      const from = `${input.period}-01`;
      const to = monthEnd(input.period);
      const bal = await many<{ accountId: string; v: number; manual: boolean }>(
        tx,
        sql`select g.account_id as "accountId", sum(g.debit - g.credit)::float8 as v, bool_and(a.allow_manual) as manual from gl_entries g join accounts a on a.id = g.account_id
            where g.company_id = ${r.companyId} and g.cost_center_id = ${r.sourceCostCenterId} and a.nature = 'expense' and g.posting_date between ${from}::date and ${to}::date
              ${r.accountIds.length ? sql`and g.account_id in ${r.accountIds}` : sql``}
            group by g.account_id having sum(g.debit - g.credit) > 0`,
      );
      const usable = bal.filter((b) => b.manual);
      if (!usable.length) throw new ConflictException('Nothing to allocate: the source cost centre has no expenses in this month');
      const lines: { account: { id: string }; costCenterId: string; debit?: number; credit?: number }[] = [];
      const weights = r.targets.map((t) => t.weight);
      for (const b of usable) {
        const v = r2(b.v);
        lines.push({ account: { id: b.accountId }, costCenterId: r.sourceCostCenterId, credit: v });
        allocate(v, weights).forEach((x, i) => x > 0 && lines.push({ account: { id: b.accountId }, costCenterId: r.targets[i].costCenterId, debit: x }));
      }
      const j = await this.post(tx, auth, r.companyId, to, `Allocation ${input.period}: ${r.name}`, lines);
      await tx
        .update(allocationRules)
        .set({ runs: { ...r.runs, [input.period]: j.id } })
        .where(eq(allocationRules.id, id));
      return { journal: j.number, allocated: r2(usable.reduce((a, b) => a + b.v, 0)), skipped: bal.length - usable.length };
    });
  }
}
