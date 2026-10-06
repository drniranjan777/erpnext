import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  documents,
  items,
  jobCards,
  machines,
  productionEntries,
  productionEntryLines,
  tools,
  uoms,
  users,
  warehouses,
  workCenters,
  workOrderMaterials,
  workOrderOperations,
  workOrders,
  type Transaction,
} from '@nextgen/database';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService, type StockMove, type Voucher } from '../inventory/stock.service';
import { backflushQty, OVER_PRODUCTION, outputValue, shotsFor, timeCost, variances, wipBalance } from './production-math';

const DOC_TYPE = 'production_entry' as const;
const D = Decimal.from;
const ZERO = D('0');
const neg = (d: Decimal) => ZERO.sub(d);

type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

const qty = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), `${label}: a number with up to 4 decimals`);
const qty0 = (label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || String(v).trim() === '' ? '0' : String(v).trim()))
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), `${label}: a number with up to 4 decimals`);
const serials = z.array(z.string().trim().min(1).max(60)).max(1000).nullable().optional();

export const issueSchema = z.object({
  docDate: z.iso.date().optional(),
  /** Issue everything still outstanding (stock items, FEFO batches). */
  all: z.boolean().default(false),
  lines: z.array(z.object({ materialId: z.uuid(), qty: qty('Quantity'), batchNo: optionalText(40), serialNos: serials })).max(300).default([]),
  notes: optionalText(1000),
});
export type IssueInput = z.infer<typeof issueSchema>;

export const returnSchema = z.object({
  docDate: z.iso.date().optional(),
  lines: z.array(z.object({ materialId: z.uuid(), qty: qty('Quantity'), batchNo: optionalText(40), serialNos: serials })).min(1, 'Add what is being returned').max(300),
  notes: optionalText(1000),
});

export const receiptSchema = z.object({
  docDate: z.iso.date().optional(),
  goodQty: qty0('Good quantity'),
  rejectQty: qty0('Rejected quantity'),
  /** Rejects go here to be reworked; blank = scrapped (their cost stays in WIP as a variance). */
  rejectWarehouseId: z.uuid().nullable().optional(),
  batchNo: optionalText(40),
  serialNos: serials,
  byproducts: z.array(z.object({ materialId: z.uuid(), qty: qty('Quantity') })).max(50).default([]),
  notes: optionalText(1000),
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

export const startCardSchema = z.object({
  operationId: z.uuid(),
  operatorName: optionalText(120),
  machineId: z.uuid().nullable().optional(),
  toolId: z.uuid().nullable().optional(),
});
export const stopCardSchema = z.object({
  goodQty: qty0('Good quantity'),
  rejectQty: qty0('Rejected quantity'),
  /** Blank = the time between start and stop. */
  minutes: z.union([z.string(), z.number()]).nullable().optional().transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())).refine((v) => v === null || /^\d{1,6}(\.\d{1,2})?$/.test(v), 'Minutes: a number'),
  shots: z.number().int().min(0).nullable().optional(),
  rejectReason: optionalText(300),
  jobWorkChallanId: z.uuid().nullable().optional(),
  notes: optionalText(1000),
});
export const recordCardSchema = startCardSchema.extend(stopCardSchema.shape);

const OPEN = ['released', 'in_progress', 'completed'];

/**
 * Production: material issues and returns, output receipts (with backflush, by-products and
 * rejects), job cards on the shop floor, and closing. Every movement is a production entry
 * document so stock and the ledger move together; WIP is carried on the work order.
 */
export type JobCardRow = typeof jobCards.$inferSelect;
export type OperationRow = typeof workOrderOperations.$inferSelect;
type CardListener = (tx: Transaction, auth: AuthContext, card: JobCardRow, op: OperationRow) => Promise<void>;

