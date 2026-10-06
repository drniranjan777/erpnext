import { BadRequestException, Injectable } from '@nestjs/common';
import { accounts, companies, documents, moneyVouchers, parties, partyBankAccounts, purchaseInvoices, salesInvoices } from '@nextgen/database';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toCsv } from '../compliance/gst-reports.service';
import { AccountsService } from './accounts.service';
import { MoneyService } from './money.service';

const D = Decimal.from;
const ZERO = D('0');
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export const ageingSchema = z.object({
  side: z.enum(['receivable', 'payable']).default('receivable'),
  asOf: z.iso.date().optional(),
  /** Bucket edges in days overdue, e.g. "30,60,90". */
  buckets: z
    .string()
    .regex(/^\d{1,3}(,\d{1,3}){0,6}$/)
    .default('30,60,90')
    .transform((v) => [...new Set(v.split(',').map(Number))].sort((a, b) => a - b)),
});
export const interestSchema = z.object({ ratePct: z.coerce.number().min(0).max(48).default(18), asOf: z.iso.date().optional(), partyId: z.uuid().optional() });
export const dunningSchema = z.object({ partyIds: z.array(z.uuid()).max(500).optional(), minDaysOverdue: z.number().int().min(0).max(3650).default(1) });
export const proposalSchema = z.object({ dueBy: z.iso.date().optional() });
export const paymentRunSchema = z.object({
  companyId: z.uuid().optional(),
  accountId: z.uuid(),
  docDate: z.iso.date().optional(),
  mode: z.enum(['neft', 'rtgs', 'imps']).default('neft'),
  items: z.array(z.object({ billId: z.uuid(), amount: z.union([z.string(), z.number()]).transform((v) => String(v)) })).min(1).max(500),
});
export const bankFileSchema = z.object({ ids: z.string().transform((v) => v.split(',').filter(Boolean)), format: z.enum(['generic', 'hdfc']).default('generic') });

