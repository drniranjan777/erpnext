import { Injectable } from '@nestjs/common';
import { documents, GST_STATES, jobWorkChallanLines, jobWorkChallans, jobWorkReceiptLines, jobWorkReceipts, uoms } from '@nextgen/database';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { DatabaseService } from '../../database/database.service';
import { ownGstRegistration } from '../gst/pricing';
import { toCsv } from '../compliance/gst-reports.service';

const D = Decimal.from;

/**
 * ITC-04: goods sent to job workers (table 4) and received back (table 5A) in a period,
 * in the layout of the GST offline tool.
 */
@Injectable()
export class Itc04Service {
  constructor(private readonly database: DatabaseService) {}

  report(auth: AuthContext, q: { companyId?: string; from: string; to: string }) {
    return this.database.run(auth, async (tx) => {
      const sent = await tx
        .select({
          companyId: documents.companyId,
          branchId: documents.branchId,
          challanNo: documents.number,
          challanDate: documents.docDate,
          gstin: jobWorkChallans.jobWorkerGstin,
          stateCode: jobWorkChallans.jobWorkerStateCode,
          description: jobWorkChallanLines.description,
          uqc: uoms.uqc,
          qty: jobWorkChallanLines.qty,
          value: jobWorkChallanLines.value,
          goodsType: jobWorkChallanLines.goodsType,
          gstRate: jobWorkChallanLines.gstRate,
        })
        .from(jobWorkChallanLines)
        .innerJoin(jobWorkChallans, eq(jobWorkChallans.id, jobWorkChallanLines.challanId))
        .innerJoin(documents, eq(documents.id, jobWorkChallans.id))
        .innerJoin(uoms, eq(uoms.id, jobWorkChallanLines.uomId))
        .where(and(inArray(documents.status, ['approved', 'completed']), q.companyId ? eq(documents.companyId, q.companyId) : undefined, gte(documents.docDate, q.from), lte(documents.docDate, q.to)))
        .orderBy(asc(documents.docDate), asc(documents.number), asc(jobWorkChallanLines.lineNo));
      const own = new Map<string, string | null>();
      const ourState = async (companyId: string, branchId: string | null) => {
        const k = `${companyId}|${branchId}`;
        if (!own.has(k)) own.set(k, (await ownGstRegistration(tx, companyId, branchId)).stateCode);
        return own.get(k)!;
      };
      const table4 = [];
      for (const s of sent) {
        const inter = (await ourState(s.companyId, s.branchId)) !== s.stateCode;
        const rate = String(Number(s.gstRate));
        table4.push({
          jobWorkerGstin: s.gstin,
          jobWorkerState: s.stateCode ? `${s.stateCode}-${GST_STATES[s.stateCode] ?? ''}` : '',
          challanNo: s.challanNo,
          challanDate: s.challanDate,
          typeOfGoods: s.goodsType === 'capital_goods' ? 'Capital Goods' : 'Inputs',
          description: s.description,
          uqc: s.uqc,
          qty: D(s.qty).toFixed(3),
          taxableValue: s.value,
          igstRate: inter ? rate : '0',
          cgstRate: inter ? '0' : D(rate).div(D('2')).toFixed(3).replace(/\.?0+$/, ''),
          sgstRate: inter ? '0' : D(rate).div(D('2')).toFixed(3).replace(/\.?0+$/, ''),
          cessRate: '0',
        });
      }
      const back = await tx
        .select({
          gstin: jobWorkChallans.jobWorkerGstin,
          stateCode: jobWorkChallans.jobWorkerStateCode,
          challanNo: sql<string>`(select d.number from ${documents} d where d.id = ${jobWorkChallans.id})`,
          challanDate: sql<string>`(select d.doc_date::text from ${documents} d where d.id = ${jobWorkChallans.id})`,
          jwChallanNo: jobWorkReceipts.jwChallanNo,
          jwChallanDate: jobWorkReceipts.jwChallanDate,
          receiptDate: documents.docDate,
          natureOfJob: jobWorkReceipts.natureOfJob,
          description: jobWorkChallanLines.description,
          uqc: uoms.uqc,
          consumed: jobWorkReceiptLines.consumedQty,
          returned: jobWorkReceiptLines.returnedQty,
          loss: jobWorkReceiptLines.lossQty,
        })
        .from(jobWorkReceiptLines)
        .innerJoin(jobWorkReceipts, eq(jobWorkReceipts.id, jobWorkReceiptLines.receiptId))
        .innerJoin(documents, eq(documents.id, jobWorkReceipts.id))
        .innerJoin(jobWorkChallanLines, eq(jobWorkChallanLines.id, jobWorkReceiptLines.challanLineId))
        .innerJoin(jobWorkChallans, eq(jobWorkChallans.id, jobWorkChallanLines.challanId))
        .innerJoin(uoms, eq(uoms.id, jobWorkChallanLines.uomId))
        .where(and(eq(jobWorkReceiptLines.kind, 'material'), inArray(documents.status, ['approved', 'completed']), q.companyId ? eq(documents.companyId, q.companyId) : undefined, gte(documents.docDate, q.from), lte(documents.docDate, q.to)))
        .orderBy(asc(documents.docDate));
      const table5a = back.map((b) => ({
        jobWorkerGstin: b.gstin,
        jobWorkerState: b.stateCode ? `${b.stateCode}-${GST_STATES[b.stateCode] ?? ''}` : '',
        originalChallanNo: b.challanNo,
        originalChallanDate: b.challanDate,
        jobWorkerChallanNo: b.jwChallanNo ?? '',
        jobWorkerChallanDate: b.jwChallanDate ?? b.receiptDate,
        natureOfJob: b.natureOfJob ?? '',
        description: b.description,
        uqc: b.uqc,
        qty: D(b.consumed).add(D(b.returned)).toFixed(3),
        lossUqc: D(b.loss).isZero() ? '' : b.uqc,
        lossQty: D(b.loss).isZero() ? '' : D(b.loss).toFixed(3),
      }));
      return { from: q.from, to: q.to, table4, table5a };
    });
  }