@Injectable()
export class ProductionService implements OnModuleInit {
  private readonly cardListeners: CardListener[] = [];

  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
    });
  }

  /** Followers of finished job cards (in-process inspection), run in the same transaction. */
  onCardDone(listener: CardListener) {
    this.cardListeners.push(listener);
  }

  // ---- entries ----------------------------------------------------------------------------

  private async openOrder(tx: Transaction, woId: string, lock = false) {
    const q = tx.select({ wo: workOrders, doc: documents }).from(workOrders).innerJoin(documents, eq(documents.id, workOrders.id)).where(eq(workOrders.id, woId));
    const [r] = lock ? await q.for('update', { of: workOrders }) : await q;
    if (!r) throw new NotFoundException('Work order not found');
    if (r.doc.status !== 'approved' || !OPEN.includes(r.wo.stage)) throw new ConflictException(`Work order ${r.doc.number ?? ''} is not open for production`);
    return r;
  }

  private async materials(tx: Transaction, woId: string) {
    return tx
      .select({ m: workOrderMaterials, code: items.code, isStockItem: items.isStockItem, trackBatch: items.trackBatch, trackSerial: items.trackSerial, decimals: uoms.decimals })
      .from(workOrderMaterials)
      .innerJoin(items, eq(items.id, workOrderMaterials.itemId))
      .innerJoin(uoms, eq(uoms.id, workOrderMaterials.uomId))
      .where(eq(workOrderMaterials.workOrderId, woId))
      .orderBy(asc(workOrderMaterials.lineNo));
  }

  /** Splits a batch-tracked issue over the batches in stock, earliest expiry first. */
  private async allocate(tx: Transaction, itemId: string, warehouseId: string, need: Decimal) {
    const out: { batchNo: string; qty: string }[] = [];
    let left = need;
    for (const b of await this.stock.availableBatches(tx, itemId, warehouseId)) {
      if (left.cmp(ZERO) <= 0) break;
      const take = D(b.qty).cmp(left) < 0 ? D(b.qty) : left;
      out.push({ batchNo: b.batchNo, qty: take.toFixed(4) });
      left = left.sub(take);
    }
    if (left.cmp(ZERO) > 0) out.push({ batchNo: '', qty: left.toFixed(4) });
    return out;
  }

  private roundFor(q: Decimal, decimals: number) {
    if (decimals === 0) return D(String(Math.ceil(Number(q.toFixed(4)) - 1e-9)));
    return q.round(Math.min(decimals, 4));
  }

  private async createEntry(
    tx: Transaction,
    auth: AuthContext,
    wo: { wo: typeof workOrders.$inferSelect; doc: DocumentRow },
    kind: 'issue' | 'return' | 'receipt' | 'close',
    head: { docDate?: string; goodQty?: string; rejectQty?: string; notes?: string | null },
    lines: Omit<typeof productionEntryLines.$inferInsert, 'tenantId' | 'entryId' | 'lineNo'>[],
    meta: RequestMeta,
  ) {
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: wo.doc.companyId, branchId: wo.doc.branchId, docDate: head.docDate ?? todayIST(), title: `${kind[0].toUpperCase()}${kind.slice(1)} · ${wo.doc.number}`, amount: null });
    await tx.insert(productionEntries).values({ id: doc.id, tenantId: auth.tenantId, workOrderId: wo.wo.id, kind, goodQty: head.goodQty ?? '0', rejectQty: head.rejectQty ?? '0', notes: head.notes ?? null });
    if (lines.length) await tx.insert(productionEntryLines).values(lines.map((l, i) => ({ ...l, tenantId: auth.tenantId, entryId: doc.id, lineNo: i + 1 })));
    await this.documents.log(tx, auth, doc, 'document.created', meta, { kind, workOrder: wo.doc.number });
    await this.documents.submit(tx, auth, doc, meta);
    await this.documents.activity(tx, auth, wo.wo.id, 'production', `${kind === 'issue' ? 'Materials issued' : kind === 'return' ? 'Materials returned' : kind === 'receipt' ? 'Output received' : 'Closed'} (${doc.number ?? 'entry'})`);
    return this.entryView(tx, auth, await this.documents.find(tx, doc.id, DOC_TYPE));
  }

  issue(auth: AuthContext, woId: string, input: IssueInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const wo = await this.openOrder(tx, woId, true);
      const mats = await this.materials(tx, woId);
      const errors: Err[] = [];
      const lines: Omit<typeof productionEntryLines.$inferInsert, 'tenantId' | 'entryId' | 'lineNo'>[] = [];
      const push = async (x: (typeof mats)[number], q: Decimal, batchNo: string | null | undefined, serialNos: string[] | null | undefined) => {
        if (x.trackBatch && !batchNo) {
          for (const a of await this.allocate(tx, x.m.itemId, wo.wo.sourceWarehouseId, q)) lines.push({ kind: 'material', materialId: x.m.id, itemId: x.m.itemId, warehouseId: wo.wo.sourceWarehouseId, qty: a.qty, batchNo: a.batchNo || null });
        } else lines.push({ kind: 'material', materialId: x.m.id, itemId: x.m.itemId, warehouseId: wo.wo.sourceWarehouseId, qty: q.toFixed(4), batchNo: batchNo ?? null, serialNos: serialNos ?? null });
      };
      if (input.all) {
        for (const x of mats) {
          if (x.m.kind !== 'component' || !x.isStockItem) continue;
          const q = this.roundFor(D(x.m.requiredQty).sub(D(x.m.issuedQty)), x.decimals);
          if (q.cmp(ZERO) <= 0) continue;
          if (x.trackSerial) {
            errors.push({ path: 'all', message: `${x.code} is serial-tracked; issue it with its serial numbers` });
            continue;
          }
          await push(x, q, null, null);
        }
      }
      for (const [i, l] of input.lines.entries()) {
        const x = mats.find((m) => m.m.id === l.materialId);
        if (!x || x.m.kind !== 'component') errors.push({ path: `lines.${i}.materialId`, message: `Line ${i + 1}: not a material of this order` });
        else if (!x.isStockItem) errors.push({ path: `lines.${i}.materialId`, message: `Line ${i + 1}: ${x.code} is not a stock item` });
        else if (D(l.qty).cmp(ZERO) > 0) await push(x, D(l.qty), l.batchNo, l.serialNos);
      }
      if (errors.length) fail(errors);
      if (!lines.length) throw new BadRequestException('Nothing to issue');
      return this.createEntry(tx, auth, wo, 'issue', { docDate: input.docDate, notes: input.notes }, lines, meta);
    });
  }

  return(auth: AuthContext, woId: string, input: z.infer<typeof returnSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const wo = await this.openOrder(tx, woId, true);
      const mats = await this.materials(tx, woId);
      const errors: Err[] = [];
      input.lines.forEach((l, i) => {
        const x = mats.find((m) => m.m.id === l.materialId);
        if (!x || x.m.kind !== 'component') errors.push({ path: `lines.${i}.materialId`, message: `Line ${i + 1}: not a material of this order` });
        else if (D(l.qty).cmp(D(x.m.issuedQty)) > 0) errors.push({ path: `lines.${i}.qty`, message: `Line ${i + 1}: only ${Number(x.m.issuedQty)} of ${x.code} has been issued` });
      });
      if (errors.length) fail(errors);
      const lines = input.lines.filter((l) => D(l.qty).cmp(ZERO) > 0).map((l) => {
        const x = mats.find((m) => m.m.id === l.materialId)!;
        return { kind: 'material', materialId: x.m.id, itemId: x.m.itemId, warehouseId: wo.wo.sourceWarehouseId, qty: l.qty, batchNo: l.batchNo, serialNos: l.serialNos ?? null };
      });
      if (!lines.length) throw new BadRequestException('Nothing to return');
      return this.createEntry(tx, auth, wo, 'return', { docDate: input.docDate, notes: input.notes }, lines, meta);
    });
  }

  receive(auth: AuthContext, woId: string, input: ReceiptInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const wo = await this.openOrder(tx, woId, true);
      const w = wo.wo;
      const good = D(input.goodQty);
      const rej = D(input.rejectQty);
      const errors: Err[] = [];
      if (good.isZero() && rej.isZero() && !input.byproducts.length) fail([{ path: 'goodQty', message: 'Enter the quantity made' }]);
      // Output cannot run ahead of the last operation, nor far past the order.
      const ops = await tx.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, woId)).orderBy(desc(workOrderOperations.seq));
      const made = D(w.producedQty).add(D(w.rejectedQty));
      if (ops.length && good.add(rej).add(made).cmp(D(ops[0].goodQty)) > 0) {
        errors.push({ path: 'goodQty', message: `Only ${Number(ops[0].goodQty)} have passed the last operation (${ops[0].name}); ${Number(made)} already received` });
      }
      if (D(w.producedQty).add(good).cmp(D(w.qty).mul(D('1').add(OVER_PRODUCTION))) > 0) errors.push({ path: 'goodQty', message: `That is more than 10% over the ordered ${Number(w.qty)}` });
      if (input.rejectWarehouseId) {
        const [wh] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, input.rejectWarehouseId));
        if (!wh) errors.push({ path: 'rejectWarehouseId', message: 'Warehouse not found' });
      }
      const mats = await this.materials(tx, woId);
      for (const [i, b] of input.byproducts.entries()) {
        const x = mats.find((m) => m.m.id === b.materialId);
        if (!x || x.m.kind === 'component') errors.push({ path: `byproducts.${i}.materialId`, message: `Line ${i + 1}: not a by-product or scrap of this order` });
        else if (!x.isStockItem) errors.push({ path: `byproducts.${i}.materialId`, message: `Line ${i + 1}: ${x.code} is not a stock item` });
      }
      if (errors.length) fail(errors);

      const lines: Omit<typeof productionEntryLines.$inferInsert, 'tenantId' | 'entryId' | 'lineNo'>[] = [];
      if (w.backflush) {
        const after = made.add(good).add(rej).toFixed(4);
        for (const x of mats) {
          if (x.m.kind !== 'component' || !x.isStockItem) continue;
          const q = this.roundFor(D(backflushQty(x.m, w.qty, after)), x.decimals);
          if (q.cmp(ZERO) <= 0) continue;
          if (x.trackSerial) fail([{ path: 'goodQty', message: `${x.code} is serial-tracked and cannot be backflushed; issue it first` }]);
          if (x.trackBatch) {
            for (const a of await this.allocate(tx, x.m.itemId, w.sourceWarehouseId, q)) lines.push({ kind: 'material', materialId: x.m.id, itemId: x.m.itemId, warehouseId: w.sourceWarehouseId, qty: a.qty, batchNo: a.batchNo || null, backflushed: true });
          } else lines.push({ kind: 'material', materialId: x.m.id, itemId: x.m.itemId, warehouseId: w.sourceWarehouseId, qty: q.toFixed(4), backflushed: true });
        }
      }
      for (const b of input.byproducts) {
        const x = mats.find((m) => m.m.id === b.materialId)!;
        if (D(b.qty).cmp(ZERO) > 0) lines.push({ kind: x.m.kind, materialId: x.m.id, itemId: x.m.itemId, warehouseId: w.targetWarehouseId, qty: b.qty, rate: x.m.recoveryRate ?? '0' });
      }
      if (good.cmp(ZERO) > 0) lines.push({ kind: 'output', itemId: w.itemId, warehouseId: w.targetWarehouseId, qty: good.toFixed(4), batchNo: input.batchNo, serialNos: input.serialNos ?? null });
      if (rej.cmp(ZERO) > 0 && input.rejectWarehouseId) lines.push({ kind: 'reject', itemId: w.itemId, warehouseId: input.rejectWarehouseId, qty: rej.toFixed(4), batchNo: input.batchNo });
      return this.createEntry(tx, auth, wo, 'receipt', { docDate: input.docDate, goodQty: good.toFixed(4), rejectQty: rej.toFixed(4), notes: input.notes }, lines, meta);
    });
  }

  /** Absorbs what is left, writes the WIP balance off as a variance and closes the order. */
  close(auth: AuthContext, woId: string, input: { docDate?: string; notes?: string | null }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const wo = await this.openOrder(tx, woId, true);
      const [running] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobCards).where(and(eq(jobCards.workOrderId, woId), eq(jobCards.status, 'running')));
      if (running.n) throw new ConflictException('Stop the running job cards first');
      return this.createEntry(tx, auth, wo, 'close', { docDate: input.docDate, notes: input.notes }, [], meta);
    });
  }

  // ---- posting (approval hook) -------------------------------------------------------------

  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [e] = await tx.select().from(productionEntries).where(eq(productionEntries.id, doc.id));
    const [w] = await tx.select().from(workOrders).where(eq(workOrders.id, e.workOrderId)).for('update');
    const lines = await tx.select().from(productionEntryLines).where(eq(productionEntryLines.entryId, doc.id)).orderBy(asc(productionEntryLines.lineNo));
    const voucher: Voucher = { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate };
    const move = (l: (typeof lines)[number], sign: 1 | -1, rate: string | null): StockMove => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      qty: sign === 1 ? l.qty : neg(D(l.qty)).toFixed(4),
      rate,
      batchNo: l.batchNo,
      serialNos: l.serialNos,
      line: l.lineNo,
    });
    const record = async (l: (typeof lines)[number], value: Decimal) => {
      const abs = value.abs();
      await tx.update(productionEntryLines).set({ amount: abs.toFixed(2), rate: D(l.qty).isZero() ? '0' : abs.div(D(l.qty)).toFixed(4) }).where(eq(productionEntryLines.id, l.id));
    };

    const totals = { material: ZERO, conversion: ZERO, subcontract: ZERO, byproduct: ZERO, output: ZERO, variance: ZERO };
    const patch: Partial<typeof workOrders.$inferInsert> = {};

    // Materials into WIP (issues, backflush) or back to stock (returns).
    const mats = lines.filter((l) => l.kind === 'material');
    if (mats.length) {
      const sign = e.kind === 'return' ? 1 : -1;
      const posted = await this.stock.post(tx, auth, voucher, mats.map((l) => move(l, sign, null)));
      for (const [i, l] of mats.entries()) {
        const v = D(posted[i].value);
        await record(l, v);
        totals.material = totals.material.sub(v);
        await tx
          .update(workOrderMaterials)
          .set({ issuedQty: sql`${workOrderMaterials.issuedQty} + ${sign === -1 ? l.qty : neg(D(l.qty)).toFixed(4)}::numeric` })
          .where(eq(workOrderMaterials.id, l.materialId!));
      }
    }

    // Time and job work booked on the shop floor since the last receipt.
    if (e.kind === 'receipt' || e.kind === 'close') {
      const cards = await tx.select().from(jobCards).where(and(eq(jobCards.workOrderId, w.id), eq(jobCards.status, 'done'), isNull(jobCards.absorbedIn)));
      for (const c of cards) {
        totals.conversion = totals.conversion.add(D(c.labourCost)).add(D(c.machineCost)).add(D(c.overheadCost));
        totals.subcontract = totals.subcontract.add(D(c.subcontractCost));
      }
      if (cards.length) await tx.update(jobCards).set({ absorbedIn: doc.id }).where(inArray(jobCards.id, cards.map((c) => c.id)));
    }

    // By-products and scrap at their recovery rates.
    const byp = lines.filter((l) => l.kind === 'byproduct' || l.kind === 'scrap');
    if (byp.length) {
      const posted = await this.stock.post(tx, auth, voucher, byp.map((l) => move(l, 1, l.rate && D(l.rate).cmp(ZERO) > 0 ? l.rate : null)));
      for (const [i, l] of byp.entries()) {
        const v = D(posted[i].value);
        await record(l, v);
        totals.byproduct = totals.byproduct.add(v);
        await tx.update(workOrderMaterials).set({ receivedQty: sql`${workOrderMaterials.receivedQty} + ${l.qty}::numeric` }).where(eq(workOrderMaterials.id, l.materialId!));
      }
    }

    const running = {
      materialCost: D(w.materialCost).add(totals.material).toFixed(2),
      conversionCost: D(w.conversionCost).add(totals.conversion).toFixed(2),
      subcontractCost: D(w.subcontractCost).add(totals.subcontract).toFixed(2),
      byproductValue: D(w.byproductValue).add(totals.byproduct).toFixed(2),
      outputValue: w.outputValue,
      varianceValue: w.varianceValue,
    };

    if (e.kind === 'receipt') {
      const outs = lines.filter((l) => l.kind === 'output' || l.kind === 'reject');
      const pieces = outs.reduce((s, l) => s.add(D(l.qty)), ZERO);
      const good = D(e.goodQty);
      const doneBefore = D(w.producedQty).add(D(w.rejectedQty));
      const finishes = D(w.producedQty).add(good).cmp(D(w.qty)) >= 0;
      const value = outputValue({ stdUnitCost: w.kind === 'rework' ? '0' : w.stdUnitCost, pieces: pieces.toFixed(4), wip: wipBalance(running), woQty: w.qty, doneBefore: doneBefore.toFixed(4), finishes });
      if (outs.length) {
        const rate = value.div(pieces).toFixed(6);
        const posted = await this.stock.post(tx, auth, voucher, outs.map((l) => move(l, 1, rate)));
        for (const [i, l] of outs.entries()) await record(l, D(posted[i].value));
        totals.output = outs.reduce((s, _l, i) => s.add(D(posted[i].value)), ZERO);
      }
      const produced = D(w.producedQty).add(good);
      Object.assign(patch, { producedQty: produced.toFixed(4), rejectedQty: D(w.rejectedQty).add(D(e.rejectQty)).toFixed(4), stage: produced.cmp(D(w.qty)) >= 0 ? 'completed' : 'in_progress' });
    } else if (e.kind === 'close') {
      totals.variance = wipBalance(running);
      Object.assign(patch, { stage: 'closed', closedAt: new Date() });
      await tx.update(documents).set({ status: 'completed' }).where(eq(documents.id, w.id));
    } else if (w.stage === 'released') patch.stage = 'in_progress';

    await tx
      .update(workOrders)
      .set({
        ...patch,
        materialCost: running.materialCost,
        conversionCost: running.conversionCost,
        subcontractCost: running.subcontractCost,
        byproductValue: running.byproductValue,
        outputValue: D(w.outputValue).add(totals.output).toFixed(2),
        varianceValue: D(w.varianceValue).add(totals.variance).toFixed(2),
      })
      .where(eq(workOrders.id, w.id));
    await tx
      .update(productionEntries)
      .set({ materialValue: totals.material.toFixed(2), conversionValue: totals.conversion.toFixed(2), subcontractValue: totals.subcontract.toFixed(2), outputValue: totals.output.add(totals.byproduct).toFixed(2), varianceValue: totals.variance.toFixed(2) })
      .where(eq(productionEntries.id, doc.id));
    const amount = e.kind === 'receipt' ? totals.output.add(totals.byproduct) : e.kind === 'close' ? totals.variance.abs() : totals.material.abs();
    await tx.update(documents).set({ amount: amount.toFixed(2) }).where(eq(documents.id, doc.id));
  }

  // ---- job cards ------------------------------------------------------------------------------

  private async operation(tx: Transaction, operationId: string) {
    const [op] = await tx.select().from(workOrderOperations).where(eq(workOrderOperations.id, operationId)).for('update');
    if (!op) throw new NotFoundException('Operation not found');
    return op;
  }

  start(auth: AuthContext, input: z.infer<typeof startCardSchema>) {
    return this.database.run(auth, (tx) => this.startTx(tx, auth, input));
  }

  private async startTx(tx: Transaction, auth: AuthContext, input: z.infer<typeof startCardSchema>) {
    const op = await this.operation(tx, input.operationId);
    const wo = await this.openOrder(tx, op.workOrderId);
    if (input.machineId) {
      const [m] = await tx.select({ workCenterId: machines.workCenterId }).from(machines).where(eq(machines.id, input.machineId));
      if (!m) throw new BadRequestException('Machine not found');
    }
    const toolId = input.toolId ?? op.toolId;
    let operatorName = input.operatorName;
    if (!operatorName) {
      const [u] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
      operatorName = u?.name ?? null;
    }
    const [card] = await tx
      .insert(jobCards)
      .values({ tenantId: auth.tenantId, workOrderId: op.workOrderId, operationId: op.id, operatorId: auth.userId, operatorName, machineId: input.machineId ?? null, toolId, createdBy: auth.userId, updatedBy: auth.userId })
      .returning();
    if (op.status === 'pending') await tx.update(workOrderOperations).set({ status: 'in_progress' }).where(eq(workOrderOperations.id, op.id));
    if (wo.wo.stage === 'released') await tx.update(workOrders).set({ stage: 'in_progress' }).where(eq(workOrders.id, wo.wo.id));
    if (toolId) await tx.update(tools).set({ status: 'in_use' }).where(and(eq(tools.id, toolId), eq(tools.status, 'available')));
    return card;
  }

  stop(auth: AuthContext, id: string, input: z.infer<typeof stopCardSchema>) {
    return this.database.run(auth, (tx) => this.stopTx(tx, auth, id, input));
  }

  private async stopTx(tx: Transaction, auth: AuthContext, id: string, input: z.infer<typeof stopCardSchema>) {
    const [card] = await tx.select().from(jobCards).where(eq(jobCards.id, id)).for('update');
    if (!card) throw new NotFoundException('Job card not found');
    if (card.status !== 'running') throw new ConflictException('This job card is already stopped');
    const op = await this.operation(tx, card.operationId);
    const wo = await this.openOrder(tx, card.workOrderId);
    const good = D(input.goodQty);
    const rej = D(input.rejectQty);
    // Each operation works on what the previous one passed (the first on the order quantity).
    const [prev] = await tx
      .select({ goodQty: workOrderOperations.goodQty, name: workOrderOperations.name })
      .from(workOrderOperations)
      .where(and(eq(workOrderOperations.workOrderId, op.workOrderId), sql`${workOrderOperations.seq} < ${op.seq}`))
      .orderBy(desc(workOrderOperations.seq))
      .limit(1);
    const input_ = prev ? D(prev.goodQty) : D(wo.wo.qty).mul(D('1').add(OVER_PRODUCTION));
    const processed = D(op.goodQty).add(D(op.rejectQty)).add(good).add(rej);
    if (processed.cmp(input_) > 0) {
      throw new BadRequestException(prev ? `Only ${Number(prev.goodQty)} have come through ${prev.name}; ${Number(D(op.goodQty).add(D(op.rejectQty)))} already booked here` : `That is more than 10% over the ordered ${Number(wo.wo.qty)}`);
    }
    if (rej.cmp(ZERO) > 0 && !input.rejectReason) throw new BadRequestException('Say why the pieces were rejected');
    const ended = new Date();
    const minutes = op.isSubcontract ? '0' : (input.minutes ?? Math.max(0, (ended.getTime() - card.startedAt.getTime()) / 60000).toFixed(2));
    const [wc] = await tx.select().from(workCenters).where(eq(workCenters.id, op.workCenterId));
    const cost = op.isSubcontract ? { labour: '0.00', machine: '0.00', overhead: '0.00' } : timeCost(minutes, { labour: wc.labourRate, machine: wc.machineRate, overhead: wc.overheadRate });
    const subcontractCost = op.isSubcontract ? good.add(rej).mul(D(op.subcontractRate ?? '0')).toFixed(2) : '0';
    let shots = 0;
    if (card.toolId) {
      const [t] = await tx.select().from(tools).where(eq(tools.id, card.toolId));
      shots = input.shots ?? shotsFor(good.add(rej).toFixed(4), t?.cavities ?? 1);
      if (t) await tx.update(tools).set({ shotsUsed: t.shotsUsed + shots, status: t.status === 'in_use' ? 'available' : t.status }).where(eq(tools.id, t.id));
    }
    const [updated] = await tx
      .update(jobCards)
      .set({ status: 'done', endedAt: ended, minutes, goodQty: good.toFixed(4), rejectQty: rej.toFixed(4), shots, labourCost: cost.labour, machineCost: cost.machine, overheadCost: cost.overhead, subcontractCost, rejectReason: input.rejectReason, notes: input.notes, jobWorkChallanId: input.jobWorkChallanId ?? null, updatedBy: auth.userId, updatedAt: new Date() })
      .where(eq(jobCards.id, id))
      .returning();
    const opGood = D(op.goodQty).add(good);
    const opRej = D(op.rejectQty).add(rej);
    await tx
      .update(workOrderOperations)
      .set({ goodQty: opGood.toFixed(4), rejectQty: opRej.toFixed(4), actualMinutes: D(op.actualMinutes).add(D(minutes)).toFixed(2), status: opGood.add(opRej).cmp(D(wo.wo.qty)) >= 0 ? 'done' : 'in_progress' })
      .where(eq(workOrderOperations.id, op.id));
    for (const l of this.cardListeners) await l(tx, auth, updated, op);
    return updated;
  }

  /** A finished sitting booked in one go (back-entry, sub-contract returns). */
  record(auth: AuthContext, input: z.infer<typeof recordCardSchema>) {
    return this.database.run(auth, async (tx) => {
      const card = await this.startTx(tx, auth, input);
      return this.stopTx(tx, auth, card.id, input);
    });
  }

  /** Open operations of released orders and running job cards: the shop-floor board. */
  shopFloor(auth: AuthContext, q: { workCenterId?: string }) {
    return this.database.run(auth, async (tx) => {
      const ops = await tx
        .select({
          id: workOrderOperations.id,
          seq: workOrderOperations.seq,
          name: workOrderOperations.name,
          status: workOrderOperations.status,
          isSubcontract: workOrderOperations.isSubcontract,
          inspection: workOrderOperations.inspection,
          goodQty: workOrderOperations.goodQty,
          rejectQty: workOrderOperations.rejectQty,
          plannedMinutes: workOrderOperations.plannedMinutes,
          actualMinutes: workOrderOperations.actualMinutes,
          toolId: workOrderOperations.toolId,
          workCenter: { id: workCenters.id, code: workCenters.code, name: workCenters.name },
          workOrder: { id: workOrders.id, number: documents.number, qty: workOrders.qty, priority: workOrders.priority, plannedEnd: workOrders.plannedEnd },
          item: { code: items.code, name: items.name },
        })
        .from(workOrderOperations)
        .innerJoin(workOrders, eq(workOrders.id, workOrderOperations.workOrderId))
        .innerJoin(documents, eq(documents.id, workOrders.id))
        .innerJoin(workCenters, eq(workCenters.id, workOrderOperations.workCenterId))
        .innerJoin(items, eq(items.id, workOrders.itemId))
        .where(and(inArray(workOrders.stage, ['released', 'in_progress']), eq(documents.status, 'approved'), ne(workOrderOperations.status, 'done'), q.workCenterId ? eq(workOrderOperations.workCenterId, q.workCenterId) : undefined))
        .orderBy(asc(workOrders.priority), sql`${workOrders.plannedEnd} nulls last`, asc(documents.number), asc(workOrderOperations.seq));
      const running = await tx
        .select({ id: jobCards.id, operationId: jobCards.operationId, operatorName: jobCards.operatorName, startedAt: jobCards.startedAt, machine: machines.code, tool: tools.code })
        .from(jobCards)
        .leftJoin(machines, eq(machines.id, jobCards.machineId))
        .leftJoin(tools, eq(tools.id, jobCards.toolId))
        .where(eq(jobCards.status, 'running'))
        .orderBy(asc(jobCards.startedAt));
      return { operations: ops.map((o) => ({ ...o, running: running.filter((r) => r.operationId === o.id) })) };
    });
  }

  cards(auth: AuthContext, woId: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ c: jobCards, seq: workOrderOperations.seq, operation: workOrderOperations.name, machine: machines.code, tool: tools.code })
        .from(jobCards)
        .innerJoin(workOrderOperations, eq(workOrderOperations.id, jobCards.operationId))
        .leftJoin(machines, eq(machines.id, jobCards.machineId))
        .leftJoin(tools, eq(tools.id, jobCards.toolId))
        .where(eq(jobCards.workOrderId, woId))
        .orderBy(desc(jobCards.startedAt))
        .then((rows) => rows.map(({ c: { tenantId: _t, ...c }, ...more }) => ({ ...c, ...more }))),
    );
  }

  // ---- costing -------------------------------------------------------------------------------

  costing(auth: AuthContext, woId: string) {
    return this.database.run(auth, async (tx) => {
      const [w] = await tx.select().from(workOrders).where(eq(workOrders.id, woId));
      if (!w) throw new NotFoundException('Work order not found');
      const mats = await tx
        .select({ m: workOrderMaterials, code: items.code, name: items.name, uom: uoms.code })
        .from(workOrderMaterials)
        .innerJoin(items, eq(items.id, workOrderMaterials.itemId))
        .innerJoin(uoms, eq(uoms.id, workOrderMaterials.uomId))
        .where(eq(workOrderMaterials.workOrderId, woId))
        .orderBy(asc(workOrderMaterials.lineNo));
      const ops = await tx.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, woId)).orderBy(asc(workOrderOperations.seq));
      const [unabsorbed] = await tx
        .select({ v: sql<string>`coalesce(sum(${jobCards.labourCost} + ${jobCards.machineCost} + ${jobCards.overheadCost} + ${jobCards.subcontractCost}), 0)::text` })
        .from(jobCards)
        .where(and(eq(jobCards.workOrderId, woId), eq(jobCards.status, 'done'), isNull(jobCards.absorbedIn)));
      const share = D(w.qty).isZero() ? ZERO : D(w.producedQty).div(D(w.qty));
      const v = variances({
        qty: w.qty,
        producedQty: w.producedQty,
        std: { material: w.stdMaterial, operation: w.stdOperation, subcontract: w.stdSubcontract, byproduct: w.stdByproduct, unitCost: w.stdUnitCost },
        actual: { material: w.materialCost, conversion: w.conversionCost, subcontract: w.subcontractCost, byproduct: w.byproductValue, output: w.outputValue },
        materials: mats.map((x) => x.m),
      });
      return {
        stage: w.stage,
        qty: w.qty,
        producedQty: w.producedQty,
        rejectedQty: w.rejectedQty,
        stdUnitCost: w.stdUnitCost,
        actual: { material: w.materialCost, conversion: w.conversionCost, subcontract: w.subcontractCost, byproduct: w.byproductValue, output: w.outputValue, variancePosted: w.varianceValue },
        wip: wipBalance(w).toFixed(2),
        unabsorbed: D(unabsorbed.v).toFixed(2),
        variances: v,
        materials: mats
          .filter((x) => x.m.kind === 'component')
          .map((x) => {
            const stdQty = D(x.m.requiredQty).mul(share);
            return { id: x.m.id, code: x.code, name: x.name, uom: x.uom, requiredQty: x.m.requiredQty, stdQtyForOutput: stdQty.toFixed(4), issuedQty: x.m.issuedQty, stdRate: x.m.stdRate, usageVariance: D(x.m.issuedQty).sub(stdQty).mul(D(x.m.stdRate)).toFixed(2) };
          }),
        operations: ops.map((o) => ({ seq: o.seq, name: o.name, plannedMinutes: o.plannedMinutes, actualMinutes: o.actualMinutes, goodQty: o.goodQty, rejectQty: o.rejectQty, isSubcontract: o.isSubcontract })),
      };
    });
  }

  // ---- entry view ---------------------------------------------------------------------------

  getEntry(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.entryView(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  private async entryView(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    // Entries are posted the moment they are made and corrected by further entries, never edited.
    const header = await this.documents.view(tx, auth, doc, { manage: false, cancel: false });
    const [e] = await tx.select().from(productionEntries).where(eq(productionEntries.id, doc.id));
    const [wo] = await tx.select({ id: documents.id, number: documents.number, itemId: workOrders.itemId }).from(workOrders).innerJoin(documents, eq(documents.id, workOrders.id)).where(eq(workOrders.id, e.workOrderId));
    const lines = await tx
      .select({ l: productionEntryLines, code: items.code, name: items.name, uom: uoms.code, warehouse: warehouses.code })
      .from(productionEntryLines)
      .innerJoin(items, eq(items.id, productionEntryLines.itemId))
      .innerJoin(uoms, eq(uoms.id, items.baseUomId))
      .innerJoin(warehouses, eq(warehouses.id, productionEntryLines.warehouseId))
      .where(eq(productionEntryLines.entryId, doc.id))
      .orderBy(asc(productionEntryLines.lineNo));
    const { tenantId: _t, id: _i, ...rest } = e;
    return {
      ...header,
      ...rest,
      workOrder: wo,
      lines: lines.map(({ l: { tenantId: _lt, entryId: _e, ...l }, ...more }) => ({ ...l, ...more })),
    };
  }
}
