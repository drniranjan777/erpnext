import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  accountingSettings,
  accounts,
  bankStatementLines,
  companies,
  documents,
  fixedAssets,
  glEntries,
  goodsReceiptLines,
  goodsReceipts,
  journals,
  purchaseInvoices,
} from '@nextgen/database';
import { and, eq, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { AccountsService } from './accounts.service';
import { JournalsService } from './journals.service';
import { PostingRulesService } from './posting-rules.service';
import { StatementsService } from './statements.service';

const D = Decimal.from;
const ZERO = D('0');

export const yearEndSchema = z.object({ companyId: z.uuid().optional(), fy: z.coerce.number().int().min(2000).max(2100), lock: z.boolean().default(false) });
export const revalueSchema = z.object({
  companyId: z.uuid().optional(),
  date: z.iso.date(),
  rates: z.array(z.object({ currency: z.string().regex(/^[A-Z]{3}$/), rate: z.union([z.string(), z.number()]).transform((v) => String(v)) })).min(1).max(20),
});
export const checklistSchema = z.object({ companyId: z.uuid().optional(), period: z.string().regex(/^\d{4}-\d{2}$/) });

/**
 * Period and year-end close: closing journal of a financial year (income and expenses into
 * retained earnings), revaluation of foreign-currency payables at the closing rate, and the
 * month-end checklist.
 */
@Injectable()
export class CloseService {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly journals: JournalsService,
    private readonly accountsSvc: AccountsService,
    private readonly statements: StatementsService,
    private readonly rules: PostingRulesService,
  ) {}

  /** Moves the year's income and expense balances into retained earnings (dated 31 March). */
  yearEnd(auth: AuthContext, input: z.infer<typeof yearEndSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, input.companyId);
      const [company] = await tx.select({ fyStartMonth: companies.fyStartMonth }).from(companies).where(eq(companies.id, companyId));
      const startMonth = company?.fyStartMonth ?? 4;
      const end = startMonth === 1 ? `${input.fy}-12-31` : new Date(Date.UTC(input.fy + 1, startMonth - 1, 0)).toISOString().slice(0, 10);
      if (await this.statements.closingJournal(tx, companyId, end)) throw new ConflictException(`The year ending ${end} is already closed. Cancel its closing journal to reopen it.`);
      const rows = await tx
        .select({ accountId: glEntries.accountId, v: sql<string>`sum(${glEntries.debit} - ${glEntries.credit})::text` })
        .from(glEntries)
        .innerJoin(accounts, eq(accounts.id, glEntries.accountId))
        .where(and(eq(glEntries.companyId, companyId), lte(glEntries.postingDate, end), inArray(accounts.nature, ['income', 'expense'])))
        .groupBy(glEntries.accountId);
      const open = rows.filter((r) => !D(r.v).isZero());
      if (!open.length) throw new BadRequestException(`Nothing to close: no income or expense balances up to ${end}`);
      const [re] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.systemKey, 'retained_earnings')));
      const profit = open.reduce((s, r) => s.sub(D(r.v)), ZERO);
      const lines = [
        ...open.map((r) => {
          const v = D(r.v);
          return { accountId: r.accountId, debit: v.isNegative() ? ZERO.sub(v).toFixed(2) : null, credit: v.isNegative() ? null : v.toFixed(2), narration: 'Closed to retained earnings' };
        }),
        { accountId: re.id, debit: profit.isNegative() ? ZERO.sub(profit).toFixed(2) : null, credit: profit.isNegative() ? null : profit.toFixed(2), narration: profit.isNegative() ? 'Loss for the year' : 'Profit for the year' },
      ].filter((l) => Number(l.debit ?? l.credit) > 0);
      const jv = await this.journals.createTx(tx, auth, { companyId, docDate: end, kind: 'journal', narration: `Year-end closing ${input.fy}-${String((input.fy + 1) % 100).padStart(2, '0')}`, lines }, meta, { kind: 'closing' });
      await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
      if (input.lock) await tx.update(accountingSettings).set({ lockedUntil: end, updatedBy: auth.userId, updatedAt: new Date() }).where(eq(accountingSettings.companyId, companyId));
      const posted = await this.documents.find(tx, jv.id, 'journal_entry');
      return { journalId: jv.id, number: posted.number, status: posted.status, profit: profit.toFixed(2), accounts: open.length, lockedUntil: input.lock ? end : null };
    });
  }

  /**
   * Restates open foreign-currency bills at the closing rate. The difference goes to exchange
   * gain / loss (unrealised) through a journal that reverses the next day.
   */
  revalue(auth: AuthContext, input: z.infer<typeof revalueSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, input.companyId);
      const outstanding = sql<string>`(${purchaseInvoices.netPayable} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.debitedAmount})`;
      const bills = await tx
        .select({ id: documents.id, number: documents.number, vendorId: purchaseInvoices.vendorId, currency: purchaseInvoices.currency, rate: purchaseInvoices.exchangeRate, outstanding: sql<string>`${outstanding}::text` })
        .from(purchaseInvoices)
        .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
        .where(and(eq(documents.companyId, companyId), inArray(documents.status, ['approved', 'completed']), sql`${purchaseInvoices.currency} <> 'INR'`, sql`${outstanding} > 0`, lte(documents.docDate, input.date)));
      const keys = await tx.select({ id: accounts.id, key: accounts.systemKey }).from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.systemKey, ['payable', 'fx_gain_loss'])));
      const payable = keys.find((k) => k.key === 'payable')!.id;
      const fx = keys.find((k) => k.key === 'fx_gain_loss')!.id;
      const lines: { accountId: string; partyId: string | null; againstVoucherId: string | null; debit: string | null; credit: string | null; narration: string }[] = [];
      const detail: { bill: string | null; currency: string; foreign: string; bookRate: string; closingRate: string; difference: string }[] = [];
      let net = ZERO;
      for (const b of bills) {
        const r = input.rates.find((x) => x.currency === b.currency);
        if (!r) continue;
        const foreign = D(b.outstanding).div(D(b.rate));
        const restated = foreign.mul(D(r.rate)).round(2);
        const diff = restated.sub(D(b.outstanding));
        if (diff.isZero()) continue;
        // More rupees owed = loss.
        lines.push({ accountId: payable, partyId: b.vendorId, againstVoucherId: b.id, debit: diff.isNegative() ? ZERO.sub(diff).toFixed(2) : null, credit: diff.isNegative() ? null : diff.toFixed(2), narration: `${b.number}: ${foreign.toFixed(2)} ${b.currency} at ${r.rate}` });
        net = net.add(diff);
        detail.push({ bill: b.number, currency: b.currency, foreign: foreign.toFixed(2), bookRate: D(b.rate).toFixed(4), closingRate: D(r.rate).toFixed(4), difference: diff.toFixed(2) });
      }
      if (!lines.length) return { journalId: null, number: null, bills: 0, net: '0.00', detail };
      lines.push({ accountId: fx, partyId: null, againstVoucherId: null, debit: net.isNegative() ? null : net.toFixed(2), credit: net.isNegative() ? ZERO.sub(net).toFixed(2) : null, narration: net.isNegative() ? 'Unrealised exchange gain' : 'Unrealised exchange loss' });
      const next = new Date(Date.parse(`${input.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      const jv = await this.journals.createTx(tx, auth, { companyId, docDate: input.date, kind: 'reversing', reverseOn: next, narration: `Revaluation of foreign-currency bills at ${input.date} rates`, lines: lines.map((l) => ({ ...l, costCenterId: null })) }, meta);
      await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
      const posted = await this.documents.find(tx, jv.id, 'journal_entry');
      return { journalId: jv.id, number: posted.number, bills: detail.length, net: net.toFixed(2), detail };
    });
  }

  /** What to finish before closing a month. */
  checklist(auth: AuthContext, q: z.infer<typeof checklistSchema>) {
    const [y, m] = q.period.split('-').map(Number);
    const from = `${q.period}-01`;
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, q.companyId);
      const items: { key: string; label: string; status: 'ok' | 'warn' | 'todo'; detail: string; link?: string }[] = [];
      const [settings] = await tx.select().from(accountingSettings).where(eq(accountingSettings.companyId, companyId));
      // Approved documents with no ledger entries.
      const [unposted] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(eq(documents.companyId, companyId), inArray(documents.docType, this.rules.docTypes), inArray(documents.status, ['approved', 'completed']), gte(documents.docDate, from), lte(documents.docDate, to), sql`not exists (select 1 from ${glEntries} g where g.voucher_id = ${documents.id})`));
      items.push({ key: 'unposted', label: 'Every approved document is in the ledger', status: unposted.n ? 'todo' : 'ok', detail: unposted.n ? `${unposted.n} approved document(s) have no entries` : 'All posted', link: '/accounting/settings' });
      const [open] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(eq(documents.companyId, companyId), inArray(documents.status, ['draft', 'pending_approval']), gte(documents.docDate, from), lte(documents.docDate, to)));
      items.push({ key: 'drafts', label: 'No drafts or pending approvals in the month', status: open.n ? 'warn' : 'ok', detail: open.n ? `${open.n} document(s) still in draft or awaiting approval` : 'None', link: '/approvals' });
      const [bank] = await tx.select({ n: sql<number>`count(*)::int` }).from(bankStatementLines).where(and(eq(bankStatementLines.companyId, companyId), eq(bankStatementLines.status, 'unmatched'), lte(bankStatementLines.txnDate, to)));
      const [stmt] = await tx.select({ n: sql<number>`count(*)::int` }).from(bankStatementLines).where(and(eq(bankStatementLines.companyId, companyId), gte(bankStatementLines.txnDate, from), lte(bankStatementLines.txnDate, to)));
      items.push({ key: 'bank', label: 'Bank statements imported and reconciled', status: !stmt.n ? 'todo' : bank.n ? 'warn' : 'ok', detail: !stmt.n ? 'No statement lines for the month yet' : bank.n ? `${bank.n} statement line(s) unmatched` : 'Reconciled', link: '/accounting/bank' });
      const cutoff = new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
      const [grni] = await tx
        .select({ n: sql<number>`count(distinct ${goodsReceipts.id})::int`, v: sql<string>`coalesce(sum((${goodsReceiptLines.acceptedQty} - ${goodsReceiptLines.billedQty}) * ${goodsReceiptLines.rate}), 0)::numeric(18,2)::text` })
        .from(goodsReceiptLines)
        .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.grnId))
        .innerJoin(documents, eq(documents.id, goodsReceipts.id))
        .where(and(eq(documents.companyId, companyId), eq(documents.status, 'approved'), lt(documents.docDate, cutoff), sql`${goodsReceiptLines.acceptedQty} > ${goodsReceiptLines.billedQty}`));
      items.push({ key: 'grni', label: 'Goods received over 30 days ago are billed', status: grni.n ? 'warn' : 'ok', detail: grni.n ? `${grni.n} GRN(s), ₹${grni.v} not yet billed` : 'Nothing old in GRNI', link: '/purchase/receipts' });
      const [dep] = await tx.select({ n: sql<number>`count(*)::int` }).from(fixedAssets).where(and(eq(fixedAssets.companyId, companyId), eq(fixedAssets.status, 'active'), lte(fixedAssets.capitalisedOn, to), sql`coalesce(${fixedAssets.depreciatedUntil}, '1900-01-01') < ${to}`));
      items.push({ key: 'depreciation', label: 'Depreciation charged to the month end', status: dep.n ? 'todo' : 'ok', detail: dep.n ? `${dep.n} asset(s) not depreciated to ${to}` : 'Up to date', link: '/assets' });
      const [gst] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(journals)
        .innerJoin(documents, eq(documents.id, journals.id))
        .where(and(eq(documents.companyId, companyId), eq(documents.status, 'approved'), eq(journals.narration, `GST set-off for ${q.period}`)));
      items.push({ key: 'gst', label: 'GST set-off posted for the month', status: gst.n ? 'ok' : 'todo', detail: gst.n ? 'Posted' : 'Not yet: GST → GSTR-3B → Post set-off', link: '/gst/gstr3b' });
      const [tds] = await tx
        .select({ v: sql<string>`coalesce(sum(${glEntries.credit} - ${glEntries.debit}), 0)::text` })
        .from(glEntries)
        .innerJoin(accounts, eq(accounts.id, glEntries.accountId))
        .where(and(eq(glEntries.companyId, companyId), eq(accounts.systemKey, 'tds_payable'), lte(glEntries.postingDate, to)));
      items.push({ key: 'tds', label: 'TDS deducted is deposited (due by the 7th)', status: D(tds.v).cmp(ZERO) > 0 ? 'todo' : 'ok', detail: D(tds.v).cmp(ZERO) > 0 ? `₹${D(tds.v).toFixed(2)} still to deposit` : 'Nothing pending', link: '/accounting/tds' });
      const [susp] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(glEntries)
        .innerJoin(accounts, eq(accounts.id, glEntries.accountId))
        .where(and(eq(glEntries.companyId, companyId), eq(accounts.systemKey, 'opening_balance'), gte(glEntries.postingDate, from), lte(glEntries.postingDate, to), isNotNull(glEntries.id)));
      items.push({ key: 'opening', label: 'No postings to "opening balance difference" this month', status: susp.n ? 'warn' : 'ok', detail: susp.n ? `${susp.n} entry(ies): opening stock or balances entered this month` : 'None' });
      const locked = !!settings?.lockedUntil && settings.lockedUntil >= to;
      items.push({ key: 'lock', label: 'Period locked', status: locked ? 'ok' : 'todo', detail: locked ? `Locked up to ${settings!.lockedUntil}` : 'Lock it once everything above is done', link: '/accounting/settings' });
      return { period: q.period, from, to, items, ready: items.every((i) => i.status === 'ok' || i.key === 'lock') };
    });
  }
}
