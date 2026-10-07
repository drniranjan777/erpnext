import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  bomLines,
  bomOperations,
  boms,
  documents,
  formulaLines,
  formulaStages,
  formulas,
  items,
  jobCards,
  parties,
  productionEntries,
  salesOrderLines,
  salesOrders,
  stockBalances,
  stockValuation,
  tools,
  uoms,
  warehouses,
  workCenters,
  workOrderMaterials,
  workOrderOperations,
  workOrders,
  type Transaction,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { activeLines, explode } from './bom-math';
import { BomsService } from './boms.service';
import { outstanding, plannedMinutes, shortages, wipBalance } from './production-math';
import { scale, type Basis, type FormulaData } from '../process/formula-math';

const DOC_TYPE = 'work_order' as const;
const D = Decimal.from;
const ZERO = D('0');

type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

const positive = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v) && Number(v) > 0, `${label} must be more than zero (up to 4 decimals)`);

const woBody = {
  kind: z.enum(['mts', 'mto', 'rework', 'batch']).default('mts'),
  itemId: z.uuid(),
  bomId: z.uuid().nullable().optional(),
  /** Process batches: the formula (blank = the item's default). */
  formulaId: z.uuid().nullable().optional(),
  /** Process batches: lot number for the output. */
  batchNo: optionalText(40),
  qty: positive('Quantity'),
  salesOrderLineId: z.uuid().nullable().optional(),
  parentWorkOrderId: z.uuid().nullable().optional(),
  sourceWarehouseId: z.uuid(),
  targetWarehouseId: z.uuid(),
  docDate: z.iso.date().optional(),
  plannedStart: z.iso.date().nullable().optional(),
  plannedEnd: z.iso.date().nullable().optional(),
  priority: z.number().int().min(1).max(5).default(3),
  backflush: z.boolean().default(false),
  notes: optionalText(2000),
};
export const createWorkOrderSchema = z.object(woBody);
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export const updateWorkOrderSchema = z.object({ ...woBody, version: z.number().int() });
export const releaseSchema = z.object({ version: z.number().int(), force: z.boolean().default(false) });
export const fromSalesOrderSchema = z.object({ sourceWarehouseId: z.uuid().optional(), targetWarehouseId: z.uuid().optional() });

/** Orders whose open materials hold stock (reservations). */
const ACTIVE_STAGES = ['released', 'in_progress', 'completed'];

/**
 * Work orders: what to make, from which BOM, where materials come from and where output goes.
 * Approval releases the order: materials are checked against stock less other orders'
 * reservations, and the standard cost is fixed for variance analysis.
 */
