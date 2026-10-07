import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { dispensings, documents, formulaLines, formulas, items, jobCards, machineCleanings, machines, stockBalances, uoms, workCenters, workOrderMaterials, workOrderOperations, workOrders } from '@nextgen/database';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { ProductionService } from '../manufacturing/production.service';
import { WorkOrdersService } from '../manufacturing/work-orders.service';
import { adjustForAssay, lineQty, withinTolerance, yieldOf } from './formula-math';

const D = Decimal.from;
const ZERO = D('0');

const qty = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity must be more than zero (up to 4 decimals)');

export const dispenseSchema = z.object({
  docDate: z.iso.date().optional(),
  lines: z
    .array(
      z.object({
        materialId: z.uuid(),
        qty,
        batchNo: optionalText(40),
        /** Assay of the lot, %; needed for potency-dosed ingredients. */
        assayPct: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
          .refine((v) => v === null || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 100), 'Assay: a percentage up to 100'),
        /** Weighed outside tolerance: why it is still accepted. */
        overrideReason: optionalText(300),
        checkedBy: optionalText(120),
      }),
    )
    .min(1)
    .max(100),
  notes: optionalText(1000),
});
export type DispenseInput = z.infer<typeof dispenseSchema>;

export const correctionSchema = z.object({
  itemId: z.uuid(),
  qty,
  batchNo: optionalText(40),
  stageSeq: z.number().int().min(1).max(9999).nullable().optional(),
  reason: z.string().trim().min(3, 'Say why the correction was needed').max(300),
  checkedBy: optionalText(120),
});
export type CorrectionInput = z.infer<typeof correctionSchema>;

export const packSchema = z.object({
  bulkItemId: z.uuid(),
  batchNo: optionalText(40),
  sourceWarehouseId: z.uuid(),
  targetWarehouseId: z.uuid(),
  lines: z.array(z.object({ formulaId: z.uuid(), packs: qty })).min(1).max(30),
});
export type PackInput = z.infer<typeof packSchema>;

export const cleaningSchema = z.object({
  kind: z.enum(['minor', 'major', 'product_change']).default('minor'),
  cleanedBy: z.string().trim().min(2).max(120),
  verifiedBy: optionalText(120),
  result: optionalText(300),
  notes: optionalText(1000),
});
export type CleaningInput = z.infer<typeof cleaningSchema>;

/**
 * Process batches on top of work orders: dispensing (weighing against target with tolerance,
 * potency-adjusted for the lot's assay) issues the material through the normal production
 * entry; yield compares the output with the formula's theoretical yield.
 */
