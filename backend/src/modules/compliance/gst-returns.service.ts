import { BadRequestException, Injectable } from '@nestjs/common';
import {
  accounts,
  billsOfEntry,
  companies,
  creditNoteLines,
  creditNotes,
  debitNoteLines,
  debitNotes,
  documents,
  glEntries,
  gstr2bImports,
  gstr2bLines,
  parties,
  purchaseInvoiceLines,
  purchaseInvoices,
  salesInvoiceLines,
  salesInvoices,
  type Transaction,
} from '@nextgen/database';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { ownGstRegistration } from '../gst/pricing';
import { computeSetOff, normaliseInvoiceNo, type Heads } from './gst-setoff';
import { GstReportsService } from './gst-reports.service';

const D = Decimal.from;
const ZERO = D('0');
const n2 = (d: Decimal) => Number(d.toFixed(2));
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const POSTED = ['approved', 'completed'] as const;
/** B2C inter-state invoices above this go to B2CL (since 1 Aug 2024). */
const B2CL_LIMIT = D('100000');

export const periodSchema = z.object({ companyId: z.uuid().optional(), period: z.string().regex(/^\d{4}-\d{2}$/, 'Period as YYYY-MM') });
export const actionSchema = z.object({ action: z.enum(['accept', 'follow_up', 'defer']).nullable(), note: z.string().trim().max(300).nullable().optional() });

