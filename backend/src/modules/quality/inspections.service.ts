import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  documents,
  goodsReceiptLines,
  goodsReceipts,
  inspectionParameters,
  inspectionPlans,
  inspectionReadings,
  items,
  parties,
  productionEntries,
  productionEntryLines,
  qualityInspections,
  uoms,
  warehouses,
  workOrderOperations,
  workOrders,
  type Transaction,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService, type Voucher } from '../inventory/stock.service';
import { ProductionService, type JobCardRow, type OperationRow } from '../manufacturing/production.service';
import { WorkOrdersService } from '../manufacturing/work-orders.service';
import { evaluate, samplingPlan, type InspectionLevel } from './aql';
import { PlansService } from './plans.service';

const DOC_TYPE = 'quality_inspection' as const;
const D = Decimal.from;
const ZERO = D('0');

type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

const qty0 = (label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || String(v).trim() === '' ? '0' : String(v).trim()))
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), `${label}: a number with up to 4 decimals`);

export const createInspectionSchema = z.object({
  stage: z.enum(['incoming', 'in_process', 'final']),
  itemId: z.uuid(),
  planId: z.uuid().nullable().optional(),
  lotQty: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Lot quantity must be more than zero'),
  warehouseId: z.uuid().nullable().optional(),
  batchNo: optionalText(40),
  remarks: optionalText(1000),
});
export type CreateInspectionInput = z.infer<typeof createInspectionSchema>;

export const readingsSchema = z.object({
  readings: z
    .array(
      z.object({
        parameterId: z.uuid(),
        sampleNo: z.number().int().min(1).max(10000),
        value: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())).refine((v) => v === null || /^-?\d{1,12}(\.\d{1,6})?$/.test(v), 'Reading: a number'),
        passed: z.boolean().nullable().optional(),
        note: optionalText(300),
      }),
    )
    .max(5000),
});