@Injectable()
export class ProcessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly production: ProductionService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  dispense(auth: AuthContext, woId: string, input: DispenseInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, woId));
      if (!wo) throw new NotFoundException('Batch not found');
      if (wo.kind !== 'batch') throw new ConflictException('Dispensing is for process batches; issue materials to other work orders');
      const mats = await tx.select({ m: workOrderMaterials, code: items.code }).from(workOrderMaterials).innerJoin(items, eq(items.id, workOrderMaterials.itemId)).where(eq(workOrderMaterials.workOrderId, woId));
      const done = await tx.select().from(dispensings).where(eq(dispensings.workOrderId, woId));
      // What is still to dispense per material, in standard-potency terms.
      const remaining = new Map<string, Decimal>();
      for (const x of mats) {
        const given = done.filter((d) => d.materialId === x.m.id).reduce((s, d) => s.add(this.stdEquivalent(d.qty, x.m.basis, x.m.stdPotency, d.assayPct)), ZERO);
        remaining.set(x.m.id, D(x.m.requiredQty).sub(given));
      }
      const errors: { path: string; message: string }[] = [];
      const records: (typeof dispensings.$inferInsert)[] = [];
      input.lines.forEach((l, i) => {
        const x = mats.find((m) => m.m.id === l.materialId);
        if (!x || x.m.kind !== 'component') return errors.push({ path: `lines.${i}.materialId`, message: `Line ${i + 1}: not an ingredient of this batch` });
        if (x.m.basis === 'potency' && !l.assayPct) return errors.push({ path: `lines.${i}.assayPct`, message: `${x.code} is dosed by potency: give the lot's assay` });
        const rest = remaining.get(x.m.id)!;
        const target = x.m.basis === 'potency' ? adjustForAssay(rest.cmp(ZERO) > 0 ? rest.toFixed(4) : '0', x.m.stdPotency, l.assayPct) : rest.cmp(ZERO) > 0 ? rest : ZERO;
        const ok = withinTolerance(l.qty, target, x.m.tolerancePct);
        if (!ok && !l.overrideReason) {
          errors.push({ path: `lines.${i}.qty`, message: `${x.code}: ${Number(l.qty)} is outside ±${Number(x.m.tolerancePct ?? 0)}% of the target ${Number(target.toFixed(4))}; reweigh or give a reason` });
          return;
        }
        remaining.set(x.m.id, rest.sub(this.stdEquivalent(l.qty, x.m.basis, x.m.stdPotency, l.assayPct)));
        records.push({ tenantId: auth.tenantId, workOrderId: woId, materialId: x.m.id, batchNo: l.batchNo, assayPct: l.assayPct, targetQty: target.toFixed(4), qty: l.qty, withinTolerance: ok, overrideReason: ok ? null : l.overrideReason, dispensedBy: auth.userId, checkedBy: l.checkedBy });
      });
      if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
      const entry = await this.production.issueTx(tx, auth, woId, { docDate: input.docDate, all: false, notes: input.notes ?? 'Dispensing', lines: input.lines.map((l) => ({ materialId: l.materialId, qty: l.qty, batchNo: l.batchNo, serialNos: null })) }, meta);
      await tx.insert(dispensings).values(records.map((r) => ({ ...r, entryId: entry.id })));
      return { entry: { id: entry.id, number: entry.number, materialValue: entry.materialValue }, dispensed: records.map((r) => ({ materialId: r.materialId, qty: r.qty, targetQty: r.targetQty, withinTolerance: r.withinTolerance })) };
    });
  }

  // ---- corrections (shade, viscosity, pH…) -----------------------------------------------------

  /** An addition the formula does not have (shade or viscosity correction): added to the batch and dispensed. */
  correct(auth: AuthContext, woId: string, input: CorrectionInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, woId));
      if (!wo || wo.kind !== 'batch') throw new NotFoundException('Batch not found');
      if (!['released', 'in_progress'].includes(wo.stage)) throw new ConflictException('Corrections are made while the batch is in process');
      const [it] = await tx.select({ id: items.id, baseUomId: items.baseUomId, isStockItem: items.isStockItem }).from(items).where(eq(items.id, input.itemId));
      if (!it?.isStockItem) throw new BadRequestException({ message: 'Choose a stock item to add', errors: [{ path: 'itemId', message: 'Choose a stock item to add' }] });
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${workOrderMaterials.lineNo}), 0)::int + 1` }).from(workOrderMaterials).where(eq(workOrderMaterials.workOrderId, woId));
      const [m] = await tx.insert(workOrderMaterials).values({ tenantId: auth.tenantId, workOrderId: woId, lineNo: next, kind: 'component', itemId: it.id, uomId: it.baseUomId, requiredQty: input.qty, basis: 'fixed', operationSeq: input.stageSeq ?? null }).returning();
      const entry = await this.production.issueTx(tx, auth, woId, { docDate: undefined, all: false, notes: `Correction: ${input.reason}`, lines: [{ materialId: m.id, qty: input.qty, batchNo: input.batchNo, serialNos: null }] }, meta);
      await tx.insert(dispensings).values({ tenantId: auth.tenantId, workOrderId: woId, materialId: m.id, entryId: entry.id, batchNo: input.batchNo, targetQty: input.qty, qty: input.qty, withinTolerance: true, overrideReason: `Correction: ${input.reason}`, dispensedBy: auth.userId, checkedBy: input.checkedBy });
      return { entry: { id: entry.id, number: entry.number }, materialId: m.id };
    });
  }

  // ---- packing bulk into pack sizes -------------------------------------------------------------

  /** Packing formulas that consume a bulk item, with the bulk each pack needs. */
  packingOptions(auth: AuthContext, bulkItemId: string) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({ id: formulas.id, number: documents.number, itemId: formulas.itemId, code: items.code, name: items.name, batchSize: formulas.batchSize, qty: formulaLines.qty, basis: formulaLines.basis })
        .from(formulaLines)
        .innerJoin(formulas, eq(formulas.id, formulaLines.formulaId))
        .innerJoin(documents, eq(documents.id, formulas.id))
        .innerJoin(items, eq(items.id, formulas.itemId))
        .where(and(eq(formulaLines.itemId, bulkItemId), eq(formulaLines.kind, 'ingredient'), eq(formulas.kind, 'packing'), eq(formulas.isDefault, true), eq(documents.status, 'approved')))
        .orderBy(asc(items.code));
      return rows.map((r) => ({ formulaId: r.id, number: r.number, packItem: { id: r.itemId, code: r.code, name: r.name }, bulkPerPack: lineQty({ kind: 'ingredient', itemId: bulkItemId, basis: r.basis as 'fixed', qty: r.qty }, r.batchSize, '1').toFixed(4) }));
    });
  }

  /** Splits a bulk lot into packing orders (draft batches), checking the bulk is there. */
  pack(auth: AuthContext, input: PackInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const options = await this.packingOptions(auth, input.bulkItemId);
      const errors: { path: string; message: string }[] = [];
      let need = ZERO;
      input.lines.forEach((l, i) => {
        const o = options.find((x) => x.formulaId === l.formulaId);
        if (!o) errors.push({ path: `lines.${i}.formulaId`, message: `Line ${i + 1}: not a packing formula for this bulk` });
        else need = need.add(D(o.bulkPerPack).mul(D(l.packs)));
      });
      if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
      const [bal] = await tx.select({ q: sql<string>`coalesce(sum(${stockBalances.qty}), 0)::text` }).from(stockBalances).where(and(eq(stockBalances.itemId, input.bulkItemId), eq(stockBalances.warehouseId, input.sourceWarehouseId)));
      if (D(bal.q).cmp(need) < 0) throw new ConflictException(`Packing needs ${Number(need.toFixed(4))} of the bulk; only ${Number(D(bal.q).toFixed(4))} is in stock`);
      const orders = [];
      for (const l of input.lines) {
        const o = options.find((x) => x.formulaId === l.formulaId)!;
        const w = await this.workOrders.createTx(tx, auth, { kind: 'batch', itemId: o.packItem.id, formulaId: l.formulaId, batchNo: input.batchNo ?? null, qty: l.packs, sourceWarehouseId: input.sourceWarehouseId, targetWarehouseId: input.targetWarehouseId, priority: 3, backflush: false, notes: `Packing of ${input.batchNo ?? 'bulk'}` }, meta);
        orders.push({ id: w.id, item: o.packItem, packs: l.packs });
      }
      return { bulkNeeded: need.toFixed(4), orders };
    });
  }

  // ---- equipment cleaning -----------------------------------------------------------------------

  equipment(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({ id: machines.id, code: machines.code, name: machines.name, workCenter: workCenters.code, cleanStatus: machines.cleanStatus, lastItem: items.code })
        .from(machines)
        .innerJoin(workCenters, eq(workCenters.id, machines.workCenterId))
        .leftJoin(items, eq(items.id, machines.lastItemId))
        .where(and(eq(machines.requiresCleaning, true), eq(machines.isActive, true)))
        .orderBy(asc(machines.code));
      const logs = rows.length ? await tx.select().from(machineCleanings).where(inArray(machineCleanings.machineId, rows.map((r) => r.id))).orderBy(desc(machineCleanings.cleanedAt)) : [];
      return rows.map((r) => ({ ...r, lastCleaning: logs.find((l) => l.machineId === r.id) ?? null }));
    });
  }

  clean(auth: AuthContext, machineId: string, input: CleaningInput) {
    return this.database.run(auth, async (tx) => {
      const [m] = await tx.select().from(machines).where(eq(machines.id, machineId)).for('update');
      if (!m || !m.requiresCleaning) throw new NotFoundException('No such process equipment');
      if (m.cleanStatus === 'in_use') throw new ConflictException(`${m.code} is in use; stop the job card first`);
      const [log] = await tx.insert(machineCleanings).values({ tenantId: auth.tenantId, machineId, kind: input.kind, previousItemId: m.lastItemId, cleanedBy: input.cleanedBy, verifiedBy: input.verifiedBy, result: input.result, notes: input.notes, recordedBy: auth.userId }).returning();
      await tx.update(machines).set({ cleanStatus: 'clean' }).where(eq(machines.id, machineId));
      return log;
    });
  }

  /** A weighing in standard-potency terms (what the formula quantity is written in). */
  private stdEquivalent(q: string, basis: string | null, stdPotency: string | null, assay: string | null) {
    return basis === 'potency' && assay ? D(q).mul(D(assay)).div(D(stdPotency ?? '100')) : D(q);
  }

  /** Dispensing record, stage readings and yield of a batch. */
  batch(auth: AuthContext, woId: string) {
    return this.database.run(auth, async (tx) => {
      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, woId));
      if (!wo) throw new NotFoundException('Batch not found');
      const [f] = wo.formulaId ? await tx.select({ yieldPct: formulas.yieldPct, version: formulas.version, number: documents.number }).from(formulas).innerJoin(documents, eq(documents.id, formulas.id)).where(eq(formulas.id, wo.formulaId)) : [];
      const mats = await tx.select({ m: workOrderMaterials, code: items.code, name: items.name, uom: uoms.code }).from(workOrderMaterials).innerJoin(items, eq(items.id, workOrderMaterials.itemId)).innerJoin(uoms, eq(uoms.id, workOrderMaterials.uomId)).where(eq(workOrderMaterials.workOrderId, woId)).orderBy(asc(workOrderMaterials.lineNo));
      const weighings = await tx.select().from(dispensings).where(eq(dispensings.workOrderId, woId)).orderBy(asc(dispensings.dispensedAt));
      const readings = await tx
        .select({ seq: workOrderOperations.seq, stage: workOrderOperations.name, readings: jobCards.readings, endedAt: jobCards.endedAt, operator: jobCards.operatorName })
        .from(jobCards)
        .innerJoin(workOrderOperations, eq(workOrderOperations.id, jobCards.operationId))
        .where(and(eq(jobCards.workOrderId, woId), eq(jobCards.status, 'done')))
        .orderBy(asc(workOrderOperations.seq), asc(jobCards.endedAt));
      const input = mats.filter((x) => x.m.kind === 'component').reduce((s, x) => s.add(D(x.m.issuedQty)), ZERO);
      const y = yieldOf(input.toFixed(4), f?.yieldPct ?? '100', wo.producedQty);
      return {
        formula: f ? { number: f.number, version: f.version, yieldPct: f.yieldPct } : null,
        batchNo: wo.batchNo,
        yield: { input: input.toFixed(4), output: wo.producedQty, ...y },
        materials: mats.map((x) => ({ id: x.m.id, kind: x.m.kind, code: x.code, name: x.name, uom: x.uom, basis: x.m.basis, stdPotency: x.m.stdPotency, tolerancePct: x.m.tolerancePct, requiredQty: x.m.requiredQty, issuedQty: x.m.issuedQty })),
        dispensings: weighings.map((d) => ({ ...d, code: mats.find((x) => x.m.id === d.materialId)?.code })),
        readings: readings.filter((r) => r.readings?.length),
        outOfRange: readings.flatMap((r) => (r.readings ?? []).filter((x) => !x.ok).map((x) => ({ stage: `${r.seq} ${r.stage}`, ...x }))),
      };
    });
  }
}