  csv(data: Awaited<ReturnType<Itc04Service['report']>>) {
    const t4 = toCsv(
      ['GSTIN of Job Worker', 'State', 'Challan Number', 'Challan Date', 'Types of Goods', 'Description of Goods', 'Unique Quantity Code (UQC)', 'Quantity', 'Taxable Value', 'Integrated Tax Rate (%)', 'Central Tax Rate (%)', 'State/UT Tax Rate (%)', 'Cess'],
      data.table4.map((r) => [r.jobWorkerGstin ?? '', r.jobWorkerState, r.challanNo, r.challanDate, r.typeOfGoods, r.description, r.uqc, r.qty, r.taxableValue, r.igstRate, r.cgstRate, r.sgstRate, r.cessRate]),
    );
    const t5 = toCsv(
      ['GSTIN of Job Worker', 'State', 'Original Challan Number', 'Original Challan Date', 'Job Worker Challan Number', 'Job Worker Challan Date', 'Nature of Job Work Done', 'Description of Goods', 'UQC', 'Quantity', 'UQC of Losses', 'Quantity of Losses'],
      data.table5a.map((r) => [r.jobWorkerGstin ?? '', r.jobWorkerState, r.originalChallanNo, r.originalChallanDate, r.jobWorkerChallanNo, r.jobWorkerChallanDate, r.natureOfJob, r.description, r.uqc, r.qty, r.lossUqc, r.lossQty]),
    );
    return `Table 4 - Goods sent to job worker\r\n${t4.replace('﻿', '')}\r\nTable 5A - Goods received back from job worker\r\n${t5.replace('﻿', '')}`.replace(/^/, '﻿');
  }
}
