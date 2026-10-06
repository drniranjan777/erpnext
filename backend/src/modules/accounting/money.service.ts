import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { accounts, companies, documents, moneyAllocations, moneyVouchers, parties, purchaseInvoices, salesInvoices, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { decimalSchema, optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { JournalsService } from './journals.service';
import { LedgerService, type GlLine } from './ledger.service';

const D = Decimal.from;
const ZERO = D('0');
export const MONEY_TYPES = ['receipt', 'payment', 'contra'] as const;
export type MoneyKind = (typeof MONEY_TYPES)[number];
const SYSTEM_META: RequestMeta = { ip: null, userAgent: 'system', requestId: 'accounting' };

type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

const positive = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,14}(\.\d{1,2})?$/.test(v) && Number(v) > 0, `${label} must be more than zero`);

export const moneySchema = z.object({
  kind: z.enum(MONEY_TYPES),
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: z.iso.date().optional(),
  partyId: z.uuid().nullable().optional(),
  accountId: z.uuid(),
  counterAccountId: z.uuid().nullable().optional(),
  mode: z.enum(['cash', 'cheque', 'neft', 'rtgs', 'imps', 'upi', 'card', 'dd']).default('neft'),
  instrumentNo: optionalText(30),
  instrumentDate: z.iso.date().nullable().optional(),
  amount: positive('Amount'),
  bankCharges: decimalSchema(2, 'Bank charges'),
  tdsDeducted: decimalSchema(2, 'TDS'),
  allocations: z.array(z.object({ againstDocId: z.uuid(), amount: positive('Amount') })).max(500).default([]),
  /** Settle the oldest bills first with whatever is not allocated by hand. */
  autoAllocate: z.boolean().default(false),
  reference: optionalText(60),
  narration: optionalText(500),
});
export type MoneyInput = z.infer<typeof moneySchema>;
export const updateMoneySchema = moneySchema.extend({ version: z.number().int() });

export const adjustSchema = z.object({ againstDocId: z.uuid(), amount: positive('Amount') });
export const writeOffSchema = z.object({ invoiceId: z.uuid(), amount: positive('Amount').optional(), reason: z.string().trim().min(3).max(300) });
export const chequeSchema = z.object({ status: z.enum(['cleared', 'bounced']), reason: optionalText(200) });

export interface OpenBill {
  id: string;
  docType: string;
  number: string | null;
  docDate: string;
  reference: string | null;
  dueDate: string | null;
  total: string;
  outstanding: string;
  daysOverdue: number;
}

/**
 * Receipts, payments and contra entries. Receipts and payments settle bills (sales / purchase
 * invoices) through allocations; the rest stays on account as an advance and can be adjusted
 * against a bill later.
 */