@Injectable()
export class WorkOrdersService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly boms: BomsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, _auth, doc) => this.released(tx, doc),
    });
  }

  list(auth: AuthContext, q: { status?: string; stage?: string; kind?: string; q?: string; itemId?: string; salesOrderId?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          kind: workOrders.kind,
          stage: workOrders.stage,
          batchNo: workOrders.batchNo,
          item: { id: items.id, code: items.code, name: items.name },
          qty: workOrders.qty,
          producedQty: workOrders.producedQty,
          rejectedQty: workOrders.rejectedQty,
          plannedStart: workOrders.plannedStart,
          plannedEnd: workOrders.plannedEnd,
          priority: workOrders.priority,
          salesOrder: sql<string | null>`(select number from documents so where so.id = ${workOrders.salesOrderId})`,
        })
        .from(documents)
        .innerJoin(workOrders, eq(workOrders.id, documents.id))
        .innerJoin(items, eq(items.id, workOrders.itemId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status as 'approved') : undefined,
            q.stage ? eq(workOrders.stage, q.stage) : undefined,
            q.kind ? eq(workOrders.kind, q.kind) : undefined,
            q.itemId ? eq(workOrders.itemId, q.itemId) : undefined,
            q.salesOrderId ? eq(workOrders.salesOrderId, q.salesOrderId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(items.code, `%${term}%`), ilike(items.name, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateWorkOrderInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  async createTx(tx: Transaction, auth: AuthContext, input: CreateWorkOrderInput, meta: RequestMeta) {
    const p = await this.prepare(tx, input);
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: input.docDate ?? todayIST(), title: `${p.item.code} × ${Number(input.qty)}`, amount: null });
    await tx.insert(workOrders).values({ id: doc.id, tenantId: auth.tenantId, ...p.header });
    await this.writeLines(tx, auth, doc.id, p);
    await this.documents.log(tx, auth, doc, 'document.created', meta, { item: p.item.code, qty: input.qty });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: CreateWorkOrderInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const p = await this.prepare(tx, input);
      await tx.update(workOrders).set(p.header).where(eq(workOrders.id, id));
      await tx.delete(workOrderMaterials).where(eq(workOrderMaterials.workOrderId, id));
      await tx.delete(workOrderOperations).where(eq(workOrderOperations.workOrderId, id));
      await this.writeLines(tx, auth, id, p);
      const updated = await this.documents.update(tx, auth, doc, { title: `${p.item.code} × ${Number(input.qty)}`, ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.view(tx, auth, updated);
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      await this.documents.deleteDraft(tx, auth, doc, meta);
    });
  }

  /** Release: refuses shortages unless `force` (the shortages are recorded on the order). */
  release(auth: AuthContext, id: string, version: number, force: boolean, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      this.documents.assertEditable(doc);
      const check = await this.availabilityTx(tx, id);
      const short = check.lines.filter((l) => D(l.short).cmp(ZERO) > 0);
      if (short.length && !force) {
        throw new ConflictException({
          message: `Short of ${short.map((s) => `${s.code} (${Number(s.short)})`).join(', ')}. Release anyway to start with what is there.`,
          shortages: short,
        });
      }
      await tx.update(workOrders).set({ releaseCheck: short.length ? short.map((s) => ({ itemId: s.itemId, code: s.code, required: s.required, available: s.available, short: s.short })) : null }).where(eq(workOrders.id, id));
      await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE));
    });
  }

  /** Cancels an order nothing has been booked against yet. */
  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [entries] = await tx.select({ n: sql<number>`count(*)::int` }).from(productionEntries).innerJoin(documents, eq(documents.id, productionEntries.id)).where(and(eq(productionEntries.workOrderId, id), ne(documents.status, 'cancelled')));
      const [cards] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobCards).where(eq(jobCards.workOrderId, id));
      if (entries.n || cards.n) throw new ConflictException('Materials or time have been booked against this order; close it instead');
      const cancelled = await this.documents.cancel(tx, auth, doc, reason, meta);
      await tx.update(workOrders).set({ stage: 'cancelled' }).where(eq(workOrders.id, id));
      return this.view(tx, auth, cancelled);
    });
  }

  /** Draft work orders for the open lines of an approved sales order whose items have a BOM. */
  fromSalesOrder(auth: AuthContext, salesOrderId: string, input: z.infer<typeof fromSalesOrderSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [so] = await tx.select({ id: salesOrders.id, warehouseId: salesOrders.warehouseId, status: documents.status, number: documents.number }).from(salesOrders).innerJoin(documents, eq(documents.id, salesOrders.id)).where(eq(salesOrders.id, salesOrderId));
      if (!so) throw new NotFoundException('Sales order not found');
      if (so.status !== 'approved') throw new ConflictException('Only approved sales orders can be made to order');
      const wh = input.targetWarehouseId ?? so.warehouseId ?? (await this.firstStore(tx));
      if (!wh) throw new BadRequestException('Choose the warehouse to make into');
      const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, salesOrderId)).orderBy(asc(salesOrderLines.lineNo));
      const created = [];
      const skipped: { lineNo: number; reason: string }[] = [];
      for (const l of lines) {
        const bomId = await this.boms.defaultFor(tx, l.itemId);
        if (!bomId) {
          skipped.push({ lineNo: l.lineNo, reason: 'no approved BOM' });
          continue;
        }
        const open = D(l.qty).sub(D(l.deliveredQty)).mul(D(l.conversionFactor));
        const [planned] = await tx
          .select({ q: sql<string>`coalesce(sum(${workOrders.qty}), 0)::text` })
          .from(workOrders)
          .innerJoin(documents, eq(documents.id, workOrders.id))
          .where(and(eq(workOrders.salesOrderLineId, l.id), ne(documents.status, 'cancelled')));
        const need = open.sub(D(planned.q));
        if (need.cmp(ZERO) <= 0) {
          skipped.push({ lineNo: l.lineNo, reason: 'already planned' });
          continue;
        }
        created.push(
          await this.createTx(
            tx,
            auth,
            { kind: 'mto', itemId: l.itemId, bomId, batchNo: null, qty: need.toFixed(4), salesOrderLineId: l.id, sourceWarehouseId: input.sourceWarehouseId ?? wh, targetWarehouseId: wh, plannedEnd: l.deliveryDate, priority: 2, backflush: false, notes: null },
            meta,
          ),
        );
      }
      return { created: created.map((c) => ({ id: c.id, number: c.displayNumber, qty: c.qty, item: c.item })), skipped };
    });
  }

  private async firstStore(tx: Transaction) {
    const [w] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.type, 'store'), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)).limit(1);
    return w?.id ?? null;
  }

  // ---- building the order from the BOM -------------------------------------------------

  private async prepare(tx: Transaction, input: CreateWorkOrderInput) {
    const errors: Err[] = [];
    const [item] = await tx.select({ id: items.id, code: items.code, name: items.name, type: items.type, baseUomId: items.baseUomId }).from(items).where(eq(items.id, input.itemId));
    if (!item) fail([{ path: 'itemId', message: 'Item not found' }]);
    if (item.type === 'service') errors.push({ path: 'itemId', message: 'Services are not manufactured' });
    const whs = await tx.select({ id: warehouses.id }).from(warehouses).where(inArray(warehouses.id, [input.sourceWarehouseId, input.targetWarehouseId]));
    if (!whs.some((w) => w.id === input.sourceWarehouseId)) errors.push({ path: 'sourceWarehouseId', message: 'Choose the store materials come from' });
    if (!whs.some((w) => w.id === input.targetWarehouseId)) errors.push({ path: 'targetWarehouseId', message: 'Choose the store output goes to' });
    if (input.plannedStart && input.plannedEnd && input.plannedEnd < input.plannedStart) errors.push({ path: 'plannedEnd', message: 'The end is before the start' });

    // Process batches are made from a formula instead of a BOM.
    const batch = input.kind === 'batch';
    let formula: Awaited<ReturnType<WorkOrdersService['formulaFor']>> = null;
    if (batch) {
      formula = await this.formulaFor(tx, input.itemId, input.formulaId ?? null);
      if (!formula) errors.push({ path: 'formulaId', message: input.formulaId ? 'That formula is not an approved formula of this item' : `${item.code} has no approved formula` });
      else if (formula.batchMultiple && D(input.qty).div(D(formula.batchMultiple)).round(0).mul(D(formula.batchMultiple)).cmp(D(input.qty)) !== 0) errors.push({ path: 'qty', message: `Batches of ${item.code} are made in multiples of ${Number(formula.batchMultiple)}` });
    }
    let bomId = batch ? null : (input.bomId ?? null);
    if (batch) {
      // no BOM
    } else if (bomId) {
      const [b] = await tx.select({ itemId: boms.itemId, status: documents.status }).from(boms).innerJoin(documents, eq(documents.id, boms.id)).where(eq(boms.id, bomId));
      if (!b || b.itemId !== input.itemId) errors.push({ path: 'bomId', message: 'That BOM is for another item' });
      else if (b.status !== 'approved') errors.push({ path: 'bomId', message: 'Only approved BOMs can be produced' });
    } else if (input.kind !== 'rework') {
      bomId = await this.boms.defaultFor(tx, input.itemId);
      if (!bomId) errors.push({ path: 'bomId', message: `${item.code} has no approved BOM` });
    }

    let salesOrderId: string | null = null;
    if (input.salesOrderLineId) {
      const [l] = await tx.select({ orderId: salesOrderLines.orderId, itemId: salesOrderLines.itemId, status: documents.status }).from(salesOrderLines).innerJoin(documents, eq(documents.id, salesOrderLines.orderId)).where(eq(salesOrderLines.id, input.salesOrderLineId));
      if (!l) errors.push({ path: 'salesOrderLineId', message: 'Sales order line not found' });
      else if (l.itemId !== input.itemId) errors.push({ path: 'salesOrderLineId', message: 'The sales order line is for another item' });
      else if (l.status !== 'approved') errors.push({ path: 'salesOrderLineId', message: 'The sales order is not approved' });
      else salesOrderId = l.orderId;
    } else if (input.kind === 'mto') errors.push({ path: 'salesOrderLineId', message: 'Make-to-order needs the sales order line' });
    if (input.kind === 'rework' && input.parentWorkOrderId) {
      const [parent] = await tx.select({ itemId: workOrders.itemId }).from(workOrders).where(eq(workOrders.id, input.parentWorkOrderId));
      if (!parent || parent.itemId !== input.itemId) errors.push({ path: 'parentWorkOrderId', message: 'The original order is for another item' });
    }
    if (errors.length) fail(errors);

    const materials: { kind: string; itemId: string; requiredQty: Decimal; operationSeq: number | null; recoveryRate: string | null; basis?: string; stdPotency?: string | null; tolerancePct?: string | null; costSharePct?: string | null }[] = [];
    const add = (m: (typeof materials)[number]) => {
      const same = materials.find((x) => x.kind === m.kind && x.itemId === m.itemId && x.operationSeq === m.operationSeq && x.basis === m.basis);
      if (same) same.requiredQty = same.requiredQty.add(m.requiredQty);
      else materials.push(m);
    };
    let stages: { seq: number; name: string; workCenterId: string; minutes: string; parameters: { name: string; unit: string | null; min: string | null; max: string | null }[]; instructions: string | null }[] = [];
    if (formula) {
      // Ingredients become components, co-products and by-products expected outputs.
      for (const l of scale(formula.data, input.qty)) {
        add({ kind: l.kind === 'ingredient' ? 'component' : l.kind === 'coproduct' ? 'coproduct' : 'byproduct', itemId: l.itemId, requiredQty: D(l.required), operationSeq: l.stageSeq ?? null, recoveryRate: l.recoveryRate ?? null, basis: l.basis, stdPotency: l.stdPotency ?? null, tolerancePct: l.tolerancePct ?? null, costSharePct: l.costSharePct ?? null });
      }
      const factor = D(input.qty).div(D(formula.data.batchSize));
      stages = formula.stages.map((s) => ({ ...s, minutes: D(s.minutes).mul(factor).toFixed(2) }));
    }
    // Rework issues the item itself (from the rejected store) and adds the routing's work.
    if (input.kind === 'rework') add({ kind: 'component', itemId: input.itemId, requiredQty: D(input.qty), operationSeq: null, recoveryRate: null });
    let ops: (typeof bomOperations.$inferSelect)[] = [];
    if (bomId) {
      const [b] = await tx.select().from(boms).where(eq(boms.id, bomId));
      ops = await tx.select().from(bomOperations).where(eq(bomOperations.bomId, bomId)).orderBy(asc(bomOperations.seq));
      if (input.kind !== 'rework') {
        const raw = await tx.select().from(bomLines).where(eq(bomLines.bomId, bomId)).orderBy(asc(bomLines.lineNo));
        const defaults = await this.boms.defaultBoms(tx);
        const used = new Set(activeLines(raw.map((l) => ({ ...l, kind: l.kind as 'component' }))).map((l) => (l as unknown as { id: string }).id));
        for (const l of raw) {
          if (!used.has(l.id)) continue;
          const perOrder = D(l.qty).div(D(b.quantity)).mul(D(input.qty));
          if (l.kind !== 'component') {
            add({ kind: l.kind, itemId: l.itemId, requiredQty: perOrder, operationSeq: l.operationSeq, recoveryRate: l.recoveryRate });
            continue;
          }
          const need = perOrder.mul(D('100').add(D(l.scrapPct))).div(D('100'));
          const child = l.isPhantom ? defaults.get(l.itemId) : undefined;
          if (child) {
            for (const r of explode(child, need.toFixed(6), (id) => defaults.get(id) ?? null).requirements) add({ kind: 'component', itemId: r.itemId, requiredQty: D(r.qty), operationSeq: l.operationSeq, recoveryRate: null });
          } else add({ kind: 'component', itemId: l.itemId, requiredQty: need, operationSeq: l.operationSeq, recoveryRate: null });
        }
      }
    }
    const ids = [...new Set(materials.map((m) => m.itemId))];
    const its = ids.length ? await tx.select({ id: items.id, baseUomId: items.baseUomId }).from(items).where(inArray(items.id, ids)) : [];
    return {
      item: item!,
      header: {
        kind: input.kind,
        itemId: input.itemId,
        bomId,
        formulaId: formula?.id ?? null,
        batchNo: batch ? (input.batchNo ?? null) : null,
        qty: input.qty,
        salesOrderId,
        salesOrderLineId: input.salesOrderLineId ?? null,
        parentWorkOrderId: input.kind === 'rework' ? (input.parentWorkOrderId ?? null) : null,
        sourceWarehouseId: input.sourceWarehouseId,
        targetWarehouseId: input.targetWarehouseId,
        plannedStart: input.plannedStart ?? null,
        plannedEnd: input.plannedEnd ?? null,
        priority: input.priority,
        backflush: input.backflush,
        notes: input.notes,
      },
      materials: materials.map((m, i) => ({ lineNo: i + 1, kind: m.kind, itemId: m.itemId, uomId: its.find((x) => x.id === m.itemId)!.baseUomId, requiredQty: m.requiredQty.toFixed(4), operationSeq: m.operationSeq, recoveryRate: m.recoveryRate, basis: m.basis ?? null, stdPotency: m.stdPotency ?? null, tolerancePct: m.tolerancePct ?? null, costSharePct: m.costSharePct ?? null })),
      operations: [
        ...stages.map((s) => ({
          seq: s.seq,
          name: s.name,
          workCenterId: s.workCenterId,
          toolId: null,
          setupMinutes: '0',
          runMinutes: '0',
          plannedMinutes: s.minutes,
          isSubcontract: false,
          vendorId: null,
          subcontractRate: null,
          inspection: false,
          instructions: s.instructions,
          parameters: s.parameters.length ? s.parameters : null,
        })),
        ...ops.map((o) => ({
        seq: o.seq,
        name: o.name,
        workCenterId: o.workCenterId,
        toolId: o.toolId,
        setupMinutes: o.setupMinutes,
        runMinutes: o.runMinutes,
        plannedMinutes: o.isSubcontract ? '0' : plannedMinutes(o.setupMinutes, o.runMinutes, input.qty),
        isSubcontract: o.isSubcontract,
        vendorId: o.vendorId,
        subcontractRate: o.subcontractRate,
        inspection: o.inspection,
        instructions: o.instructions,
        parameters: null,
      })),
      ],
    };
  }

  /** The approved formula a batch is made from (the given one, or the item's default) with its data. */
  async formulaFor(tx: Transaction, itemId: string, formulaId: string | null) {
    const [f] = await tx
      .select({ f: formulas })
      .from(formulas)
      .innerJoin(documents, eq(documents.id, formulas.id))
      .where(and(eq(formulas.itemId, itemId), eq(documents.status, 'approved'), formulaId ? eq(formulas.id, formulaId) : eq(formulas.isDefault, true)))
      .limit(1);
    if (!f) return null;
    const lines = await tx.select().from(formulaLines).where(eq(formulaLines.formulaId, f.f.id)).orderBy(asc(formulaLines.lineNo));
    const stages = await tx.select().from(formulaStages).where(eq(formulaStages.formulaId, f.f.id)).orderBy(asc(formulaStages.seq));
    const data: FormulaData = {
      itemId: f.f.itemId,
      batchSize: f.f.batchSize,
      yieldPct: f.f.yieldPct,
      lines: lines.map((l) => ({ kind: l.kind as 'ingredient', itemId: l.itemId, basis: l.basis as Basis, qty: l.qty, stdPotency: l.stdPotency, tolerancePct: l.tolerancePct, costSharePct: l.costSharePct, recoveryRate: l.recoveryRate, stageSeq: l.stageSeq })),
      stages: stages.map((s) => ({ seq: s.seq, workCenterId: s.workCenterId, minutes: s.minutes })),
    };
    return { id: f.f.id, batchMultiple: f.f.batchMultiple, formula: f.f, data, stages: stages.map((s) => ({ seq: s.seq, name: s.name, workCenterId: s.workCenterId, minutes: s.minutes, parameters: s.parameters, instructions: s.instructions })) };
  }

  private async writeLines(tx: Transaction, auth: AuthContext, woId: string, p: Awaited<ReturnType<WorkOrdersService['prepare']>>) {
    if (p.materials.length) await tx.insert(workOrderMaterials).values(p.materials.map((m) => ({ ...m, tenantId: auth.tenantId, workOrderId: woId })));
    if (p.operations.length) await tx.insert(workOrderOperations).values(p.operations.map((o) => ({ ...o, tenantId: auth.tenantId, workOrderId: woId })));
  }

  /** Approval hook: the order is released and its standard cost fixed. */
  private async released(tx: Transaction, doc: DocumentRow) {
    const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, doc.id));
    const mats = await tx.select().from(workOrderMaterials).where(eq(workOrderMaterials.workOrderId, doc.id));
    const costs = await this.itemCosts(tx, mats.map((m) => m.itemId).concat(wo.itemId));
    for (const m of mats) {
      const rate = m.kind === 'component' ? (costs.get(m.itemId) ?? '0') : (m.recoveryRate ?? '0');
      await tx.update(workOrderMaterials).set({ stdRate: rate }).where(eq(workOrderMaterials.id, m.id));
    }
    let std = { stdMaterial: '0', stdOperation: '0', stdSubcontract: '0', stdByproduct: '0', stdUnitCost: '0' };
    if (wo.kind === 'rework') {
      // Rework is costed at actual: the item's own value plus the work done on it.
    } else if (wo.formulaId) {
      const [f] = await tx.select().from(formulas).where(eq(formulas.id, wo.formulaId));
      const [it] = await tx.select({ standardCost: items.standardCost }).from(items).where(eq(items.id, wo.itemId));
      std = { stdMaterial: f.materialCost, stdOperation: f.conversionCost, stdSubcontract: '0', stdByproduct: '0', stdUnitCost: it?.standardCost && D(it.standardCost).cmp(ZERO) > 0 ? it.standardCost : f.unitCost };
    } else if (wo.bomId) {
      const [b] = await tx.select().from(boms).where(eq(boms.id, wo.bomId));
      const [it] = await tx.select({ standardCost: items.standardCost }).from(items).where(eq(items.id, wo.itemId));
      std = { stdMaterial: b.materialCost, stdOperation: b.operationCost, stdSubcontract: b.subcontractCost, stdByproduct: b.byproductCredit, stdUnitCost: it?.standardCost && D(it.standardCost).cmp(ZERO) > 0 ? it.standardCost : b.unitCost };
    }
    await tx.update(workOrders).set({ ...std, stage: 'released' }).where(eq(workOrders.id, doc.id));
  }

  /** Standard cost, else average stock cost, else last purchase rate (as the BOM roll-up does). */
  async itemCosts(tx: Transaction, ids: string[]) {
    const list = [...new Set(ids)];
    const out = new Map<string, string>();
    if (!list.length) return out;
    const its = await tx.select({ id: items.id, standardCost: items.standardCost, lastPurchaseRate: items.lastPurchaseRate }).from(items).where(inArray(items.id, list));
    const pools = await tx
      .select({ itemId: stockValuation.itemId, qty: sql<string>`sum(${stockValuation.qty})::text`, value: sql<string>`sum(${stockValuation.value})::text` })
      .from(stockValuation)
      .where(inArray(stockValuation.itemId, list))
      .groupBy(stockValuation.itemId);
    for (const it of its) {
      const p = pools.find((x) => x.itemId === it.id);
      const avg = p && D(p.qty).cmp(ZERO) > 0 ? D(p.value).div(D(p.qty)).toFixed(4) : null;
      const c = it.standardCost && D(it.standardCost).cmp(ZERO) > 0 ? it.standardCost : (avg ?? it.lastPurchaseRate);
      if (c) out.set(it.id, c);
    }
    return out;
  }

  // ---- availability ---------------------------------------------------------------------

  availability(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.availabilityTx(tx, id));
  }

  /** Outstanding components against stock in the source store less other active orders' reservations. */
  async availabilityTx(tx: Transaction, id: string) {
    const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, id));
    if (!wo) throw new NotFoundException('Work order not found');
    const mats = await tx
      .select({ m: workOrderMaterials, code: items.code, name: items.name, uom: uoms.code })
      .from(workOrderMaterials)
      .innerJoin(items, eq(items.id, workOrderMaterials.itemId))
      .innerJoin(uoms, eq(uoms.id, workOrderMaterials.uomId))
      .where(and(eq(workOrderMaterials.workOrderId, id), eq(workOrderMaterials.kind, 'component')))
      .orderBy(asc(workOrderMaterials.lineNo));
    const ids = [...new Set(mats.map((x) => x.m.itemId))];
    const onHand = new Map<string, string>();
    const reserved = new Map<string, string>();
    if (ids.length) {
      const bal = await tx
        .select({ itemId: stockBalances.itemId, q: sql<string>`sum(${stockBalances.qty})::text` })
        .from(stockBalances)
        .where(and(inArray(stockBalances.itemId, ids), eq(stockBalances.warehouseId, wo.sourceWarehouseId)))
        .groupBy(stockBalances.itemId);
      for (const b of bal) onHand.set(b.itemId, b.q);
      const res = await tx
        .select({ itemId: workOrderMaterials.itemId, q: sql<string>`sum(greatest(${workOrderMaterials.requiredQty} - ${workOrderMaterials.issuedQty}, 0))::text` })
        .from(workOrderMaterials)
        .innerJoin(workOrders, eq(workOrders.id, workOrderMaterials.workOrderId))
        .where(and(inArray(workOrderMaterials.itemId, ids), eq(workOrderMaterials.kind, 'component'), eq(workOrders.sourceWarehouseId, wo.sourceWarehouseId), inArray(workOrders.stage, ACTIVE_STAGES), ne(workOrders.id, id)))
        .groupBy(workOrderMaterials.itemId);
      for (const r of res) reserved.set(r.itemId, r.q);
    }
    // Aggregate per item (an item can be issued at several operations).
    const needs = new Map<string, Decimal>();
    for (const x of mats) needs.set(x.m.itemId, (needs.get(x.m.itemId) ?? ZERO).add(D(outstanding(x.m))));
    const result = shortages([...needs.entries()].map(([itemId, q]) => ({ itemId, outstanding: q.toFixed(4) })), onHand, reserved);
    return {
      warehouseId: wo.sourceWarehouseId,
      lines: result.map((r) => {
        const x = mats.find((m) => m.m.itemId === r.itemId)!;
        return { ...r, code: x.code, name: x.name, uom: x.uom, onHand: onHand.get(r.itemId) ?? '0', reserved: reserved.get(r.itemId) ?? '0' };
      }),
    };
  }

  // ---- view -----------------------------------------------------------------------------

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('manufacturing.production.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: manage });
    const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, doc.id));
    const [item] = await tx.select({ id: items.id, code: items.code, name: items.name, uom: uoms.code }).from(items).innerJoin(uoms, eq(uoms.id, items.baseUomId)).where(eq(items.id, wo.itemId));
    const whs = await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, [wo.sourceWarehouseId, wo.targetWarehouseId]));
    const materials = await tx
      .select({ m: workOrderMaterials, code: items.code, name: items.name, uom: uoms.code, trackBatch: items.trackBatch, trackSerial: items.trackSerial, isStockItem: items.isStockItem })
      .from(workOrderMaterials)
      .innerJoin(items, eq(items.id, workOrderMaterials.itemId))
      .innerJoin(uoms, eq(uoms.id, workOrderMaterials.uomId))
      .where(eq(workOrderMaterials.workOrderId, doc.id))
      .orderBy(asc(workOrderMaterials.lineNo));
    const ops = await tx
      .select({ o: workOrderOperations, workCenter: workCenters.code, workCenterName: workCenters.name, tool: tools.code, vendor: parties.name })
      .from(workOrderOperations)
      .innerJoin(workCenters, eq(workCenters.id, workOrderOperations.workCenterId))
      .leftJoin(tools, eq(tools.id, workOrderOperations.toolId))
      .leftJoin(parties, eq(parties.id, workOrderOperations.vendorId))
      .where(eq(workOrderOperations.workOrderId, doc.id))
      .orderBy(asc(workOrderOperations.seq));
    const entries = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, kind: productionEntries.kind, goodQty: productionEntries.goodQty, rejectQty: productionEntries.rejectQty, materialValue: productionEntries.materialValue, conversionValue: productionEntries.conversionValue, subcontractValue: productionEntries.subcontractValue, outputValue: productionEntries.outputValue, varianceValue: productionEntries.varianceValue })
      .from(productionEntries)
      .innerJoin(documents, eq(documents.id, productionEntries.id))
      .where(and(eq(productionEntries.workOrderId, doc.id), notInArray(documents.status, ['draft'])))
      .orderBy(asc(documents.createdAt));
    const so = wo.salesOrderId ? (await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, wo.salesOrderId)))[0] : null;
    const bom = wo.bomId ? (await tx.select({ id: boms.id, number: documents.number, version: boms.version }).from(boms).innerJoin(documents, eq(documents.id, boms.id)).where(eq(boms.id, wo.bomId)))[0] : null;
    const parent = wo.parentWorkOrderId ? (await tx.select({ id: documents.id, number: documents.number }).from(documents).where(eq(documents.id, wo.parentWorkOrderId)))[0] : null;
    const reworks = await tx.select({ id: documents.id, number: documents.number, status: documents.status }).from(workOrders).innerJoin(documents, eq(documents.id, workOrders.id)).where(and(eq(workOrders.parentWorkOrderId, doc.id), isNull(documents.cancelledAt)));
    const { tenantId: _t, id: _i, ...rest } = wo;
    const open = ['released', 'in_progress', 'completed'].includes(wo.stage) && doc.status === 'approved';
    return {
      ...header,
      ...rest,
      item,
      bom,
      salesOrder: so,
      parent,
      reworks,
      source: whs.find((w) => w.id === wo.sourceWarehouseId),
      target: whs.find((w) => w.id === wo.targetWarehouseId),
      wip: wipBalance(wo).toFixed(2),
      materials: materials.map(({ m: { tenantId: _mt, workOrderId: _w, ...m }, ...more }) => ({ ...m, ...more, outstanding: m.kind === 'component' ? outstanding(m) : null })),
      operations: ops.map(({ o: { tenantId: _ot, workOrderId: _w2, ...o }, ...more }) => ({ ...o, ...more })),
      entries,
      canProduce: open && manage,
      canRecord: open && perms.has('manufacturing.shopfloor.record'),
      canClose: open && manage,
    };
  }
}
