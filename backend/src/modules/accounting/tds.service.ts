import { BadRequestException, Injectable } from '@nestjs/common';
import { accounts, documents, parties, purchaseInvoices, tdsChallans } from '@nextgen/database';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { TDS_SECTIONS } from '../gst/tds';
import { toCsv } from '../compliance/gst-reports.service';
import { AccountsService } from './accounts.service';
import { MoneyService } from './money.service';

const D = Decimal.from;
const ZERO = D('0');

export const quarterSchema = z.object({
  companyId: z.uuid().optional(),
  /** Financial year start, e.g. 2026 for 2026-27. */
  fy: z.coerce.number().int().min(2017).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
  form: z.enum(['26Q', '27Q']).default('26Q'),
  format: z.enum(['json', 'csv']).default('json'),
});
export const challanSchema = z.object({
  companyId: z.uuid().optional(),
  accountId: z.uuid(),
  section: z.string().refine((v) => v in TDS_SECTIONS, 'Unknown TDS section'),
  fy: z.coerce.number().int(),
  quarter: z.coerce.number().int().min(1).max(4),
  amount: z.union([z.string(), z.number()]).transform((v) => String(v)),
  interest: z.union([z.string(), z.number()]).transform((v) => String(v)).default('0'),
  lateFee: z.union([z.string(), z.number()]).transform((v) => String(v)).default('0'),
  bsrCode: z.string().regex(/^\d{7}$/, 'BSR code is 7 digits'),
  challanSerial: z.string().regex(/^\d{1,5}$/, 'Challan serial number (up to 5 digits)'),
  depositDate: z.iso.date(),
});

/** FY quarter → date range. Q1 Apr–Jun … Q4 Jan–Mar. */
export function quarterRange(fy: number, q: number) {
  const starts = [`${fy}-04-01`, `${fy}-07-01`, `${fy}-10-01`, `${fy + 1}-01-01`];
  const ends = [`${fy}-06-30`, `${fy}-09-30`, `${fy}-12-31`, `${fy + 1}-03-31`];
  return { from: starts[q - 1], to: ends[q - 1], label: `${fy}-${String((fy + 1) % 100).padStart(2, '0')} Q${q}` };
}

/**
 * TDS: deductions on vendor bills by quarter and section (26Q residents, 27Q non-residents),
 * challans deposited, the balance still to deposit, and Form 16A data per deductee.
 */