/**
 * Receivables and payables: bill-wise ageing, statements, interest on overdue bills, payment
 * reminders, payment proposals by due date (MSME first) and payment runs with a bank file.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly money: MoneyService,
    private readonly accounts: AccountsService,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
  ) {}

  /** Party-wise outstanding aged by days past due, with unadjusted advances. */
  ageing(auth: AuthContext, q: z.infer<typeof ageingSchema>) {
    return this.database.run(auth, async (tx) => {
      const asOf = q.asOf ?? todayIST();
      const rows =
        q.side === 'receivable'
          ? await tx
              .select({ partyId: salesInvoices.customerId, docDate: documents.docDate, dueDate: salesInvoices.dueDate, outstanding: sql<string>`(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount})::text` })
              .from(salesInvoices)
              .innerJoin(documents, eq(documents.id, salesInvoices.id))
              .where(and(inArray(documents.status, ['approved', 'completed']), sql`${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount} > 0`))
          : await tx
              .select({ partyId: purchaseInvoices.vendorId, docDate: documents.docDate, dueDate: purchaseInvoices.dueDate, outstanding: sql<string>`(${purchaseInvoices.netPayable} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.debitedAmount})::text` })
              .from(purchaseInvoices)
              .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
              .where(and(inArray(documents.status, ['approved', 'completed']), sql`${purchaseInvoices.netPayable} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.debitedAmount} > 0`));
      const adv = await tx
        .select({ partyId: moneyVouchers.partyId, onAccount: sql<string>`sum(${moneyVouchers.onAccount})::text` })
        .from(moneyVouchers)
        .innerJoin(documents, eq(documents.id, moneyVouchers.id))
        .where(and(eq(moneyVouchers.kind, q.side === 'receivable' ? 'receipt' : 'payment'), eq(documents.status, 'approved'), sql`${moneyVouchers.onAccount} > 0`))
        .groupBy(moneyVouchers.partyId);
      const labels = ['Not due', ...q.buckets.map((b, i) => `${i ? q.buckets[i - 1] + 1 : 1}–${b}`), `Over ${q.buckets[q.buckets.length - 1]}`];
      const byParty = new Map<string, { buckets: Decimal[]; total: Decimal; bills: number; advance: Decimal; oldestDue: string | null }>();
      const entry = (id: string) => byParty.get(id) ?? { buckets: labels.map(() => ZERO), total: ZERO, bills: 0, advance: ZERO, oldestDue: null };
      for (const r of rows) {
        const due = r.dueDate ?? r.docDate;
        const days = due < asOf ? Math.round((Date.parse(asOf) - Date.parse(due)) / 86_400_000) : 0;
        const idx = days <= 0 ? 0 : q.buckets.findIndex((b) => days <= b) + 1 || labels.length - 1;
        const e = entry(r.partyId);
        e.buckets[idx] = e.buckets[idx].add(D(r.outstanding));
        e.total = e.total.add(D(r.outstanding));
        e.bills++;
        e.oldestDue = !e.oldestDue || due < e.oldestDue ? due : e.oldestDue;
        byParty.set(r.partyId, e);
      }
      for (const a of adv) {
        if (!a.partyId) continue;
        const e = entry(a.partyId);
        e.advance = D(a.onAccount);
        byParty.set(a.partyId, e);
      }
      const names = byParty.size ? await tx.select({ id: parties.id, code: parties.code, name: parties.name, msme: parties.msmeCategory, creditLimit: parties.creditLimit }).from(parties).where(inArray(parties.id, [...byParty.keys()])) : [];
      const out = [...byParty.entries()]
        .map(([id, e]) => {
          const p = names.find((x) => x.id === id);
          return { partyId: id, code: p?.code ?? '', name: p?.name ?? '', msme: p?.msme ?? null, creditLimit: p?.creditLimit ?? null, bills: e.bills, oldestDue: e.oldestDue, buckets: e.buckets.map((b) => b.toFixed(2)), total: e.total.toFixed(2), advance: e.advance.toFixed(2), net: e.total.sub(e.advance).toFixed(2) };
        })
        .sort((x, y) => Number(y.total) - Number(x.total));
      const totals = { buckets: labels.map((_, i) => out.reduce((s, r) => s.add(D(r.buckets[i])), ZERO).toFixed(2)), total: out.reduce((s, r) => s.add(D(r.total)), ZERO).toFixed(2), advance: out.reduce((s, r) => s.add(D(r.advance)), ZERO).toFixed(2) };
      return { side: q.side, asOf, labels, parties: out, totals };
    });
  }

  /** Statement of account: ledger of the party, open bills and unadjusted advances. */
  statement(auth: AuthContext, partyId: string, from?: string, to?: string) {
    return this.accounts.accountLedger(auth, { partyId, from, to, limit: 5000 }).then((ledger) =>
      this.database.run(auth, async (tx) => {
        const [p] = await tx.select().from(parties).where(eq(parties.id, partyId));
        const [company] = await tx.select({ name: companies.name, legalName: companies.legalName, gstin: companies.gstin, address: companies.address }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
        const receivable = p.isCustomer ? await this.money.openBills(tx, 'receivable', partyId) : [];
        const payable = p.isVendor ? await this.money.openBills(tx, 'payable', partyId) : [];
        const advances = [...(p.isCustomer ? await this.money.advances(tx, 'receipt', partyId) : []), ...(p.isVendor ? await this.money.advances(tx, 'payment', partyId) : [])];
        return { company, party: { id: p.id, code: p.code, name: p.name, gstin: p.gstin, email: p.email }, from: from ?? null, to: to ?? todayIST(), ledger, openBills: [...receivable, ...payable], advances };
      }),
    );
  }

  /** Interest on overdue receivables at a yearly rate, simple interest from the due date. */
  interest(auth: AuthContext, q: z.infer<typeof interestSchema>) {
    return this.database.run(auth, async (tx) => {
      const asOf = q.asOf ?? todayIST();
      const rows = await tx
        .select({ id: documents.id, number: documents.number, docDate: documents.docDate, dueDate: salesInvoices.dueDate, partyId: salesInvoices.customerId, party: parties.name, outstanding: sql<string>`(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount})::text` })
        .from(salesInvoices)
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .innerJoin(parties, eq(parties.id, salesInvoices.customerId))
        .where(and(inArray(documents.status, ['approved', 'completed']), sql`${salesInvoices.dueDate} < ${asOf}`, sql`${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount} > 0`, q.partyId ? eq(salesInvoices.customerId, q.partyId) : undefined))
        .orderBy(asc(salesInvoices.dueDate));
      const rate = D(String(q.ratePct));
      const bills = rows.map((r) => {
        const days = Math.round((Date.parse(asOf) - Date.parse(r.dueDate!)) / 86_400_000);
        return { ...r, days, interest: D(r.outstanding).mul(rate).mul(D(String(days))).div(D('36500')).toFixed(2) };
      });
      return { asOf, ratePct: q.ratePct, bills, total: bills.reduce((s, b) => s.add(D(b.interest)), ZERO).toFixed(2) };
    });
  }

  /** Emails each customer with overdue invoices a reminder listing them. */
  dunning(auth: AuthContext, q: z.infer<typeof dunningSchema>) {
    return this.database.run(auth, async (tx) => {
      const today = todayIST();
      const cutoff = new Date(Date.parse(today) - q.minDaysOverdue * 86_400_000).toISOString().slice(0, 10);
      const rows = await tx
        .select({ number: documents.number, docDate: documents.docDate, dueDate: salesInvoices.dueDate, partyId: salesInvoices.customerId, outstanding: sql<string>`(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount})::text` })
        .from(salesInvoices)
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .where(and(inArray(documents.status, ['approved', 'completed']), sql`${salesInvoices.dueDate} <= ${cutoff}`, sql`${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount} > 0`, q.partyIds?.length ? inArray(salesInvoices.customerId, q.partyIds) : undefined))
        .orderBy(asc(salesInvoices.dueDate));
      const byParty = new Map<string, typeof rows>();
      for (const r of rows) byParty.set(r.partyId, [...(byParty.get(r.partyId) ?? []), r]);
      const ps = byParty.size ? await tx.select({ id: parties.id, name: parties.name, email: parties.email }).from(parties).where(inArray(parties.id, [...byParty.keys()])) : [];
      const [company] = await tx.select({ name: companies.name }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
      const sent: string[] = [];
      const skipped: { partyId: string; name: string; reason: string }[] = [];
      for (const [partyId, bills] of byParty) {
        const p = ps.find((x) => x.id === partyId)!;
        if (!p.email) {
          skipped.push({ partyId, name: p.name, reason: 'No email address' });
          continue;
        }
        const total = bills.reduce((s, b) => s.add(D(b.outstanding)), ZERO);
        await this.notifications.notify(tx, auth.tenantId, 'accounting.payment_reminder', [{ email: p.email, name: p.name }], {
          companyName: company?.name ?? '',
          customerName: p.name,
          total: inr.format(Number(total.toFixed(2))),
          lines: bills.map((b) => `• ${b.number} dated ${b.docDate}, due ${b.dueDate}: ${inr.format(Number(b.outstanding))}`).join('\n'),
          contact: 'Please reply to this email with any questions.',
        });
        sent.push(partyId);
      }
      return { sent: sent.length, skipped };
    });
  }

  /** Bills to pay by a date: MSME micro / small vendors first (45-day rule), then by due date. */
  proposal(auth: AuthContext, q: z.infer<typeof proposalSchema>) {
    return this.database.run(auth, async (tx) => {
      const dueBy = q.dueBy ?? todayIST();
      const outstanding = sql<string>`(${purchaseInvoices.netPayable} - ${purchaseInvoices.paidAmount} - ${purchaseInvoices.debitedAmount})`;
      const rows = await tx
        .select({
          billId: documents.id,
          number: documents.number,
          docDate: documents.docDate,
          supplierInvoiceNo: purchaseInvoices.supplierInvoiceNo,
          dueDate: purchaseInvoices.dueDate,
          vendorId: purchaseInvoices.vendorId,
          vendor: parties.name,
          msme: purchaseInvoices.vendorMsme,
          outstanding: sql<string>`${outstanding}::numeric(18,2)::text`,
          hasBank: sql<boolean>`exists (select 1 from ${partyBankAccounts} b where b.party_id = ${purchaseInvoices.vendorId})`,
        })
        .from(purchaseInvoices)
        .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
        .innerJoin(parties, eq(parties.id, purchaseInvoices.vendorId))
        .where(and(inArray(documents.status, ['approved', 'completed']), sql`${outstanding} > 0`, sql`coalesce(${purchaseInvoices.dueDate}, ${documents.docDate}) <= ${dueBy}`))
        .orderBy(sql`case when ${purchaseInvoices.vendorMsme} in ('micro', 'small') then 0 else 1 end`, asc(purchaseInvoices.dueDate));
      const today = todayIST();
      return { dueBy, bills: rows.map((r) => ({ ...r, overdueDays: r.dueDate && r.dueDate < today ? Math.round((Date.parse(today) - Date.parse(r.dueDate)) / 86_400_000) : 0 })), total: rows.reduce((s, r) => s.add(D(r.outstanding)), ZERO).toFixed(2) };
    });
  }

  /** One payment per vendor for the chosen bills, posted, ready for the bank file. */
  async paymentRun(auth: AuthContext, input: z.infer<typeof paymentRunSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const bills = await tx.select({ id: purchaseInvoices.id, vendorId: purchaseInvoices.vendorId }).from(purchaseInvoices).where(inArray(purchaseInvoices.id, input.items.map((i) => i.billId)));
      if (bills.length !== new Set(input.items.map((i) => i.billId)).size) throw new BadRequestException('Some bills were not found');
      const byVendor = new Map<string, { againstDocId: string; amount: string }[]>();
      for (const it of input.items) {
        const b = bills.find((x) => x.id === it.billId)!;
        byVendor.set(b.vendorId, [...(byVendor.get(b.vendorId) ?? []), { againstDocId: it.billId, amount: D(it.amount).toFixed(2) }]);
      }
      const ids: string[] = [];
      for (const [vendorId, allocations] of byVendor) {
        const amount = allocations.reduce((s, a) => s.add(D(a.amount)), ZERO).toFixed(2);
        const v = await this.money.createTx(tx, auth, { kind: 'payment', companyId: input.companyId, docDate: input.docDate, partyId: vendorId, accountId: input.accountId, mode: input.mode, amount, allocations, autoAllocate: false, bankCharges: null, tdsDeducted: null, reference: 'Payment run', narration: null, instrumentNo: null }, meta);
        await this.documents.submit(tx, auth, await this.documents.find(tx, v.id, 'payment'), meta);
        ids.push(v.id);
      }
      return { payments: ids.length, ids };
    });
  }

  /** NEFT / RTGS upload file for posted payments (generic CSV, or HDFC ENet column order). */
  bankFile(auth: AuthContext, ids: string[], format: 'generic' | 'hdfc') {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({ id: documents.id, number: documents.number, docDate: documents.docDate, status: documents.status, amount: moneyVouchers.amount, mode: moneyVouchers.mode, partyId: moneyVouchers.partyId, vendor: parties.name, email: parties.email, debitAccount: accounts.name })
        .from(moneyVouchers)
        .innerJoin(documents, eq(documents.id, moneyVouchers.id))
        .innerJoin(accounts, eq(accounts.id, moneyVouchers.accountId))
        .leftJoin(parties, eq(parties.id, moneyVouchers.partyId))
        .where(and(inArray(documents.id, ids), eq(moneyVouchers.kind, 'payment')))
        .orderBy(asc(documents.number));
      const missing: string[] = [];
      const lines: unknown[][] = [];
      for (const r of rows) {
        if (r.status !== 'approved') continue;
        const [bank] = r.partyId ? await tx.select().from(partyBankAccounts).where(eq(partyBankAccounts.partyId, r.partyId)).orderBy(desc(partyBankAccounts.isPrimary)).limit(1) : [];
        if (!bank) {
          missing.push(r.vendor ?? r.number ?? r.id);
          continue;
        }
        const accountNo = this.crypto.decrypt(bank.accountNumberEncrypted);
        const type = r.mode === 'rtgs' || (r.mode !== 'imps' && D(r.amount).cmp(D('200000')) >= 0) ? 'RTGS' : r.mode === 'imps' ? 'IMPS' : 'NEFT';
        lines.push(
          format === 'hdfc'
            ? [type === 'RTGS' ? 'R' : type === 'IMPS' ? 'I' : 'N', '', accountNo, D(r.amount).toFixed(2), bank.accountName, '', '', '', '', '', '', '', '', r.number, '', '', '', '', '', '', '', r.docDate.split('-').reverse().join('/'), '', bank.ifsc, bank.bankName ?? '', '', r.email ?? '']
            : [type, bank.accountName, accountNo, bank.ifsc, bank.bankName ?? '', D(r.amount).toFixed(2), r.number, r.docDate, r.email ?? '', r.debitAccount],
        );
      }
      if (missing.length) throw new BadRequestException(`No bank account on file for: ${missing.join(', ')}. Add it to the vendor first.`);
      const csv =
        format === 'hdfc'
          ? lines.map((l) => l.map((c) => String(c).replace(/,/g, ' ')).join(',')).join('\r\n') + '\r\n'
          : toCsv(['Payment type', 'Beneficiary name', 'Account number', 'IFSC', 'Bank', 'Amount', 'Reference', 'Value date', 'Email', 'Debit account'], lines);
      return { fileName: `payments_${format}_${todayIST()}.csv`, csv, count: lines.length };
    });
  }
}
