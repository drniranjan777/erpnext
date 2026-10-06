import { Injectable } from '@nestjs/common';
import { creditNoteLines, creditNotes, documents, GST_UQC, salesInvoiceLines, salesInvoices, uoms } from '@nextgen/database';
import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { DatabaseService } from '../../database/database.service';

const D = Decimal.from;
const ZERO = D('0');

export interface PeriodQuery {
  companyId?: string;
  from: string;
  to: string;
}

interface HsnRow {
  section: 'b2b' | 'b2c';
  hsn: string;
  description: string;
  uqc: string;
  gstRate: string;
  qty: Decimal;
  taxable: Decimal;
  igst: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  cess: Decimal;
}

/** Documents counted in GSTR-1 Table 13 ("documents issued"), in the portal's categories. */
const DOC_SERIES: { docType: string; nature: string }[] = [
  { docType: 'sales_invoice', nature: 'Invoices for outward supply' },
  { docType: 'credit_note', nature: 'Credit note' },
  { docType: 'delivery_note', nature: 'Delivery challan for job work / others' },
  { docType: 'job_work_challan', nature: 'Delivery challan in case of job work' },
];

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]) => `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/**
 * GSTR-1 support reports from posted documents: HSN-wise summary of outward supplies
 * (Table 12, split B2B / B2C, net of credit notes) and documents issued (Table 13).
 */
@Injectable()
export class GstReportsService {
  constructor(private readonly database: DatabaseService) {}

  hsnSummary(auth: AuthContext, q: PeriodQuery) {
    return this.database.run(auth, async (tx) => {
      const rows = new Map<string, HsnRow>();
      const add = (r: { hsn: string | null; description: string; uqc: string; gstRate: string; qty: string; taxable: string; igst: string; cgst: string; sgst: string; cess: string; b2b: boolean }, sign: 1 | -1) => {
        const section = r.b2b ? 'b2b' : 'b2c';
        const hsn = r.hsn ?? '';
        const key = `${section}|${hsn}|${r.uqc}|${Number(r.gstRate)}`;
        const s = D(String(sign));
        const row = rows.get(key) ?? { section, hsn, description: r.description, uqc: r.uqc, gstRate: String(Number(r.gstRate)), qty: ZERO, taxable: ZERO, igst: ZERO, cgst: ZERO, sgst: ZERO, cess: ZERO };
        row.qty = row.qty.add(D(r.qty).mul(s));
        row.taxable = row.taxable.add(D(r.taxable).mul(s));
        row.igst = row.igst.add(D(r.igst).mul(s));
        row.cgst = row.cgst.add(D(r.cgst).mul(s));
        row.sgst = row.sgst.add(D(r.sgst).mul(s));
        row.cess = row.cess.add(D(r.cess).mul(s));
        rows.set(key, row);
      };
      const b2b = sql<boolean>`(${salesInvoices.customerGstin} is not null and ${salesInvoices.taxKind} <> 'export')`;
      const inv = await tx
        .select({
          hsn: salesInvoiceLines.hsnCode,
          description: salesInvoiceLines.description,
          uqc: uoms.uqc,
          gstRate: salesInvoiceLines.gstRate,
          qty: salesInvoiceLines.qty,
          taxable: salesInvoiceLines.taxableValue,
          igst: salesInvoiceLines.igstAmount,
          cgst: salesInvoiceLines.cgstAmount,
          sgst: salesInvoiceLines.sgstAmount,
          cess: salesInvoiceLines.cessAmount,
          b2b,
        })
        .from(salesInvoiceLines)
        .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.invoiceId))
        .innerJoin(documents, eq(documents.id, salesInvoices.id))
        .innerJoin(uoms, eq(uoms.id, salesInvoiceLines.uomId))
        .where(this.period(q, ['approved', 'completed']));
      inv.forEach((r) => add(r, 1));
      const cn = await tx
        .select({
          hsn: creditNoteLines.hsnCode,
          description: creditNoteLines.description,
          uqc: uoms.uqc,
          gstRate: creditNoteLines.gstRate,
          // Price adjustments reduce value, not quantity.
          qty: sql<string>`case when ${creditNotes.kind} = 'return' then ${creditNoteLines.qty} else 0 end`,
          taxable: creditNoteLines.taxableValue,
          igst: creditNoteLines.igstAmount,
          cgst: creditNoteLines.cgstAmount,
          sgst: creditNoteLines.sgstAmount,
          cess: creditNoteLines.cessAmount,
          b2b,
        })
        .from(creditNoteLines)
        .innerJoin(creditNotes, eq(creditNotes.id, creditNoteLines.creditNoteId))
        .innerJoin(salesInvoices, eq(salesInvoices.id, creditNotes.invoiceId))
        .innerJoin(documents, eq(documents.id, creditNotes.id))
        .innerJoin(uoms, eq(uoms.id, creditNoteLines.uomId))
        .where(this.period(q, ['approved', 'completed']));
      cn.forEach((r) => add(r, -1));
      const out = [...rows.values()]
        .sort((a, b) => a.section.localeCompare(b.section) || a.hsn.localeCompare(b.hsn) || Number(a.gstRate) - Number(b.gstRate))
        .map((r) => {
          const tax = r.igst.add(r.cgst).add(r.sgst).add(r.cess);
          return {
            section: r.section,
            hsn: r.hsn,
            description: r.description,
            uqc: r.uqc,
            uqcName: GST_UQC[r.uqc] ?? r.uqc,
            gstRate: r.gstRate,
            qty: r.qty.toFixed(3),
            totalValue: r.taxable.add(tax).toFixed(2),
            taxable: r.taxable.toFixed(2),
            igst: r.igst.toFixed(2),
            cgst: r.cgst.toFixed(2),
            sgst: r.sgst.toFixed(2),
            cess: r.cess.toFixed(2),
          };
        });
      const total = (section: string) => {
        const s = out.filter((r) => r.section === section);
        const sum = (k: 'taxable' | 'igst' | 'cgst' | 'sgst' | 'cess' | 'totalValue') => s.reduce((a, r) => a.add(D(r[k])), ZERO).toFixed(2);
        return { lines: s.length, taxable: sum('taxable'), igst: sum('igst'), cgst: sum('cgst'), sgst: sum('sgst'), cess: sum('cess'), totalValue: sum('totalValue') };
      };
      return { from: q.from, to: q.to, rows: out, totals: { b2b: total('b2b'), b2c: total('b2c') }, missingHsn: out.filter((r) => !r.hsn).length };
    });
  }

  hsnCsv(data: Awaited<ReturnType<GstReportsService['hsnSummary']>>) {
    return toCsv(
      ['Section', 'HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
      data.rows.map((r) => [r.section.toUpperCase(), r.hsn, r.description, `${r.uqc}-${r.uqcName}`, r.qty, r.totalValue, r.gstRate, r.taxable, r.igst, r.cgst, r.sgst, r.cess]),
    );
  }

  /** Table 13: per series, first and last number, total issued, cancelled. */
  documentsIssued(auth: AuthContext, q: PeriodQuery) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          docType: documents.docType,
          seriesId: documents.seriesId,
          total: sql<number>`count(*)::int`,
          cancelled: sql<number>`count(*) filter (where ${documents.status} = 'cancelled')::int`,
          first: sql<string>`(array_agg(${documents.number} order by ${documents.id}))[1]`,
          last: sql<string>`(array_agg(${documents.number} order by ${documents.id} desc))[1]`,
        })
        .from(documents)
        .where(
          and(
            inArray(documents.docType, DOC_SERIES.map((d) => d.docType)),
            sql`${documents.number} is not null`,
            q.companyId ? eq(documents.companyId, q.companyId) : undefined,
            gte(documents.docDate, q.from),
            lte(documents.docDate, q.to),
          ),
        )
        .groupBy(documents.docType, documents.seriesId)
        .orderBy(asc(documents.docType));
      return {
        from: q.from,
        to: q.to,
        rows: rows.map((r) => ({ nature: DOC_SERIES.find((d) => d.docType === r.docType)?.nature ?? r.docType, docType: r.docType, from: r.first, to: r.last, total: r.total, cancelled: r.cancelled, netIssued: r.total - r.cancelled })),
      };
    });
  }

  private period(q: PeriodQuery, statuses: string[]) {
    return and(
      inArray(documents.status, statuses as ('approved' | 'completed')[]),
      q.companyId ? eq(documents.companyId, q.companyId) : undefined,
      gte(documents.docDate, q.from),
      lte(documents.docDate, q.to),
      ne(documents.status, 'cancelled'),
    );
  }
}