@Injectable()
export class TdsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly money: MoneyService,
    private readonly accountsSvc: AccountsService,
  ) {}

  quarter(auth: AuthContext, q: z.infer<typeof quarterSchema>) {
    const r = quarterRange(q.fy, q.quarter);
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, q.companyId);
      const rows = await tx
        .select({
          billId: documents.id,
          number: documents.number,
          date: documents.docDate,
          vendorId: parties.id,
          vendor: parties.name,
          pan: parties.pan,
          registration: purchaseInvoices.vendorRegistration,
          section: purchaseInvoices.tdsSection,
          rate: purchaseInvoices.tdsRate,
          base: purchaseInvoices.taxableTotal,
          tds: purchaseInvoices.tdsAmount,
          supplierInvoiceNo: purchaseInvoices.supplierInvoiceNo,
        })
        .from(purchaseInvoices)
        .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
        .innerJoin(parties, eq(parties.id, purchaseInvoices.vendorId))
        .where(and(eq(documents.companyId, companyId), inArray(documents.status, ['approved', 'completed']), gte(documents.docDate, r.from), lte(documents.docDate, r.to), sql`${purchaseInvoices.tdsAmount} > 0`))
        .orderBy(asc(purchaseInvoices.tdsSection), asc(documents.docDate));
      const deductions = rows.filter((x) => (q.form === '27Q' ? x.registration === 'overseas' : x.registration !== 'overseas'));
      const challans = await tx
        .select({ voucherId: tdsChallans.voucherId, section: tdsChallans.section, bsrCode: tdsChallans.bsrCode, challanSerial: tdsChallans.challanSerial, depositDate: tdsChallans.depositDate, amount: tdsChallans.amount, interest: tdsChallans.interest, lateFee: tdsChallans.lateFee, number: documents.number, status: documents.status })
        .from(tdsChallans)
        .innerJoin(documents, eq(documents.id, tdsChallans.voucherId))
        .where(and(eq(documents.companyId, companyId), eq(tdsChallans.quarter, r.label), eq(documents.status, 'approved')))
        .orderBy(asc(tdsChallans.depositDate));
      const sections = [...new Set([...deductions.map((d) => d.section ?? ''), ...challans.map((c) => c.section)])].sort();
      const bySection = sections.map((s) => {
        const ded = deductions.filter((d) => d.section === s).reduce((t, d) => t.add(D(d.tds)), ZERO);
        const dep = challans.filter((c) => c.section === s).reduce((t, c) => t.add(D(c.amount)), ZERO);
        return { section: s, label: TDS_SECTIONS[s]?.label ?? s, deducted: ded.toFixed(2), deposited: dep.toFixed(2), balance: ded.sub(dep).toFixed(2), deductees: new Set(deductions.filter((d) => d.section === s).map((d) => d.vendorId)).size };
      });
      // Deposit due: 7th of the next month (30 April for March).
      const missingPan = deductions.filter((d) => !d.pan);
      return {
        quarter: r.label,
        form: q.form,
        from: r.from,
        to: r.to,
        sections: bySection,
        deductions: deductions.map((d) => ({ ...d, panStatus: d.pan ? 'ok' : 'missing (TDS at 20% under s.206AA)' })),
        challans,
        warnings: missingPan.length ? [`${new Set(missingPan.map((d) => d.vendor)).size} deductee(s) without PAN: their returns will be rejected or taxed at 20%`] : [],
      };
    });
  }

  quarterCsv(data: Awaited<ReturnType<TdsService['quarter']>>) {
    return toCsv(
      ['Section', 'Deductee name', 'PAN', 'Bill', 'Supplier invoice', 'Date of credit', 'Amount paid / credited', 'TDS rate %', 'TDS deducted'],
      data.deductions.map((d) => [d.section, d.vendor, d.pan ?? 'PANNOTAVBL', d.number, d.supplierInvoiceNo, d.date, d.base, d.rate, d.tds]),
    );
  }

  /** Records a TDS deposit: a payment from the bank against TDS payable, with the challan details. */
  challan(auth: AuthContext, input: z.infer<typeof challanSchema>, meta: RequestMeta) {
    const r = quarterRange(input.fy, input.quarter);
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, input.companyId);
      const [tdsAcc] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.systemKey, 'tds_payable')));
      if (!tdsAcc) throw new BadRequestException('The chart of accounts has no TDS payable account');
      const total = D(input.amount).add(D(input.interest)).add(D(input.lateFee));
      // Interest and late fee are expenses, not TDS: the voucher pays the TDS; the rest goes to interest expense by journal later.
      const v = await this.money.createTx(
        tx,
        auth,
        { kind: 'payment', companyId, docDate: input.depositDate, accountId: input.accountId, counterAccountId: tdsAcc.id, partyId: null, mode: 'neft', amount: D(input.amount).toFixed(2), bankCharges: null, tdsDeducted: null, allocations: [], autoAllocate: false, reference: `BSR ${input.bsrCode} / ${input.challanSerial}`, narration: `TDS ${input.section} for ${r.label} (challan ${input.challanSerial})`, instrumentNo: null },
        meta,
      );
      await tx.insert(tdsChallans).values({ voucherId: v.id, tenantId: auth.tenantId, section: input.section, quarter: r.label, bsrCode: input.bsrCode, challanSerial: input.challanSerial, depositDate: input.depositDate, amount: D(input.amount).toFixed(2), interest: D(input.interest).toFixed(2), lateFee: D(input.lateFee).toFixed(2) });
      await this.documents.submit(tx, auth, await this.documents.find(tx, v.id, 'payment'), meta);
      return { voucherId: v.id, total: total.toFixed(2) };
    });
  }

  /** Form 16A data: one certificate per deductee for the quarter. */
  async form16a(auth: AuthContext, q: z.infer<typeof quarterSchema>, vendorId: string) {
    const data = await this.quarter(auth, q);
    const ded = data.deductions.filter((d) => d.vendorId === vendorId);
    if (!ded.length) throw new BadRequestException('No TDS was deducted for this vendor in the quarter');
    const sections = [...new Set(ded.map((d) => d.section))];
    return {
      quarter: data.quarter,
      deductee: { id: vendorId, name: ded[0].vendor, pan: ded[0].pan },
      amountPaid: ded.reduce((s, d) => s.add(D(d.base)), ZERO).toFixed(2),
      tdsDeducted: ded.reduce((s, d) => s.add(D(d.tds)), ZERO).toFixed(2),
      transactions: ded,
      challans: data.challans.filter((c) => sections.includes(c.section)),
    };
  }
}