@Injectable()
export class MoneyService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly ledger: LedgerService,
    private readonly journals: JournalsService,
  ) {}

  onModuleInit() {
    for (const kind of MONEY_TYPES) {
      this.documents.registerHooks(kind, {
        amendable: false,
        onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
        onCancelled: (tx, auth, doc) => this.unpost(tx, auth, doc),
      });
    }
  }

  list(auth: AuthContext, kind: MoneyKind, q: { status?: string; q?: string; partyId?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          party: parties.name,
          partyId: moneyVouchers.partyId,
          account: accounts.name,
          mode: moneyVouchers.mode,
          instrumentNo: moneyVouchers.instrumentNo,
          chequeStatus: moneyVouchers.chequeStatus,
          amount: moneyVouchers.amount,
          onAccount: moneyVouchers.onAccount,
          reference: moneyVouchers.reference,
        })
        .from(documents)
        .innerJoin(moneyVouchers, eq(moneyVouchers.id, documents.id))
        .innerJoin(accounts, eq(accounts.id, moneyVouchers.accountId))
        .leftJoin(parties, eq(parties.id, moneyVouchers.partyId))
        .where(
          and(
            eq(documents.docType, kind),
            q.status ? eq(documents.status, q.status as 'approved') : undefined,
            q.partyId ? eq(moneyVouchers.partyId, q.partyId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(moneyVouchers.instrumentNo, `%${term}%`), ilike(moneyVouchers.reference, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [doc] = await tx.select().from(documents).where(and(eq(documents.id, id), inArray(documents.docType, [...MONEY_TYPES])));
      if (!doc) throw new BadRequestException('Voucher not found');
      return this.view(tx, auth, doc);
    });
  }

  create(auth: AuthContext, input: MoneyInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  async createTx(tx: Transaction, auth: AuthContext, input: MoneyInput, meta: RequestMeta, opts: { writeOff?: boolean } = {}) {
    const companyId = input.companyId ?? (await this.defaultCompany(tx));
    const p = await this.prepare(tx, auth, companyId, input, null, opts);
    const doc = await this.documents.create(tx, auth, { docType: input.kind, companyId, branchId: input.branchId ?? null, docDate: input.docDate ?? todayIST(), title: p.title, amount: D(input.amount).toFixed(2) });
    await tx.insert(moneyVouchers).values({ id: doc.id, tenantId: auth.tenantId, ...p.header });
    if (p.allocations.length) await tx.insert(moneyAllocations).values(p.allocations.map((a) => ({ ...a, tenantId: auth.tenantId, voucherId: doc.id })));
    await this.documents.log(tx, auth, doc, 'document.created', meta, { amount: input.amount, bills: p.allocations.length });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: MoneyInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, input.kind, input.version);
      this.documents.assertEditable(doc);
      const p = await this.prepare(tx, auth, doc.companyId, input, id);
      await tx.update(moneyVouchers).set(p.header).where(eq(moneyVouchers.id, id));
      await tx.delete(moneyAllocations).where(eq(moneyAllocations.voucherId, id));
      if (p.allocations.length) await tx.insert(moneyAllocations).values(p.allocations.map((a) => ({ ...a, tenantId: auth.tenantId, voucherId: id })));
      const updated = await this.documents.update(tx, auth, doc, { title: p.title, amount: D(input.amount).toFixed(2), ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.view(tx, auth, updated);
    });
  }

  remove(auth: AuthContext, kind: MoneyKind, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, kind, version);
      await this.documents.deleteDraft(tx, auth, doc, meta);
    });
  }

  submit(auth: AuthContext, kind: MoneyKind, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, kind, version);
      await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, await this.documents.find(tx, id, kind));
    });
  }

  cancel(auth: AuthContext, kind: MoneyKind, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, kind, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  /** Cheque cleared, or bounced (the receipt / payment is cancelled and the bills reopen). */
  cheque(auth: AuthContext, id: string, input: z.infer<typeof chequeSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [mv] = await tx.select().from(moneyVouchers).where(eq(moneyVouchers.id, id));
      if (!mv || mv.mode !== 'cheque') throw new BadRequestException('Not a cheque voucher');
      const doc = await this.documents.lock(tx, id, mv.kind as MoneyKind);
      if (doc.status !== 'approved') throw new ConflictException('Only posted cheques can be cleared or bounced');
      if (mv.chequeStatus !== 'pending') throw new ConflictException(`This cheque is already ${mv.chequeStatus}`);
      if (input.status === 'cleared') {
        await tx.update(moneyVouchers).set({ chequeStatus: 'cleared' }).where(eq(moneyVouchers.id, id));
        await this.documents.activity(tx, auth, id, 'status', 'Cheque cleared');
        return this.view(tx, auth, doc);
      }
      const cancelled = await this.documents.cancel(tx, auth, doc, `Cheque ${mv.instrumentNo ?? ''} bounced${input.reason ? `: ${input.reason}` : ''}`.trim(), meta);
      await tx.update(moneyVouchers).set({ chequeStatus: 'bounced' }).where(eq(moneyVouchers.id, id));
      return this.view(tx, auth, cancelled);
    });
  }

  /** Adjusts part of an advance (on-account amount) against a bill, through a journal. */
  adjust(auth: AuthContext, id: string, input: z.infer<typeof adjustSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [mv] = await tx.select().from(moneyVouchers).where(eq(moneyVouchers.id, id)).for('update');
      if (!mv?.partyId) throw new BadRequestException('Only receipts and payments with a party carry advances');
      const doc = await this.documents.find(tx, id, mv.kind as MoneyKind);
      if (doc.status !== 'approved') throw new ConflictException('Adjust advances of posted vouchers only');
      const amount = D(input.amount);
      if (amount.cmp(D(mv.onAccount)) > 0) fail([{ path: 'amount', message: `Only ₹${D(mv.onAccount).toFixed(2)} of this voucher is unadjusted` }]);
      const [bill] = await this.openBills(tx, mv.kind === 'receipt' ? 'receivable' : 'payable', mv.partyId, [input.againstDocId]);
      if (!bill) fail([{ path: 'againstDocId', message: 'Bill not found for this party' }]);
      if (amount.cmp(D(bill.outstanding)) > 0) fail([{ path: 'amount', message: `Only ₹${bill.outstanding} is outstanding on ${bill.number}` }]);
      const control = mv.kind === 'receipt' ? 'receivable' : 'payable';
      const [acc] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, doc.companyId), eq(accounts.systemKey, control)));
      const fromAdvance = { accountId: acc.id, partyId: mv.partyId, againstVoucherId: id, narration: `Advance ${doc.number} adjusted` };
      const toBill = { accountId: acc.id, partyId: mv.partyId, againstVoucherId: bill.id, narration: `Against ${bill.number}` };
      const jv = await this.journals.createTx(
        tx,
        auth,
        {
          companyId: doc.companyId,
          branchId: doc.branchId,
          docDate: todayIST() < doc.docDate ? doc.docDate : todayIST(),
          kind: 'journal',
          narration: `Advance ${doc.number} adjusted against ${bill.number}`,
          lines:
            mv.kind === 'receipt'
              ? [
                  { ...fromAdvance, debit: amount.toFixed(2), credit: null },
                  { ...toBill, debit: null, credit: amount.toFixed(2) },
                ]
              : [
                  { ...toBill, debit: amount.toFixed(2), credit: null },
                  { ...fromAdvance, debit: null, credit: amount.toFixed(2) },
                ],
        },
        meta,
      );
      await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
      await tx.insert(moneyAllocations).values({ tenantId: auth.tenantId, voucherId: id, againstDocId: bill.id, amount: amount.toFixed(2), adjustmentId: jv.id });
      await tx.update(moneyVouchers).set({ onAccount: D(mv.onAccount).sub(amount).toFixed(2) }).where(eq(moneyVouchers.id, id));
      await this.settle(tx, bill.docType, bill.id, amount);
      await this.documents.activity(tx, auth, id, 'status', `₹${amount.toFixed(2)} adjusted against ${bill.number}`, { journal: jv.id });
      return this.view(tx, auth, doc);
    });
  }

  /** Writes off what a customer owes on an invoice (bad debt). */
  writeOff(auth: AuthContext, input: z.infer<typeof writeOffSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [inv] = await tx.select({ customerId: salesInvoices.customerId, companyId: documents.companyId, number: documents.number }).from(salesInvoices).innerJoin(documents, eq(documents.id, salesInvoices.id)).where(eq(salesInvoices.id, input.invoiceId));
      if (!inv) fail([{ path: 'invoiceId', message: 'Invoice not found' }]);
      const [bill] = await this.openBills(tx, 'receivable', inv.customerId, [input.invoiceId]);
      if (!bill || D(bill.outstanding).cmp(ZERO) <= 0) fail([{ path: 'invoiceId', message: 'Nothing is outstanding on this invoice' }]);
      const amount = input.amount ?? bill.outstanding;
      const [bad] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, inv.companyId), eq(accounts.systemKey, 'bad_debts')));
      if (!bad) fail([{ path: 'invoiceId', message: 'The chart of accounts has no bad debts account' }]);
      const v = await this.createTx(
        tx,
        auth,
        { kind: 'receipt', companyId: inv.companyId, partyId: inv.customerId, accountId: bad.id, mode: 'neft', amount, bankCharges: null, tdsDeducted: null, allocations: [{ againstDocId: input.invoiceId, amount }], autoAllocate: false, narration: `Written off: ${input.reason}`, reference: null, instrumentNo: null },
        meta,
        { writeOff: true },
      );
      await tx.update(moneyVouchers).set({ mode: 'write_off' }).where(eq(moneyVouchers.id, v.id));
      await this.documents.submit(tx, auth, await this.documents.find(tx, v.id, 'receipt'), meta);
      return this.view(tx, auth, await this.documents.find(tx, v.id, 'receipt'));
    });
  }

  // ---- bills ---------------------------------------------------------------------------

  /** Approved bills of a party with what is still open on them. */
  async openBills(tx: Transaction, side: 'receivable' | 'payable', partyId: string, ids?: string[]): Promise<OpenBill[]> {
    const today = todayIST();
    if (side === 'receivable') {
      const outstanding = sql<string>`(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount})`;
      const rows = await tx
        .select({ id: documents.id, docType: documents.docType, number: documents.number, docDate: documents.docDate, reference: salesInvoices.customerPoNo, dueDate: salesInvoices.dueDate, total: salesInvoices.grandTotal, outstanding: sql<string>`${outstanding}::numeric(18,2)::text` })
        .from(salesInvoices)
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .where(and(eq(salesInvoices.customerId, partyId), inArray(documents.status, ['approved', 'completed']), ids ? inArray(documents.id, ids) : sql`${outstanding} > 0`))
        .orderBy(asc(salesInvoices.dueDate), asc(documents.docDate));
      return rows.map((r) => ({ ...r, daysOverdue: r.dueDate && r.dueDate < today ? Math.round((Date.parse(today) - Date.parse(r.dueDate)) / 86_400_000) : 0 }));
    }
    const outstanding = sql<string>`(${purchaseInvoices.netPayable} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.debitedAmount})`;
    const rows = await tx
      .select({ id: documents.id, docType: documents.docType, number: documents.number, docDate: documents.docDate, reference: purchaseInvoices.supplierInvoiceNo, dueDate: purchaseInvoices.dueDate, total: purchaseInvoices.netPayable, outstanding: sql<string>`${outstanding}::numeric(18,2)::text` })
      .from(purchaseInvoices)
      .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
      .where(and(eq(purchaseInvoices.vendorId, partyId), inArray(documents.status, ['approved', 'completed']), ids ? inArray(documents.id, ids) : sql`${outstanding} > 0`))
      .orderBy(asc(purchaseInvoices.dueDate), asc(documents.docDate));
    return rows.map((r) => ({ ...r, daysOverdue: r.dueDate && r.dueDate < today ? Math.round((Date.parse(today) - Date.parse(r.dueDate)) / 86_400_000) : 0 }));
  }

  /** Posted receipts / payments with an unadjusted advance. */
  async advances(tx: Transaction, kind: 'receipt' | 'payment', partyId: string) {
    return tx
      .select({ id: documents.id, number: documents.number, docDate: documents.docDate, amount: moneyVouchers.amount, onAccount: moneyVouchers.onAccount })
      .from(moneyVouchers)
      .innerJoin(documents, eq(documents.id, moneyVouchers.id))
      .where(and(eq(moneyVouchers.kind, kind), eq(moneyVouchers.partyId, partyId), eq(documents.status, 'approved'), sql`${moneyVouchers.onAccount} > 0`))
      .orderBy(asc(documents.docDate));
  }

  private async settle(tx: Transaction, docType: string, billId: string, amount: Decimal) {
    if (docType === 'sales_invoice') await tx.update(salesInvoices).set({ receivedAmount: sql`${salesInvoices.receivedAmount} + ${amount.toFixed(2)}::numeric` }).where(eq(salesInvoices.id, billId));
    else await tx.update(purchaseInvoices).set({ paidAmount: sql`${purchaseInvoices.paidAmount} + ${amount.toFixed(2)}::numeric` }).where(eq(purchaseInvoices.id, billId));
  }

  // ---- preparation and posting -------------------------------------------------------------

  private async defaultCompany(tx: Transaction) {
    const [c] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
    if (!c) fail([{ path: 'companyId', message: 'No company found' }]);
    return c.id;
  }

  private async prepare(tx: Transaction, auth: AuthContext, companyId: string, input: MoneyInput, _selfId: string | null, opts: { writeOff?: boolean } = {}) {
    await this.ledger.ensureBooks(tx, auth.tenantId, companyId, auth.userId);
    const errors: Err[] = [];
    const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.companyId, companyId)));
    if (!acc) fail([{ path: 'accountId', message: 'Choose a bank or cash account of this company' }]);
    if (!opts.writeOff && acc.accountType !== 'bank' && acc.accountType !== 'cash') errors.push({ path: 'accountId', message: `${acc.name} is not a bank or cash account` });
    const [counter] = input.counterAccountId ? await tx.select().from(accounts).where(and(eq(accounts.id, input.counterAccountId), eq(accounts.companyId, companyId))) : [];
    if (input.counterAccountId && !counter) errors.push({ path: 'counterAccountId', message: 'Account not found' });
    if (counter?.isGroup) errors.push({ path: 'counterAccountId', message: `${counter.name} is a group` });
    if (counter?.isControl) errors.push({ path: 'counterAccountId', message: 'Choose the customer / vendor instead of the control account' });
    if (counter && !counter.allowManual) errors.push({ path: 'counterAccountId', message: `${counter.name} is posted only by documents` });
    if (input.kind === 'contra') {
      if (input.partyId) errors.push({ path: 'partyId', message: 'A contra entry moves money between your own accounts' });
      if (!counter || (counter.accountType !== 'bank' && counter.accountType !== 'cash')) errors.push({ path: 'counterAccountId', message: 'Choose the bank / cash account the money goes to' });
      if (counter && counter.id === acc.id) errors.push({ path: 'counterAccountId', message: 'Choose a different account' });
    } else if (!!input.partyId === !!counter) {
      errors.push({ path: 'partyId', message: 'Choose the customer / vendor, or the account it is for (not both)' });
    }
    const [party] = input.partyId ? await tx.select({ id: parties.id, name: parties.name }).from(parties).where(eq(parties.id, input.partyId)) : [];
    if (input.partyId && !party) errors.push({ path: 'partyId', message: 'Party not found' });
    const amount = D(input.amount);
    const charges = D(input.bankCharges ?? '0');
    const tds = input.kind === 'receipt' ? D(input.tdsDeducted ?? '0') : ZERO;
    const settled = input.kind === 'receipt' ? amount.add(charges).add(tds) : amount;
    const allocations: { againstDocId: string; amount: string }[] = [];
    if (party) {
      const side = input.kind === 'receipt' ? 'receivable' : 'payable';
      const bills = await this.openBills(tx, side, party.id);
      // Bills this voucher already settles (editing a draft): their open amount is as before.
      let left = settled;
      for (const [i, a] of input.allocations.entries()) {
        const bill = bills.find((b) => b.id === a.againstDocId) ?? (await this.openBills(tx, side, party.id, [a.againstDocId]))[0];
        if (!bill) {
          errors.push({ path: `allocations.${i}.againstDocId`, message: `Bill ${i + 1} is not an open bill of ${party.name}` });
          continue;
        }
        if (D(a.amount).cmp(D(bill.outstanding)) > 0) errors.push({ path: `allocations.${i}.amount`, message: `Only ₹${bill.outstanding} is outstanding on ${bill.number}` });
        left = left.sub(D(a.amount));
        allocations.push({ againstDocId: bill.id, amount: D(a.amount).toFixed(2) });
      }
      if (left.isNegative()) errors.push({ path: 'allocations', message: `Bills settled (₹${settled.sub(left).toFixed(2)}) exceed the amount (₹${settled.toFixed(2)})` });
      if (input.autoAllocate && !left.isNegative()) {
        for (const b of bills) {
          if (left.isZero()) break;
          if (allocations.some((x) => x.againstDocId === b.id)) continue;
          const take = D(b.outstanding).cmp(left) > 0 ? left : D(b.outstanding);
          allocations.push({ againstDocId: b.id, amount: take.toFixed(2) });
          left = left.sub(take);
        }
      }
    } else if (input.allocations.length) errors.push({ path: 'allocations', message: 'Bills can be settled only with a customer / vendor' });
    if (input.mode === 'cheque' && !input.instrumentNo) errors.push({ path: 'instrumentNo', message: 'Give the cheque number' });
    if (errors.length) fail(errors);
    const allocated = allocations.reduce((s, a) => s.add(D(a.amount)), ZERO);
    const label = input.kind === 'receipt' ? 'From' : input.kind === 'payment' ? 'To' : 'To';
    return {
      title: `${label} ${party?.name ?? counter?.name ?? ''}`.trim(),
      header: {
        kind: input.kind,
        partyId: party?.id ?? null,
        accountId: acc.id,
        counterAccountId: counter?.id ?? null,
        mode: input.mode,
        instrumentNo: input.instrumentNo,
        instrumentDate: input.instrumentDate ?? null,
        chequeStatus: input.mode === 'cheque' ? 'pending' : null,
        amount: amount.toFixed(2),
        bankCharges: charges.toFixed(2),
        tdsDeducted: tds.toFixed(2),
        settledAmount: settled.toFixed(2),
        onAccount: party ? settled.sub(allocated).toFixed(2) : '0',
        reference: input.reference,
        narration: input.narration,
      },
      allocations,
    };
  }

  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [mv] = await tx.select().from(moneyVouchers).where(eq(moneyVouchers.id, doc.id));
    const allocs = await tx.select().from(moneyAllocations).where(and(eq(moneyAllocations.voucherId, doc.id), isNull(moneyAllocations.adjustmentId)));
    // Re-check what is open now (another voucher may have settled the bill meanwhile).
    if (mv.partyId) {
      const side = mv.kind === 'receipt' ? 'receivable' : 'payable';
      const bills = await this.openBills(tx, side, mv.partyId, allocs.map((a) => a.againstDocId));
      for (const a of allocs) {
        const b = bills.find((x) => x.id === a.againstDocId);
        if (!b || D(a.amount).cmp(D(b.outstanding)) > 0) throw new ConflictException(`Only ₹${b?.outstanding ?? '0.00'} is now outstanding on ${b?.number ?? 'a bill'}. Edit the allocation.`);
      }
    }
    const v = { id: doc.id, type: doc.docType, number: doc.number, companyId: doc.companyId, branchId: doc.branchId, postingDate: doc.docDate };
    const bank = { id: mv.accountId };
    const lines: GlLine[] = [];
    const narration = mv.narration ?? (mv.instrumentNo ? `${mv.mode.toUpperCase()} ${mv.instrumentNo}` : null);
    if (mv.kind === 'receipt') {
      lines.push({ account: bank, debit: mv.amount, narration }, { account: 'bank_charges', debit: mv.bankCharges }, { account: 'tds_receivable', debit: mv.tdsDeducted });
      if (mv.partyId) {
        for (const a of allocs) lines.push({ account: 'receivable', credit: a.amount, partyId: mv.partyId, againstVoucherId: a.againstDocId, narration });
        lines.push({ account: 'receivable', credit: mv.onAccount, partyId: mv.partyId, againstVoucherId: doc.id, narration: 'On account (advance)' });
      } else lines.push({ account: { id: mv.counterAccountId! }, credit: mv.settledAmount, narration });
    } else {
      const to: GlLine[] = mv.partyId
        ? [...allocs.map((a) => ({ account: 'payable' as const, debit: a.amount, partyId: mv.partyId, againstVoucherId: a.againstDocId, narration })), { account: 'payable', debit: mv.onAccount, partyId: mv.partyId, againstVoucherId: doc.id, narration: 'On account (advance)' }]
        : [{ account: { id: mv.counterAccountId! }, debit: mv.amount, narration }];
      lines.push(...to, { account: bank, credit: D(mv.amount).add(D(mv.bankCharges)), narration }, { account: 'bank_charges', debit: mv.bankCharges });
    }
    await this.ledger.post(tx, auth, v, lines);
    for (const a of allocs) await this.settle(tx, mv.kind === 'receipt' ? 'sales_invoice' : 'purchase_invoice', a.againstDocId, D(a.amount));
  }

  private async unpost(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [adj] = await tx.select({ n: sql<number>`count(*)::int` }).from(moneyAllocations).innerJoin(documents, eq(documents.id, moneyAllocations.adjustmentId)).where(and(eq(moneyAllocations.voucherId, doc.id), sql`${documents.status} <> 'cancelled'`));
    if (adj.n) throw new ConflictException('Part of this advance was adjusted against bills. Cancel those adjustment journals first.');
    const [mv] = await tx.select().from(moneyVouchers).where(eq(moneyVouchers.id, doc.id));
    const allocs = await tx.select().from(moneyAllocations).where(and(eq(moneyAllocations.voucherId, doc.id), isNull(moneyAllocations.adjustmentId)));
    await this.ledger.reverse(tx, auth, doc.id);
    for (const a of allocs) await this.settle(tx, mv.kind === 'receipt' ? 'sales_invoice' : 'purchase_invoice', a.againstDocId, ZERO.sub(D(a.amount)));
  }

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('accounting.money.manage'), cancel: perms.has('accounting.money.cancel') });
    const [mv] = await tx.select().from(moneyVouchers).where(eq(moneyVouchers.id, doc.id));
    const accs = await tx.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(inArray(accounts.id, [mv.accountId, mv.counterAccountId].filter((v): v is string => !!v)));
    const [party] = mv.partyId ? await tx.select({ id: parties.id, code: parties.code, name: parties.name }).from(parties).where(eq(parties.id, mv.partyId)) : [];
    const allocs = await tx
      .select({ id: moneyAllocations.id, againstDocId: moneyAllocations.againstDocId, amount: moneyAllocations.amount, adjustmentId: moneyAllocations.adjustmentId, number: documents.number, docType: documents.docType, docDate: documents.docDate })
      .from(moneyAllocations)
      .innerJoin(documents, eq(documents.id, moneyAllocations.againstDocId))
      .where(eq(moneyAllocations.voucherId, doc.id))
      .orderBy(asc(moneyAllocations.createdAt));
    const { tenantId: _t, id: _i, ...rest } = mv;
    return {
      ...header,
      ...rest,
      party: party ?? null,
      account: accs.find((a) => a.id === mv.accountId) ?? null,
      counterAccount: accs.find((a) => a.id === mv.counterAccountId) ?? null,
      allocations: allocs,
      canAdjust: doc.status === 'approved' && D(mv.onAccount).cmp(ZERO) > 0 && perms.has('accounting.money.manage'),
      canCheque: doc.status === 'approved' && mv.chequeStatus === 'pending' && perms.has('accounting.money.cancel'),
    };
  }
}