export const decisionSchema = z.object({
  version: z.number().int(),
  acceptedQty: qty0('Accepted'),
  rejectedQty: qty0('Rejected'),
  reworkQty: qty0('Rework'),
  releaseWarehouseId: z.uuid().nullable().optional(),
  rejectWarehouseId: z.uuid().nullable().optional(),
  remarks: optionalText(1000),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

const SYSTEM_META: RequestMeta = { ip: null, userAgent: null, requestId: 'quality' };

/**
 * Quality inspections. Incoming lots are raised when a goods receipt is approved, in-process
 * lots when a job card stops at an operation flagged for inspection, final lots when a
 * production receipt is posted, each for items with an active plan (in-process: also without
 * one). Readings are judged against the plan's limits and its AQL accept / reject numbers; the
 * decision then moves the stock: accepted out of quarantine, rejects and rework to the rejected
 * store (rework also gets a draft rework order).
 */
@Injectable()
export class InspectionsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
    private readonly plans: PlansService,
    private readonly production: ProductionService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.dispose(tx, auth, doc),
    });
    this.documents.addListener('goods_receipt', { onApproved: (tx, auth, doc) => this.fromReceipt(tx, auth, doc) });
    this.documents.addListener('production_entry', { onApproved: (tx, auth, doc) => this.fromProduction(tx, auth, doc) });
    this.production.onCardDone((tx, auth, card, op) => this.fromJobCard(tx, auth, card, op));
  }

  // ---- raising inspections -----------------------------------------------------------------

  private sampling(plan: typeof inspectionPlans.$inferSelect | null, lotQty: string) {
    const lot = Math.max(1, Math.ceil(Number(lotQty)));
    if (!plan || plan.sampling === 'full') return { sampleSize: lot, acceptNo: 0, rejectNo: 1, codeLetter: null };
    if (plan.sampling === 'fixed') return { sampleSize: Math.min(lot, plan.fixedSampleSize ?? 1), acceptNo: 0, rejectNo: 1, codeLetter: null };
    const p = samplingPlan(lot, plan.aql, plan.inspectionLevel as InspectionLevel);
    return { sampleSize: p.sampleSize, acceptNo: p.accept, rejectNo: p.reject, codeLetter: p.letter };
  }

  async raise(
    tx: Transaction,
    auth: AuthContext,
    input: { stage: string; itemId: string; plan: typeof inspectionPlans.$inferSelect | null; lotQty: string; warehouseId?: string | null; batchNo?: string | null; sourceDocId?: string | null; workOrderId?: string | null; operationId?: string | null; jobCardId?: string | null; companyId?: string; branchId?: string | null; remarks?: string | null },
  ) {
    const [it] = await tx.select({ code: items.code }).from(items).where(eq(items.id, input.itemId));
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: input.companyId, branchId: input.branchId ?? null, docDate: todayIST(), title: `${it.code} · ${input.stage.replace('_', '-')} · ${Number(input.lotQty)}`, amount: null });
    await tx.insert(qualityInspections).values({
      id: doc.id,
      tenantId: auth.tenantId,
      stage: input.stage,
      planId: input.plan?.id ?? null,
      itemId: input.itemId,
      sourceDocId: input.sourceDocId ?? null,
      workOrderId: input.workOrderId ?? null,
      operationId: input.operationId ?? null,
      jobCardId: input.jobCardId ?? null,
      warehouseId: input.warehouseId ?? null,
      batchNo: input.batchNo ?? null,
      lotQty: input.lotQty,
      remarks: input.remarks ?? null,
      ...this.sampling(input.plan, input.lotQty),
    });
    return doc;
  }

  private async fromReceipt(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [grn] = await tx.select({ warehouseId: goodsReceipts.warehouseId }).from(goodsReceipts).where(eq(goodsReceipts.id, doc.id));
    const lines = await tx.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.grnId, doc.id)).orderBy(asc(goodsReceiptLines.lineNo));
    for (const l of lines) {
      if (D(l.acceptedBaseQty).cmp(ZERO) <= 0) continue;
      const plan = await this.plans.planFor(tx, l.itemId, 'incoming');
      if (!plan) continue;
      const qi = await this.raise(tx, auth, { stage: 'incoming', itemId: l.itemId, plan, lotQty: l.acceptedBaseQty, warehouseId: grn.warehouseId, batchNo: l.batchNo, sourceDocId: doc.id, companyId: doc.companyId, branchId: doc.branchId });
      await this.documents.activity(tx, auth, doc.id, 'quality', `Inspection raised for line ${l.lineNo}`, { inspectionId: qi.id });
    }
  }

  private async fromProduction(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [e] = await tx.select().from(productionEntries).where(eq(productionEntries.id, doc.id));
    if (e.kind !== 'receipt') return;
    const outs = await tx.select().from(productionEntryLines).where(and(eq(productionEntryLines.entryId, doc.id), eq(productionEntryLines.kind, 'output')));
    for (const l of outs) {
      const plan = await this.plans.planFor(tx, l.itemId, 'final');
      if (!plan) continue;
      await this.raise(tx, auth, { stage: 'final', itemId: l.itemId, plan, lotQty: l.qty, warehouseId: l.warehouseId, batchNo: l.batchNo, sourceDocId: doc.id, workOrderId: e.workOrderId, companyId: doc.companyId, branchId: doc.branchId });
    }
  }

  private async fromJobCard(tx: Transaction, auth: AuthContext, card: JobCardRow, op: OperationRow) {
    if (D(card.goodQty).cmp(ZERO) <= 0) return;
    const [wo] = await tx.select({ itemId: workOrders.itemId, companyId: documents.companyId, branchId: documents.branchId }).from(workOrders).innerJoin(documents, eq(documents.id, workOrders.id)).where(eq(workOrders.id, card.workOrderId));
    const plan = await this.plans.planFor(tx, wo.itemId, 'in_process', op.seq);
    if (!plan && !op.inspection) return;
    await this.raise(tx, auth, { stage: 'in_process', itemId: wo.itemId, plan, lotQty: card.goodQty, workOrderId: card.workOrderId, operationId: op.id, jobCardId: card.id, companyId: wo.companyId, branchId: wo.branchId, remarks: `After ${op.seq} ${op.name}` });
  }

  // ---- API ------------------------------------------------------------------------------------

  list(auth: AuthContext, q: { status?: string; stage?: string; result?: string; q?: string; itemId?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          stage: qualityInspections.stage,
          result: qualityInspections.result,
          suggestion: qualityInspections.suggestion,
          lotQty: qualityInspections.lotQty,
          sampleSize: qualityInspections.sampleSize,
          batchNo: qualityInspections.batchNo,
          item: { id: items.id, code: items.code, name: items.name },
          source: sql<string | null>`(select number from documents s where s.id = ${qualityInspections.sourceDocId})`,
        })
        .from(documents)
        .innerJoin(qualityInspections, eq(qualityInspections.id, documents.id))
        .innerJoin(items, eq(items.id, qualityInspections.itemId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status as 'approved') : undefined,
            q.stage ? eq(qualityInspections.stage, q.stage) : undefined,
            q.result ? eq(qualityInspections.result, q.result) : undefined,
            q.itemId ? eq(qualityInspections.itemId, q.itemId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(items.code, `%${term}%`), ilike(items.name, `%${term}%`), ilike(qualityInspections.batchNo, `%${term}%`)) : undefined,
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
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  /** A lot inspected outside the automatic triggers (customer returns, stock in hand). */
  create(auth: AuthContext, input: CreateInspectionInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ id: items.id }).from(items).where(eq(items.id, input.itemId));
      if (!it) fail([{ path: 'itemId', message: 'Item not found' }]);
      let plan: typeof inspectionPlans.$inferSelect | null = null;
      if (input.planId) {
        [plan] = await tx.select().from(inspectionPlans).where(eq(inspectionPlans.id, input.planId));
        if (!plan || plan.itemId !== input.itemId) fail([{ path: 'planId', message: 'That plan is for another item' }]);
      } else plan = await this.plans.planFor(tx, input.itemId, input.stage);
      if (input.stage !== 'in_process' && !input.warehouseId) fail([{ path: 'warehouseId', message: 'Where is the lot?' }]);
      const doc = await this.raise(tx, auth, { ...input, plan });
      await this.documents.log(tx, auth, doc, 'document.created', meta, { stage: input.stage });
      return this.view(tx, auth, doc);
    });
  }

  /** Replaces the readings and re-judges the lot (drafts only). */
  saveReadings(auth: AuthContext, id: string, input: z.infer<typeof readingsSchema>) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE);
      this.documents.assertEditable(doc);
      const [qi] = await tx.select().from(qualityInspections).where(eq(qualityInspections.id, id));
      const params = qi.planId ? await tx.select().from(inspectionParameters).where(eq(inspectionParameters.planId, qi.planId)) : [];
      const errors: Err[] = [];
      input.readings.forEach((r, i) => {
        if (!params.some((p) => p.id === r.parameterId)) errors.push({ path: `readings.${i}.parameterId`, message: 'Not a characteristic of this plan' });
        if (r.sampleNo > qi.sampleSize) errors.push({ path: `readings.${i}.sampleNo`, message: `Only ${qi.sampleSize} samples are drawn` });
      });
      if (errors.length) fail(errors);
      await tx.delete(inspectionReadings).where(eq(inspectionReadings.inspectionId, id));
      const kept = input.readings.filter((r) => r.value !== null || (r.passed !== undefined && r.passed !== null));
      if (kept.length) await tx.insert(inspectionReadings).values(kept.map((r) => ({ tenantId: auth.tenantId, inspectionId: id, parameterId: r.parameterId, sampleNo: r.sampleNo, value: r.value, passed: r.passed ?? null, note: r.note })));
      const ev = evaluate(params.map((p) => ({ ...p, kind: p.kind as 'numeric' })), kept, { accept: qi.acceptNo, reject: qi.rejectNo });
      await tx.update(qualityInspections).set({ defectives: ev.defectives, suggestion: kept.length ? ev.suggestion : null, inspectedBy: auth.userId }).where(eq(qualityInspections.id, id));
      return this.view(tx, auth, await this.documents.update(tx, auth, doc, {}));
    });
  }

  /** Records the decision and submits it; on approval the stock moves. */
  decide(auth: AuthContext, id: string, input: DecisionInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [qi] = await tx.select().from(qualityInspections).where(eq(qualityInspections.id, id));
      const acc = D(input.acceptedQty);
      const rej = D(input.rejectedQty);
      const rew = D(input.reworkQty);
      const errors: Err[] = [];
      if (acc.add(rej).add(rew).cmp(D(qi.lotQty)) !== 0) errors.push({ path: 'acceptedQty', message: `Accepted, rejected and rework must add up to the lot of ${Number(qi.lotQty)}` });
      const out = rej.add(rew);
      if (qi.warehouseId && out.cmp(ZERO) > 0 && !input.rejectWarehouseId) errors.push({ path: 'rejectWarehouseId', message: 'Choose where rejected goods go' });
      const whIds = [input.releaseWarehouseId, input.rejectWarehouseId].filter((v): v is string => !!v);
      if (whIds.length) {
        const found = await tx.select({ id: warehouses.id }).from(warehouses).where(inArray(warehouses.id, whIds));
        for (const w of whIds) if (!found.some((f) => f.id === w)) errors.push({ path: w === input.releaseWarehouseId ? 'releaseWarehouseId' : 'rejectWarehouseId', message: 'Warehouse not found' });
      }
      if (errors.length) fail(errors);
      const result = rej.isZero() && rew.isZero() ? 'accepted' : acc.isZero() ? 'rejected' : 'partial';
      await tx
        .update(qualityInspections)
        .set({ acceptedQty: acc.toFixed(4), rejectedQty: rej.toFixed(4), reworkQty: rew.toFixed(4), releaseWarehouseId: input.releaseWarehouseId ?? null, rejectWarehouseId: input.rejectWarehouseId ?? null, remarks: input.remarks ?? qi.remarks, result: 'pending', inspectedBy: auth.userId })
        .where(eq(qualityInspections.id, id));
      await this.documents.update(tx, auth, doc, { title: `${(doc.title ?? '').split(' → ')[0]} → ${result}` });
      const fresh = await this.documents.lock(tx, id, DOC_TYPE);
      await this.documents.submit(tx, auth, fresh, meta);
      return this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE));
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      await this.documents.deleteDraft(tx, auth, doc, meta);
    });
  }

  // ---- disposition (approval hook) -----------------------------------------------------------

  private async dispose(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [qi] = await tx.select().from(qualityInspections).where(eq(qualityInspections.id, doc.id));
    const acc = D(qi.acceptedQty);
    const out = D(qi.rejectedQty).add(D(qi.reworkQty));
    const result = out.isZero() ? 'accepted' : acc.isZero() ? 'rejected' : 'partial';

    if (qi.stage === 'in_process' && qi.operationId) {
      // Rejected pieces leave the flow at this operation; rework stays at it.
      const rej = D(qi.rejectedQty);
      if (rej.cmp(ZERO) > 0) {
        await tx
          .update(workOrderOperations)
          .set({ goodQty: sql`greatest(${workOrderOperations.goodQty} - ${rej.toFixed(4)}::numeric, 0)`, rejectQty: sql`${workOrderOperations.rejectQty} + ${rej.toFixed(4)}::numeric`, status: 'in_progress' })
          .where(eq(workOrderOperations.id, qi.operationId));
      }
    } else if (qi.warehouseId) {
      const [it] = await tx.select({ trackSerial: items.trackSerial }).from(items).where(eq(items.id, qi.itemId));
      const moves: { qty: Decimal; to: string }[] = [];
      if (acc.cmp(ZERO) > 0 && qi.releaseWarehouseId && qi.releaseWarehouseId !== qi.warehouseId) moves.push({ qty: acc, to: qi.releaseWarehouseId });
      if (out.cmp(ZERO) > 0 && qi.rejectWarehouseId && qi.rejectWarehouseId !== qi.warehouseId) moves.push({ qty: out, to: qi.rejectWarehouseId });
      if (moves.length && it.trackSerial) throw new ConflictException('Serial-numbered lots are moved with a stock transfer listing the serials; record the decision without warehouses');
      const voucher: Voucher = { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate };
      for (const [i, m] of moves.entries()) {
        const [posted] = await this.stock.post(tx, auth, voucher, [{ itemId: qi.itemId, warehouseId: qi.warehouseId, qty: ZERO.sub(m.qty).toFixed(4), batchNo: qi.batchNo, line: i + 1, allowExpired: true }]);
        await this.stock.post(tx, auth, voucher, [{ itemId: qi.itemId, warehouseId: m.to, qty: m.qty.toFixed(4), rate: posted.rate, batchNo: qi.batchNo, line: i + 1, allowExpired: true }]);
      }
      // Final rejects sent for rework get a draft rework order.
      if (qi.stage === 'final' && D(qi.reworkQty).cmp(ZERO) > 0 && qi.workOrderId && qi.rejectWarehouseId) {
        const [wo] = await tx.select({ targetWarehouseId: workOrders.targetWarehouseId }).from(workOrders).where(eq(workOrders.id, qi.workOrderId));
        const rw = await this.workOrders.createTx(
          tx,
          auth,
          { kind: 'rework', itemId: qi.itemId, qty: qi.reworkQty, parentWorkOrderId: qi.workOrderId, sourceWarehouseId: qi.rejectWarehouseId, targetWarehouseId: qi.releaseWarehouseId ?? wo.targetWarehouseId, priority: 2, backflush: false, notes: `Rework from inspection ${doc.number}` },
          SYSTEM_META,
        );
        await tx.update(qualityInspections).set({ reworkOrderId: rw.id }).where(eq(qualityInspections.id, doc.id));
      }
    }
    await tx.update(qualityInspections).set({ result }).where(eq(qualityInspections.id, doc.id));
  }

  // ---- view -----------------------------------------------------------------------------------

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('quality.inspections.manage'), cancel: false });
    const [qi] = await tx.select().from(qualityInspections).where(eq(qualityInspections.id, doc.id));
    const [item] = await tx.select({ id: items.id, code: items.code, name: items.name, uom: uoms.code }).from(items).innerJoin(uoms, eq(uoms.id, items.baseUomId)).where(eq(items.id, qi.itemId));
    const plan = qi.planId ? (await tx.select().from(inspectionPlans).where(eq(inspectionPlans.id, qi.planId)))[0] : null;
    const params = plan ? await tx.select().from(inspectionParameters).where(eq(inspectionParameters.planId, plan.id)).orderBy(asc(inspectionParameters.seq)) : [];
    const readings = await tx.select().from(inspectionReadings).where(eq(inspectionReadings.inspectionId, doc.id)).orderBy(asc(inspectionReadings.sampleNo));
    const whIds = [qi.warehouseId, qi.releaseWarehouseId, qi.rejectWarehouseId].filter((v): v is string => !!v);
    const whs = whIds.length ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, whIds)) : [];
    const source = qi.sourceDocId ? (await tx.select({ id: documents.id, number: documents.number, docType: documents.docType }).from(documents).where(eq(documents.id, qi.sourceDocId)))[0] : null;
    const wo = qi.workOrderId ? (await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, qi.workOrderId)))[0] : null;
    const op = qi.operationId ? (await tx.select({ seq: workOrderOperations.seq, name: workOrderOperations.name }).from(workOrderOperations).where(eq(workOrderOperations.id, qi.operationId)))[0] : null;
    const vendor = source?.docType === 'goods_receipt' ? (await tx.select({ name: parties.name }).from(goodsReceipts).innerJoin(parties, eq(parties.id, goodsReceipts.vendorId)).where(eq(goodsReceipts.id, source.id)))[0]?.name : null;
    const rework = qi.reworkOrderId ? (await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, qi.reworkOrderId)))[0] : null;
    const wh = (id: string | null) => (id ? (whs.find((w) => w.id === id) ?? null) : null);
    const { tenantId: _t, id: _i, ...rest } = qi;
    return {
      ...header,
      ...rest,
      item,
      plan: plan ? { id: plan.id, code: plan.code, name: plan.name, sampling: plan.sampling, aql: plan.aql, inspectionLevel: plan.inspectionLevel, instructions: plan.instructions } : null,
      parameters: params.map(({ tenantId: _pt, planId: _p, ...x }) => x),
      readings: readings.map(({ tenantId: _rt, inspectionId: _ri, ...r }) => r),
      warehouse: wh(qi.warehouseId),
      releaseWarehouse: wh(qi.releaseWarehouseId),
      rejectWarehouse: wh(qi.rejectWarehouseId),
      source,
      vendor,
      workOrder: wo,
      operation: op,
      reworkOrder: rework,
    };
  }
}