const bounds = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}`, fp: `${String(m).padStart(2, '0')}${y}` };
};

type TaxRow = { rate: string; taxable: string; igst: string; cgst: string; sgst: string; cess: string };
const itms = (rows: TaxRow[], sign = 1) => {
  const by = new Map<string, Heads & { txval: Decimal }>();
  for (const r of rows) {
    const k = String(Number(r.rate));
    const s = D(String(sign));
    const e = by.get(k) ?? { txval: ZERO, igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO };
    by.set(k, { txval: e.txval.add(D(r.taxable).mul(s)), igst: e.igst.add(D(r.igst).mul(s)), cgst: e.cgst.add(D(r.cgst).mul(s)), sgst: e.sgst.add(D(r.sgst).mul(s)), cess: e.cess.add(D(r.cess).mul(s)) });
  }
  return [...by.entries()].map(([rt, v], i) => ({ num: i + 1, itm_det: { rt: Number(rt), txval: n2(v.txval), iamt: n2(v.igst), camt: n2(v.cgst), samt: n2(v.sgst), csamt: n2(v.cess) } }));
};

/**
 * GST returns from posted documents: GSTR-1 (JSON for the offline tool / API), GSTR-3B with the
 * ITC set-off, the set-off journal, and GSTR-2B reconciliation against purchase bills.
 */
@Injectable()
export class GstReturnsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reports: GstReportsService,
  ) {}

  private async company(tx: Transaction, companyId?: string) {
    if (companyId) return companyId;
    const [c] = await tx.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
    return c.id;
  }

  // ---- GSTR-1 ----------------------------------------------------------------------

  gstr1(auth: AuthContext, q: z.infer<typeof periodSchema>) {
    const { from, to, fp } = bounds(q.period);
    return this.database.run(auth, async (tx) => {
      const companyId = await this.company(tx, q.companyId);
      const own = await ownGstRegistration(tx, companyId, null);
      if (!own.gstin) throw new BadRequestException('Add the company GSTIN first');
      const invs = await tx
        .select({ id: documents.id, number: documents.number, date: documents.docDate, ctin: salesInvoices.customerGstin, pos: salesInvoices.placeOfSupply, interState: salesInvoices.interState, taxKind: salesInvoices.taxKind, withLut: salesInvoices.withLut, rc: salesInvoices.reverseCharge, val: salesInvoices.grandTotal, registration: salesInvoices.customerRegistration })
        .from(salesInvoices)
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .where(and(eq(documents.companyId, companyId), inArray(documents.status, [...POSTED]), gte(documents.docDate, from), lte(documents.docDate, to)))
        .orderBy(asc(documents.docDate), asc(documents.number));
      const invLines = invs.length
        ? await tx
            .select({ docId: salesInvoiceLines.invoiceId, rate: salesInvoiceLines.gstRate, taxable: salesInvoiceLines.taxableValue, igst: salesInvoiceLines.igstAmount, cgst: salesInvoiceLines.cgstAmount, sgst: salesInvoiceLines.sgstAmount, cess: salesInvoiceLines.cessAmount, taxability: salesInvoiceLines.taxability })
            .from(salesInvoiceLines)
            .where(inArray(salesInvoiceLines.invoiceId, invs.map((i) => i.id)))
        : [];
      const cns = await tx
        .select({ id: documents.id, number: documents.number, date: documents.docDate, invoiceId: creditNotes.invoiceId, val: creditNotes.grandTotal, pos: creditNotes.placeOfSupply, rc: creditNotes.reverseCharge })
        .from(creditNotes)
        .innerJoin(documents, eq(documents.id, creditNotes.id))
        .where(and(eq(documents.companyId, companyId), inArray(documents.status, [...POSTED]), gte(documents.docDate, from), lte(documents.docDate, to)));
      const cnInv = cns.length ? await tx.select({ id: salesInvoices.id, ctin: salesInvoices.customerGstin, taxKind: salesInvoices.taxKind, withLut: salesInvoices.withLut, interState: salesInvoices.interState, val: salesInvoices.grandTotal }).from(salesInvoices).where(inArray(salesInvoices.id, cns.map((c) => c.invoiceId))) : [];
      const cnLines = cns.length
        ? await tx
            .select({ docId: creditNoteLines.creditNoteId, rate: creditNoteLines.gstRate, taxable: creditNoteLines.taxableValue, igst: creditNoteLines.igstAmount, cgst: creditNoteLines.cgstAmount, sgst: creditNoteLines.sgstAmount, cess: creditNoteLines.cessAmount })
            .from(creditNoteLines)
            .where(inArray(creditNoteLines.creditNoteId, cns.map((c) => c.id)))
        : [];
      const linesOf = (id: string) => invLines.filter((l) => l.docId === id && l.taxability !== 'exempt');
      const b2b = new Map<string, unknown[]>();
      const b2cl = new Map<string, unknown[]>();
      const b2cs = new Map<string, { sply_ty: string; pos: string; typ: string; rt: number; txval: Decimal; iamt: Decimal; camt: Decimal; samt: Decimal; csamt: Decimal }>();
      const exp: Record<'WPAY' | 'WOPAY', unknown[]> = { WPAY: [], WOPAY: [] };
      const addB2cs = (rows: TaxRow[], interState: boolean, p: string, sign: number) => {
        for (const r of rows) {
          const k = `${interState}|${p}|${Number(r.rate)}`;
          const e = b2cs.get(k) ?? { sply_ty: interState ? 'INTER' : 'INTRA', pos: p, typ: 'OE', rt: Number(r.rate), txval: ZERO, iamt: ZERO, camt: ZERO, samt: ZERO, csamt: ZERO };
          const s = D(String(sign));
          b2cs.set(k, { ...e, txval: e.txval.add(D(r.taxable).mul(s)), iamt: e.iamt.add(D(r.igst).mul(s)), camt: e.camt.add(D(r.cgst).mul(s)), samt: e.samt.add(D(r.sgst).mul(s)), csamt: e.csamt.add(D(r.cess).mul(s)) });
        }
      };
      let counted = 0;
      for (const i of invs) {
        if (i.taxKind === 'bill_of_supply') continue;
        const rows = linesOf(i.id);
        if (!rows.length) continue;
        counted++;
        const base = { inum: i.number, idt: ddmmyyyy(i.date), val: n2(D(i.val)), itms: itms(rows) };
        if (i.taxKind === 'export') {
          exp[i.withLut ? 'WOPAY' : 'WPAY'].push({ ...base, itms: (base.itms as { itm_det: Record<string, number> }[]).map((x) => ({ rt: x.itm_det.rt, txval: x.itm_det.txval, iamt: x.itm_det.iamt, csamt: x.itm_det.csamt })) });
        } else if (i.ctin) {
          b2b.set(i.ctin, [...(b2b.get(i.ctin) ?? []), { ...base, pos: i.pos, rchrg: i.rc ? 'Y' : 'N', inv_typ: i.taxKind === 'sez' ? (i.withLut ? 'SEWOP' : 'SEWP') : 'R' }]);
        } else if (i.interState && D(i.val).cmp(B2CL_LIMIT) > 0) {
          b2cl.set(i.pos ?? '', [...(b2cl.get(i.pos ?? '') ?? []), base]);
        } else addB2cs(rows, i.interState, i.pos ?? '', 1);
      }
      const cdnr = new Map<string, unknown[]>();
      const cdnur: unknown[] = [];
      for (const c of cns) {
        const inv = cnInv.find((x) => x.id === c.invoiceId)!;
        const rows = cnLines.filter((l) => l.docId === c.id);
        const base = { ntty: 'C', nt_num: c.number, nt_dt: ddmmyyyy(c.date), val: n2(D(c.val)), pos: c.pos, itms: itms(rows) };
        if (inv.ctin && inv.taxKind !== 'export') cdnr.set(inv.ctin, [...(cdnr.get(inv.ctin) ?? []), { ...base, rchrg: c.rc ? 'Y' : 'N', inv_typ: inv.taxKind === 'sez' ? (inv.withLut ? 'SEWOP' : 'SEWP') : 'R' }]);
        else if (inv.taxKind === 'export') cdnur.push({ ...base, typ: inv.withLut ? 'EXPWOP' : 'EXPWP' });
        else if (inv.interState && D(inv.val).cmp(B2CL_LIMIT) > 0) cdnur.push({ ...base, typ: 'B2CL' });
        else addB2cs(rows, inv.interState, c.pos ?? '', -1);
      }
      const hsn = await this.reports.hsnSummary(auth, { companyId, from, to });
      const docs = await this.reports.documentsIssued(auth, { companyId, from, to });
      const hsnRow = (r: (typeof hsn.rows)[number], i: number) => ({ num: i + 1, hsn_sc: r.hsn, desc: r.description.slice(0, 30), uqc: r.uqc, qty: Number(r.qty), rt: Number(r.gstRate), txval: Number(r.taxable), iamt: Number(r.igst), camt: Number(r.cgst), samt: Number(r.sgst), csamt: Number(r.cess) });
      const json = {
        gstin: own.gstin,
        fp,
        version: 'GST3.1.6',
        hash: 'hash',
        b2b: [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv })),
        b2cl: [...b2cl.entries()].map(([p, inv]) => ({ pos: p, inv })),
        b2cs: [...b2cs.values()].map((v) => ({ ...v, txval: n2(v.txval), iamt: n2(v.iamt), camt: n2(v.camt), samt: n2(v.samt), csamt: n2(v.csamt) })),
        exp: (['WPAY', 'WOPAY'] as const).filter((t) => exp[t].length).map((t) => ({ exp_typ: t, inv: exp[t] })),
        cdnr: [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt })),
        cdnur,
        hsn: { hsn_b2b: hsn.rows.filter((r) => r.section === 'b2b').map(hsnRow), hsn_b2c: hsn.rows.filter((r) => r.section === 'b2c').map(hsnRow) },
        doc_issue: { doc_det: [{ doc_num: 1, docs: docs.rows.filter((d) => d.docType === 'sales_invoice').map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.netIssued })) }, { doc_num: 5, docs: docs.rows.filter((d) => d.docType === 'credit_note').map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.netIssued })) }].filter((x) => x.docs.length) },
      };
      const count = (a: unknown[]) => a.length;
      const summary = {
        invoices: counted,
        b2b: [...b2b.values()].reduce((s, a) => s + count(a), 0),
        b2cl: [...b2cl.values()].reduce((s, a) => s + count(a), 0),
        b2cs: json.b2cs.length,
        exp: exp.WPAY.length + exp.WOPAY.length,
        cdnr: [...cdnr.values()].reduce((s, a) => s + count(a), 0),
        cdnur: cdnur.length,
        hsnLines: hsn.rows.length,
      };
      return { period: q.period, from, to, gstin: own.gstin, summary, json };
    });
  }

  // ---- GSTR-3B ---------------------------------------------------------------------

  gstr3b(auth: AuthContext, q: z.infer<typeof periodSchema>) {
    const { from, to } = bounds(q.period);
    return this.database.run(auth, async (tx) => {
      const companyId = await this.company(tx, q.companyId);
      const scope = and(eq(documents.companyId, companyId), inArray(documents.status, [...POSTED]), gte(documents.docDate, from), lte(documents.docDate, to));
      const sum = (cols: { taxable: unknown; igst: unknown; cgst: unknown; sgst: unknown; cess: unknown }) => ({
        taxable: sql<string>`coalesce(sum(${cols.taxable}), 0)::text`,
        igst: sql<string>`coalesce(sum(${cols.igst}), 0)::text`,
        cgst: sql<string>`coalesce(sum(${cols.cgst}), 0)::text`,
        sgst: sql<string>`coalesce(sum(${cols.sgst}), 0)::text`,
        cess: sql<string>`coalesce(sum(${cols.cess}), 0)::text`,
      });
      const sl = sum({ taxable: salesInvoiceLines.taxableValue, igst: salesInvoiceLines.igstAmount, cgst: salesInvoiceLines.cgstAmount, sgst: salesInvoiceLines.sgstAmount, cess: salesInvoiceLines.cessAmount });
      const out = await tx
        .select({ kind: sql<string>`case when ${salesInvoices.taxKind} in ('export','sez') then 'zero' when ${salesInvoiceLines.taxability} = 'exempt' or ${salesInvoices.taxKind} = 'bill_of_supply' then 'exempt' when ${salesInvoiceLines.taxability} = 'no_tax' then 'nongst' else 'taxable' end`, ...sl })
        .from(salesInvoiceLines)
        .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.invoiceId))
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .where(scope)
        .groupBy(sql`1`);
      const cl = sum({ taxable: creditNoteLines.taxableValue, igst: creditNoteLines.igstAmount, cgst: creditNoteLines.cgstAmount, sgst: creditNoteLines.sgstAmount, cess: creditNoteLines.cessAmount });
      const cnOut = await tx
        .select({ kind: sql<string>`case when ${creditNotes.taxKind} in ('export','sez') then 'zero' when ${creditNoteLines.taxability} = 'exempt' or ${creditNotes.taxKind} = 'bill_of_supply' then 'exempt' when ${creditNoteLines.taxability} = 'no_tax' then 'nongst' else 'taxable' end`, ...cl })
        .from(creditNoteLines)
        .innerJoin(creditNotes, eq(creditNotes.id, creditNoteLines.creditNoteId))
        .innerJoin(documents, eq(documents.id, creditNotes.id))
        .where(scope)
        .groupBy(sql`1`);
      const net = (kind: string) => {
        const a = out.find((r) => r.kind === kind);
        const b = cnOut.find((r) => r.kind === kind);
        const f = (k: 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess') => D(a?.[k] ?? '0').sub(D(b?.[k] ?? '0')).toFixed(2);
        return { taxable: f('taxable'), igst: f('igst'), cgst: f('cgst'), sgst: f('sgst'), cess: f('cess') };
      };
      const pl = sum({ taxable: purchaseInvoiceLines.taxableValue, igst: purchaseInvoiceLines.igstAmount, cgst: purchaseInvoiceLines.cgstAmount, sgst: purchaseInvoiceLines.sgstAmount, cess: purchaseInvoiceLines.cessAmount });
      const inward = await tx
        .select({ rc: purchaseInvoices.reverseCharge, eligible: purchaseInvoiceLines.itcEligible, taxability: purchaseInvoiceLines.taxability, interState: purchaseInvoices.interState, ...pl })
        .from(purchaseInvoiceLines)
        .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseInvoiceLines.piId))
        .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
        .where(scope)
        .groupBy(purchaseInvoices.reverseCharge, purchaseInvoiceLines.itcEligible, purchaseInvoiceLines.taxability, purchaseInvoices.interState);
      const dl = sum({ taxable: debitNoteLines.taxableValue, igst: debitNoteLines.igstAmount, cgst: debitNoteLines.cgstAmount, sgst: debitNoteLines.sgstAmount, cess: debitNoteLines.cessAmount });
      const [dnTax] = await tx.select(dl).from(debitNoteLines).innerJoin(debitNotes, eq(debitNotes.id, debitNoteLines.dnId)).innerJoin(documents, eq(documents.id, debitNotes.id)).where(and(scope, eq(debitNotes.reverseCharge, false)));
      const [imports] = await tx.select({ igst: sql<string>`coalesce(sum(${billsOfEntry.igstTotal}), 0)::text`, cess: sql<string>`coalesce(sum(${billsOfEntry.cessTotal}), 0)::text` }).from(billsOfEntry).innerJoin(documents, eq(documents.id, billsOfEntry.id)).where(scope);
      const agg = (rows: typeof inward) => {
        const t = { taxable: ZERO, igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO };
        for (const r of rows) for (const k of ['taxable', 'igst', 'cgst', 'sgst', 'cess'] as const) t[k] = t[k].add(D(r[k]));
        return t;
      };
      const fmt = (t: { taxable?: Decimal; igst: Decimal; cgst: Decimal; sgst: Decimal; cess: Decimal }) => ({ ...(t.taxable ? { taxable: t.taxable.toFixed(2) } : {}), igst: t.igst.toFixed(2), cgst: t.cgst.toFixed(2), sgst: t.sgst.toFixed(2), cess: t.cess.toFixed(2) });
      const rcm = agg(inward.filter((r) => r.rc));
      const rcmEligible = agg(inward.filter((r) => r.rc && r.eligible));
      const other = agg(inward.filter((r) => !r.rc && r.eligible && r.taxability === 'taxable'));
      const ineligible = agg(inward.filter((r) => !r.eligible));
      const exemptInward = inward.filter((r) => !r.rc && (r.taxability === 'exempt' || r.taxability === 'no_tax'));
      const reversal = { igst: D(dnTax.igst), cgst: D(dnTax.cgst), sgst: D(dnTax.sgst), cess: D(dnTax.cess) };
      const avail = { igst: D(imports.igst).add(rcmEligible.igst).add(other.igst), cgst: rcmEligible.cgst.add(other.cgst), sgst: rcmEligible.sgst.add(other.sgst), cess: D(imports.cess).add(rcmEligible.cess).add(other.cess) };
      const netItc = { igst: avail.igst.sub(reversal.igst), cgst: avail.cgst.sub(reversal.cgst), sgst: avail.sgst.sub(reversal.sgst), cess: avail.cess.sub(reversal.cess) };
      // 3.2: inter-state supplies to unregistered persons, by place of supply.
      const b2cInter = await tx
        .select({ pos: salesInvoices.placeOfSupply, taxable: sql<string>`sum(${salesInvoices.taxableTotal})::text`, igst: sql<string>`sum(${salesInvoices.igstTotal})::text` })
        .from(salesInvoices)
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .where(and(scope, sql`${salesInvoices.customerGstin} is null`, eq(salesInvoices.interState, true), sql`${salesInvoices.taxKind} = 'tax_invoice'`))
        .groupBy(salesInvoices.placeOfSupply);
      // Set-off on the tax ledgers as at the period end (carries forward unused credit).
      const bal = await this.taxBalances(tx, companyId, to);
      const liability = { igst: bal.gst_out_igst, cgst: bal.gst_out_cgst, sgst: bal.gst_out_sgst, cess: bal.gst_out_cess };
      const credit = { igst: bal.gst_in_igst, cgst: bal.gst_in_cgst, sgst: bal.gst_in_sgst, cess: bal.gst_in_cess };
      const setOff = computeSetOff(liability, credit);
      const rcmCash = { igst: bal.gst_rcm_igst, cgst: bal.gst_rcm_cgst, sgst: bal.gst_rcm_sgst, cess: bal.gst_rcm_cess };
      return {
        period: q.period,
        from,
        to,
        table31: {
          a: net('taxable'),
          b: net('zero'),
          c: net('exempt'),
          d: fmt(rcm),
          e: net('nongst'),
        },
        table32: b2cInter.map((r) => ({ pos: r.pos, taxable: D(r.taxable).toFixed(2), igst: D(r.igst).toFixed(2) })),
        table4: {
          imports: { igst: D(imports.igst).toFixed(2), cess: D(imports.cess).toFixed(2) },
          reverseCharge: fmt(rcmEligible),
          others: fmt(other),
          reversed: fmt(reversal),
          net: fmt(netItc),
          ineligible: fmt(ineligible),
        },
        table5: {
          inter: exemptInward.filter((r) => r.interState).reduce((s, r) => s.add(D(r.taxable)), ZERO).toFixed(2),
          intra: exemptInward.filter((r) => !r.interState).reduce((s, r) => s.add(D(r.taxable)), ZERO).toFixed(2),
        },
        ledger: { liability: fmt(liability), credit: fmt(credit), rcm: fmt(rcmCash) },
        setOff,
        cashPayable: {
          igst: D(setOff.cash.igst).add(rcmCash.igst).toFixed(2),
          cgst: D(setOff.cash.cgst).add(rcmCash.cgst).toFixed(2),
          sgst: D(setOff.cash.sgst).add(rcmCash.sgst).toFixed(2),
          cess: D(setOff.cash.cess).add(rcmCash.cess).toFixed(2),
        },
      };
    });
  }

  /** Closing balances of the GST accounts (liabilities as positive credit, inputs as positive debit). */
  private async taxBalances(tx: Transaction, companyId: string, to: string) {
    const keys = ['gst_out_igst', 'gst_out_cgst', 'gst_out_sgst', 'gst_out_cess', 'gst_in_igst', 'gst_in_cgst', 'gst_in_sgst', 'gst_in_cess', 'gst_rcm_igst', 'gst_rcm_cgst', 'gst_rcm_sgst', 'gst_rcm_cess'] as const;
    const rows = await tx
      .select({ key: accounts.systemKey, v: sql<string>`coalesce(sum(${glEntries.debit} - ${glEntries.credit}), 0)::text` })
      .from(accounts)
      .leftJoin(glEntries, and(eq(glEntries.accountId, accounts.id), lte(glEntries.postingDate, to)))
      .where(and(eq(accounts.companyId, companyId), inArray(accounts.systemKey, [...keys])))
      .groupBy(accounts.systemKey);
    const out = {} as Record<(typeof keys)[number], Decimal>;
    for (const k of keys) {
      const v = D(rows.find((r) => r.key === k)?.v ?? '0');
      out[k] = k.startsWith('gst_in') ? (v.isNegative() ? ZERO : v) : v.isNegative() ? ZERO.sub(v) : ZERO;
    }
    return out;
  }

  /**
   * Posts the month's set-off: output tax and reverse-charge tax are cleared against input
   * credit as utilised, and the cash part moves to "GST payable", paid by a payment voucher.
   */
  settle(auth: AuthContext, q: z.infer<typeof periodSchema>, meta: RequestMeta) {
    return this.gstr3b(auth, q).then((r) =>
      this.database.run(auth, async (tx) => {
        const companyId = await this.company(tx, q.companyId);
        const accs = await tx.select({ id: accounts.id, key: accounts.systemKey }).from(accounts).where(and(eq(accounts.companyId, companyId), isNotNull(accounts.systemKey)));
        const id = (k: string) => {
          const a = accs.find((x) => x.key === k);
          if (!a) throw new BadRequestException(`The chart of accounts has no ${k.replace(/_/g, ' ')} account`);
          return a.id;
        };
        const lines: { accountId: string; debit: string | null; credit: string | null; narration: string }[] = [];
        const heads = ['igst', 'cgst', 'sgst', 'cess'] as const;
        let cash = ZERO;
        for (const h of heads) {
          const liab = D(r.ledger.liability[h]);
          if (liab.cmp(ZERO) > 0) lines.push({ accountId: id(`gst_out_${h}`), debit: liab.toFixed(2), credit: null, narration: `Output ${h.toUpperCase()} for ${q.period}` });
          for (const c of heads) {
            const used = D(r.setOff.utilised[h][c]);
            if (used.cmp(ZERO) > 0) lines.push({ accountId: id(`gst_in_${c}`), debit: null, credit: used.toFixed(2), narration: `${c.toUpperCase()} credit used for ${h.toUpperCase()}` });
          }
          cash = cash.add(D(r.setOff.cash[h]));
          const rcm = D(r.ledger.rcm[h]);
          if (rcm.cmp(ZERO) > 0) {
            lines.push({ accountId: id(`gst_rcm_${h}`), debit: rcm.toFixed(2), credit: null, narration: `Reverse charge ${h.toUpperCase()} for ${q.period}` });
            cash = cash.add(rcm);
          }
        }
        if (cash.cmp(ZERO) > 0) lines.push({ accountId: id('gst_payable'), debit: null, credit: cash.toFixed(2), narration: `GST to pay in cash for ${q.period}` });
        if (lines.length < 2) throw new BadRequestException('Nothing to set off for this period');
        return { lines, cash: cash.toFixed(2), to: r.to, companyId };
      }),
    ).then(async (p) => {
      // Created through the journals module (registered on the documents service).
      const jv = await this.postJournal(auth, p.companyId, p.to, `GST set-off for ${q.period}`, p.lines, meta);
      return { journalId: jv.id, number: jv.number, cashPayable: p.cash };
    });
  }

  /** Hook set by the accounting module so this module can post journals without a circular import. */
  postJournal: (auth: AuthContext, companyId: string, date: string, narration: string, lines: { accountId: string; debit: string | null; credit: string | null; narration: string }[], meta: RequestMeta) => Promise<{ id: string; number: string | null }> = () => {
    throw new BadRequestException('Accounting is not set up');
  };

  // ---- GSTR-2B ---------------------------------------------------------------------

  /** Imports the GSTR-2B JSON downloaded from the portal and matches it with purchase bills. */
  import2b(auth: AuthContext, file: { buffer: Buffer; fileName: string }, companyId?: string) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(file.buffer.toString('utf8').replace(/^﻿/, ''));
    } catch {
      throw new BadRequestException('Upload the GSTR-2B JSON file downloaded from the GST portal');
    }
    const data = (json.data ?? json) as { gstin?: string; rtnprd?: string; docdata?: Record<string, unknown[]> };
    if (!data.rtnprd || !data.docdata) throw new BadRequestException('This is not a GSTR-2B file (rtnprd / docdata missing)');
    const period = `${data.rtnprd.slice(2)}-${data.rtnprd.slice(0, 2)}`;
    const dmy = (v: string) => `${v.slice(6, 10)}-${v.slice(3, 5)}-${v.slice(0, 2)}`;
    type Item = { txval?: number; igst?: number; cgst?: number; sgst?: number; cess?: number };
    const tot = (items: Item[]) => items.reduce((s, i) => ({ taxable: s.taxable.add(D(String(i.txval ?? 0))), igst: s.igst.add(D(String(i.igst ?? 0))), cgst: s.cgst.add(D(String(i.cgst ?? 0))), sgst: s.sgst.add(D(String(i.sgst ?? 0))), cess: s.cess.add(D(String(i.cess ?? 0))) }), { taxable: ZERO, igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO });
    const lines: Omit<typeof gstr2bLines.$inferInsert, 'tenantId' | 'importId'>[] = [];
    for (const s of (data.docdata.b2b ?? []) as { ctin: string; trdnm?: string; inv: { inum: string; dt: string; val: number; pos?: string; rev?: string; itcavl?: string; rsn?: string; items: Item[] }[] }[]) {
      for (const i of s.inv) {
        const t = tot(i.items ?? []);
        lines.push({ period, section: 'b2b', ctin: s.ctin, tradeName: s.trdnm ?? null, docType: 'INV', docNo: i.inum, docDate: dmy(i.dt), pos: i.pos ?? null, reverseCharge: i.rev === 'Y', itcAvailable: i.itcavl !== 'N', itcReason: i.rsn ?? null, taxable: t.taxable.toFixed(2), igst: t.igst.toFixed(2), cgst: t.cgst.toFixed(2), sgst: t.sgst.toFixed(2), cess: t.cess.toFixed(2), total: D(String(i.val)).toFixed(2) });
      }
    }
    for (const s of (data.docdata.cdnr ?? []) as { ctin: string; trdnm?: string; nt: { ntnum: string; typ: string; dt: string; val: number; pos?: string; rev?: string; itcavl?: string; items: Item[] }[] }[]) {
      for (const n of s.nt) {
        const t = tot(n.items ?? []);
        lines.push({ period, section: 'cdnr', ctin: s.ctin, tradeName: s.trdnm ?? null, docType: n.typ === 'D' ? 'DBN' : 'CRN', docNo: n.ntnum, docDate: dmy(n.dt), pos: n.pos ?? null, reverseCharge: n.rev === 'Y', itcAvailable: n.itcavl !== 'N', taxable: t.taxable.toFixed(2), igst: t.igst.toFixed(2), cgst: t.cgst.toFixed(2), sgst: t.sgst.toFixed(2), cess: t.cess.toFixed(2), total: D(String(n.val)).toFixed(2) });
      }
    }
    for (const b of (data.docdata.impg ?? []) as { boenum: string; boedt: string; portcode: string; txval: number; igst: number; cess?: number }[]) {
      lines.push({ period, section: 'impg', ctin: null, tradeName: b.portcode, docType: 'BOE', docNo: b.boenum, docDate: dmy(b.boedt), taxable: D(String(b.txval)).toFixed(2), igst: D(String(b.igst)).toFixed(2), cess: D(String(b.cess ?? 0)).toFixed(2), total: D(String(b.txval)).add(D(String(b.igst))).toFixed(2) });
    }
    return this.database.run(auth, async (tx) => {
      const cid = await this.company(tx, companyId);
      const own = await ownGstRegistration(tx, cid, null);
      if (data.gstin && own.gstin && data.gstin !== own.gstin) throw new BadRequestException(`This GSTR-2B is for ${data.gstin}, not ${own.gstin}`);
      const [imp] = await tx.insert(gstr2bImports).values({ tenantId: auth.tenantId, companyId: cid, gstin: data.gstin ?? own.gstin ?? '', period, fileName: file.fileName, lines: lines.length, importedBy: auth.userId }).returning();
      if (lines.length) await tx.insert(gstr2bLines).values(lines.map((l) => ({ ...l, tenantId: auth.tenantId, importId: imp.id })));
      await this.match(tx, imp.id);
      return this.reconciliation(tx, cid, period);
    });
  }

  private async match(tx: Transaction, importId: string) {
    const lines = await tx.select().from(gstr2bLines).where(eq(gstr2bLines.importId, importId));
    const ctins = [...new Set(lines.map((l) => l.ctin).filter((v): v is string => !!v))];
    const bills = ctins.length
      ? await tx
          .select({ id: purchaseInvoices.id, gstin: purchaseInvoices.vendorGstin, no: purchaseInvoices.supplierInvoiceNo, date: purchaseInvoices.supplierInvoiceDate, taxable: purchaseInvoices.taxableTotal, igst: purchaseInvoices.igstTotal, cgst: purchaseInvoices.cgstTotal, sgst: purchaseInvoices.sgstTotal, cess: purchaseInvoices.cessTotal })
          .from(purchaseInvoices)
          .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
          .where(and(inArray(purchaseInvoices.vendorGstin, ctins), inArray(documents.status, [...POSTED])))
      : [];
    const boes = await tx.select({ id: billsOfEntry.id, no: billsOfEntry.boeNo, igst: billsOfEntry.igstTotal }).from(billsOfEntry).innerJoin(documents, eq(documents.id, billsOfEntry.id)).where(inArray(documents.status, [...POSTED]));
    for (const l of lines) {
      let status = 'missing_in_books';
      let pi: string | null = null;
      let diff: string | null = null;
      if (l.section === 'b2b') {
        const b = bills.find((x) => x.gstin === l.ctin && normaliseInvoiceNo(x.no) === normaliseInvoiceNo(l.docNo));
        if (b) {
          pi = b.id;
          const diffs = (['taxable', 'igst', 'cgst', 'sgst', 'cess'] as const).map((k) => [k, D(l[k] ?? '0').sub(D(b[k]))] as const).filter(([, d]) => d.abs().cmp(D('1')) > 0);
          status = diffs.length ? 'mismatch' : 'matched';
          diff = diffs.length ? diffs.map(([k, d]) => `${k} ${d.isNegative() ? '' : '+'}${d.toFixed(2)}`).join(', ') : null;
          if (!diff && l.docDate !== b.date) diff = `date ${b.date} in books`;
        }
      } else if (l.section === 'impg') {
        const b = boes.find((x) => x.no === l.docNo);
        if (b) status = D(b.igst).sub(D(l.igst)).abs().cmp(D('1')) > 0 ? 'mismatch' : 'matched';
      } else status = 'unmatched_note';
      await tx.update(gstr2bLines).set({ status, purchaseInvoiceId: pi, difference: diff }).where(eq(gstr2bLines.id, l.id));
    }
  }

  /** 2B lines with their status, and bills in the books that are not in 2B (ITC at risk). */
  reconciliationFor(auth: AuthContext, q: z.infer<typeof periodSchema>) {
    return this.database.run(auth, async (tx) => this.reconciliation(tx, await this.company(tx, q.companyId), q.period));
  }

  private async reconciliation(tx: Transaction, companyId: string, period: string) {
    const { from, to } = bounds(period);
    const [imp] = await tx.select().from(gstr2bImports).where(and(eq(gstr2bImports.companyId, companyId), eq(gstr2bImports.period, period))).orderBy(desc(gstr2bImports.importedAt)).limit(1);
    const lines = imp ? await tx.select().from(gstr2bLines).where(eq(gstr2bLines.importId, imp.id)).orderBy(asc(gstr2bLines.ctin), asc(gstr2bLines.docDate)) : [];
    const matchedIds = new Set(lines.map((l) => l.purchaseInvoiceId).filter(Boolean));
    const notIn2b = await tx
      .select({ id: purchaseInvoices.id, number: documents.number, vendor: parties.name, gstin: purchaseInvoices.vendorGstin, no: purchaseInvoices.supplierInvoiceNo, date: purchaseInvoices.supplierInvoiceDate, itc: purchaseInvoices.itcEligibleTax, total: purchaseInvoices.grandTotal })
      .from(purchaseInvoices)
      .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
      .innerJoin(parties, eq(parties.id, purchaseInvoices.vendorId))
      .where(and(eq(documents.companyId, companyId), inArray(documents.status, [...POSTED]), isNotNull(purchaseInvoices.vendorGstin), gte(documents.docDate, from), lte(documents.docDate, to), sql`${purchaseInvoices.itcEligibleTax} > 0`));
    const missingIn2b = notIn2b.filter((b) => !matchedIds.has(b.id));
    const count = (s: string) => lines.filter((l) => l.status === s).length;
    const itc = (rows: typeof lines) => rows.reduce((s, l) => s.add(D(l.igst)).add(D(l.cgst)).add(D(l.sgst)).add(D(l.cess)), ZERO).toFixed(2);
    return {
      period,
      importedAt: imp?.importedAt ?? null,
      summary: {
        lines: lines.length,
        matched: count('matched'),
        mismatch: count('mismatch'),
        missingInBooks: count('missing_in_books'),
        missingIn2b: missingIn2b.length,
        itcIn2b: itc(lines.filter((l) => l.itcAvailable && l.section !== 'cdnr')),
        itcAtRisk: missingIn2b.reduce((s, b) => s.add(D(b.itc)), ZERO).toFixed(2),
        matchRate: lines.length ? Math.round((count('matched') / lines.length) * 1000) / 10 : null,
      },
      lines: lines.map(({ tenantId: _t, ...l }) => l),
      missingIn2b,
    };
  }

  setAction(auth: AuthContext, lineId: string, input: z.infer<typeof actionSchema>) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx.update(gstr2bLines).set({ action: input.action, note: input.note ?? null }).where(eq(gstr2bLines.id, lineId)).returning();
      if (!row) throw new BadRequestException('Line not found');
      return row;
    });
  }
}
